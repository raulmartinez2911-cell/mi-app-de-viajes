import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { deleteUserItinerary, listUserItineraries, saveUserItinerary } from "@/lib/firebaseAdmin";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email;
  const itineraries = await listUserItineraries(userId);

  return NextResponse.json({ itineraries });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email;
  const body = await request.json();

  const result = await saveUserItinerary({
    userId,
    title: body.title ?? "Viaje",
    destination: body.destination ?? "",
    duration: body.duration ?? 3,
    content: body.content ?? { itinerary: [] },
    hotel: body.hotel,
    country: body.country,
    interests: Array.isArray(body.interests) ? body.interests : [],
    pace: body.pace,
    notes: body.notes,
  });

  return NextResponse.json({ id: result.id });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email;
  const { searchParams } = new URL(request.url);
  const itineraryId = searchParams.get("id");

  if (!itineraryId) {
    return NextResponse.json({ error: "Falta el id del itinerario" }, { status: 400 });
  }

  const deleted = await deleteUserItinerary(userId, itineraryId);
  if (!deleted) {
    return NextResponse.json({ error: "No se pudo borrar el itinerario" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
