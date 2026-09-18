import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { listManualVisitedCountries, saveManualVisitedCountries } from "@/lib/firebaseAdmin";
import { isRecord } from "@/lib/itinerary";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try { return NextResponse.json({ countries: await listManualVisitedCountries(session.user.id) }); }
  catch { return NextResponse.json({ error: "No se pudieron cargar tus países." }, { status: 503 }); }
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.countries) || body.countries.length > 250 || !body.countries.every((country) => typeof country === "string" && country.length <= 120)) {
    return NextResponse.json({ error: "Lista de países no válida" }, { status: 400 });
  }
  const countries = [...new Set(body.countries as string[])].sort((a, b) => a.localeCompare(b, "es"));
  try { return NextResponse.json({ countries: await saveManualVisitedCountries(session.user.id, countries) }); }
  catch { return NextResponse.json({ error: "No se pudieron guardar tus países." }, { status: 503 }); }
}