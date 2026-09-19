import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

export const MAX_DAILY_GENERATIONS = 5;

function getAdminApp(): App | null {
  if (getApps().length) return getApps()[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

function getAdminDb() {
  const app = getAdminApp();
  if (!app) {
    throw new Error(
      "Falta la configuración de Firebase Admin. Revisa FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY en .env.local.",
    );
  }
  return getFirestore(app);
}

export const adminDb = getAdminDb();

export function isSameDay(dateA: string | Date | null | undefined, dateB: Date = new Date()): boolean {
  if (!dateA) return false;
  const first = new Date(dateA);
  return (
    first.getFullYear() === dateB.getFullYear() &&
    first.getMonth() === dateB.getMonth() &&
    first.getDate() === dateB.getDate()
  );
}

export async function ensureUserDocument(input: {
  uid: string;
  email: string;
  displayName?: string | null;
  photoURL?: string | null;
}) {
  const now = new Date().toISOString();
  const db = getAdminDb();
  const userRef = db.collection("users").doc(input.uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    await userRef.set({
      id: input.uid,
      uid: input.uid,
      name: input.displayName ?? input.email,
      email: input.email,
      image: input.photoURL ?? "",
      displayName: input.displayName ?? input.email,
      photoURL: input.photoURL ?? "",
      createdAt: now,
      lastGenerationDate: now,
      dailyGenerationsCount: 0,
      updatedAt: now,
    });
    return { ...userRef, created: true };
  }

  const data = userSnap.data() ?? {};
  const lastGenerationDate = data.lastGenerationDate as string | undefined;
  const shouldReset = !isSameDay(lastGenerationDate, new Date());

  if (shouldReset) {
    await userRef.update({
      dailyGenerationsCount: 0,
      lastGenerationDate: now,
      updatedAt: now,
      name: input.displayName ?? data.name ?? input.email,
      email: input.email,
      image: input.photoURL ?? data.image ?? "",
      displayName: input.displayName ?? data.displayName ?? input.email,
      photoURL: input.photoURL ?? data.photoURL ?? "",
    });
  }

  return userSnap;
}

export async function getUserDailyQuota(userId: string) {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  const now = new Date();
  const currentDate = now.toISOString();

  if (!userSnap.exists) {
    return {
      limit: MAX_DAILY_GENERATIONS,
      dailyGenerationsCount: 0,
      remaining: MAX_DAILY_GENERATIONS,
      lastGenerationDate: currentDate,
    };
  }

  const data = userSnap.data() ?? {};
  const currentCount = typeof data.dailyGenerationsCount === "number" ? data.dailyGenerationsCount : 0;
  const lastGenerationDate = data.lastGenerationDate as string | undefined;

  if (!isSameDay(lastGenerationDate, now)) {
    await userRef.update({
      dailyGenerationsCount: 0,
      lastGenerationDate: currentDate,
      updatedAt: currentDate,
    });
    return {
      limit: MAX_DAILY_GENERATIONS,
      dailyGenerationsCount: 0,
      remaining: MAX_DAILY_GENERATIONS,
      lastGenerationDate: currentDate,
    };
  }

  const remaining = Math.max(0, MAX_DAILY_GENERATIONS - currentCount);

  return {
    limit: MAX_DAILY_GENERATIONS,
    dailyGenerationsCount: currentCount,
    remaining,
    lastGenerationDate: lastGenerationDate ?? currentDate,
  };
}

export async function incrementUserDailyGeneration(userId: string) {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(userId);
  const now = new Date().toISOString();

  await userRef.update({
    dailyGenerationsCount: FieldValue.increment(1),
    lastGenerationDate: now,
    updatedAt: now,
  });
}

export async function acquireGeminiSlot() {
  const db = getAdminDb();
  const slotRef = db.collection("system").doc("geminiGenerationSlot");
  const now = Date.now();
  const minimumGapMs = 12_000;

  return db.runTransaction(async (transaction) => {
    const previous = (await transaction.get(slotRef)).data()?.lastRequestAt;
    const lastRequestAt = typeof previous === "number" ? previous : 0;
    const retryAfterMs = Math.max(0, minimumGapMs - (now - lastRequestAt));
    if (retryAfterMs > 0) return { acquired: false, retryAfterMs };
    transaction.set(slotRef, { lastRequestAt: now }, { merge: true });
    return { acquired: true, retryAfterMs: 0 };
  });
}

export async function saveUserItinerary(input: {
  userId: string;
  title: string;
  destination: string;
  duration: number | string;
  content: string | Record<string, unknown>;
  hotel?: string;
  country?: string;
  interests?: string[];
  pace?: string;
  notes?: string;
  startDate?: string;
  endDate?: string;
  arrival?: string;
  departure?: string;
  budget?: string;
  continent?: string;
}) {
  const now = new Date().toISOString();
  const db = getAdminDb();
  const itineraryRef = db.collection("itineraries").doc();

  await itineraryRef.set({
    id: itineraryRef.id,
    userId: input.userId,
    title: input.title,
    destination: input.destination,
    duration: String(input.duration),
    content: typeof input.content === "string" ? input.content : JSON.stringify(input.content),
    hotel: input.hotel ?? "",
    country: input.country ?? "",
    interests: input.interests ?? [],
    pace: input.pace ?? "",
    notes: input.notes ?? "",
    startDate: input.startDate ?? "",
    endDate: input.endDate ?? "",
    arrival: input.arrival ?? "",
    departure: input.departure ?? "",
    budget: input.budget ?? "Medio",
    continent: input.continent ?? "",
    createdAt: now,
    updatedAt: now,
  });

  return { id: itineraryRef.id };
}

export async function listUserItineraries(userId: string) {
  const db = getAdminDb();
  // A single-field query works without a separately deployed composite index.
  // Signing out only clears the client session, never these persistent documents.
  const snapshot = await db.collection("itineraries").where("userId", "==", userId).get();

  return snapshot.docs
    .map((doc) => ({ ...doc.data(), id: doc.id }))
    .sort((a, b) => String((b as Record<string, unknown>).createdAt ?? "").localeCompare(String((a as Record<string, unknown>).createdAt ?? "")));
}

export async function deleteUserItinerary(userId: string, itineraryId: string) {
  const db = getAdminDb();
  const docRef = db.collection("itineraries").doc(itineraryId);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return false;
  }

  const data = snapshot.data() ?? {};
  if (data.userId !== userId) {
    return false;
  }

  await docRef.delete();
  return true;
}

export async function updateUserItineraryStatus(userId: string, itineraryId: string, completed: boolean) {
  const db = getAdminDb();
  const docRef = db.collection("itineraries").doc(itineraryId);
  const snapshot = await docRef.get();
  if (!snapshot.exists || snapshot.data()?.userId !== userId) return false;
  await docRef.update({ completed, updatedAt: new Date().toISOString() });
  return true;
}

export async function listManualVisitedCountries(userId: string) {
  const snapshot = await getAdminDb().collection("users").doc(userId).get();
  const countries = snapshot.data()?.manualVisitedCountries;
  return Array.isArray(countries) ? countries.filter((country): country is string => typeof country === "string") : [];
}

export async function saveManualVisitedCountries(userId: string, countries: string[]) {
  await getAdminDb().collection("users").doc(userId).set({ manualVisitedCountries: countries, updatedAt: new Date().toISOString() }, { merge: true });
  return countries;
}
