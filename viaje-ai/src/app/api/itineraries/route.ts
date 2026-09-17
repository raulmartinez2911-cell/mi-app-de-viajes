import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { deleteUserItinerary, listUserItineraries, saveUserItinerary } from "@/lib/firebaseAdmin";
import { isRecord, parseSettings, tripDates, validateItinerary, ValidationError } from "@/lib/itinerary";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const itineraries = await listUserItineraries(session.user.id);
    return NextResponse.json({ itineraries }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudieron cargar tus viajes de Firestore. No se han borrado; vuelve a intentarlo." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body: unknown = await request.json();
    const settings = parseSettings(body);
    if (!isRecord(body) || !isRecord(body.content)) throw new ValidationError("Falta el itinerario.");
    const itinerary = validateItinerary(body.content.itinerary, settings);
    const landmark = isRecord(body.content.landmark)
      ? { name: String(body.content.landmark.name ?? "").slice(0, 200), description: String(body.content.landmark.description ?? "").slice(0, 1500) }
      : null;
    const imageUrl = typeof body.content.imageUrl === "string" && /^\/api\/place-image\?id=[a-f0-9]{64}$/.test(body.content.imageUrl) ? body.content.imageUrl : "";
    const result = await saveUserItinerary({
      ...settings, userId: session.user.id, title: settings.city,
      duration: tripDates(settings).length,
      content: { itinerary, settings, landmark, imageUrl },
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof SyntaxError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "No se pudo guardar en Firestore. El viaje sigue en pantalla; vuelve a pulsar Guardar." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const itineraryId = new URL(request.url).searchParams.get("id");
  if (!itineraryId || !/^[a-zA-Z0-9_-]{1,128}$/.test(itineraryId)) return NextResponse.json({ error: "Id no válido" }, { status: 400 });
  try {
    const deleted = await deleteUserItinerary(session.user.id, itineraryId);
    if (!deleted) return NextResponse.json({ error: "No se encontró el itinerario." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "No se pudo borrar el viaje. Inténtalo de nuevo." }, { status: 503 });
  }
}