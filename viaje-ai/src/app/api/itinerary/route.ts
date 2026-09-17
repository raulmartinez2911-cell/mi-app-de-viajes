import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";

type ItineraryRequest = { destination?: string; days?: string; startDate?: string; endDate?: string; arrival?: string; departure?: string; hotel?: string; interests?: string[]; budget?: string; pace?: string; notes?: string; adjustment?: string };

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Inicia sesión con Google para crear itinerarios." }, { status: 401 });
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  if (!apiKey || apiKey.includes("pega_aqui") || apiKey.includes("tu_clave")) return NextResponse.json({ error: "Gemini no está configurado: sustituye el valor de GEMINI_API_KEY en .env.local por una clave real y reinicia npm run dev." }, { status: 503 });

  const body = (await request.json()) as ItineraryRequest;
  if (!body.destination?.trim()) return NextResponse.json({ error: "Indica un destino para comenzar." }, { status: 400 });

  const prompt = `Eres un experto local y diseñador de viajes. Crea un itinerario de ${body.days || "3"} días para ${body.destination}. El viajero llega el ${body.startDate || "primer día"} a las ${body.arrival || "hora no indicada"}, sale el ${body.endDate || "último día"} a las ${body.departure || "hora no indicada"} y se aloja en ${body.hotel || "un hotel céntrico"}. Prioriza estos intereses: ${(body.interests || []).join(", ") || "descubrimientos variados"}. Presupuesto: ${body.budget || "medio"}; ritmo: ${body.pace || "equilibrado"}; detalles: ${body.notes || "ninguno"}. Ajuste solicitado: ${body.adjustment || "ninguno"}. Devuelve únicamente JSON válido con esta forma: {"itinerary":[{"day":"Día 01","title":"título corto","mood":"frase breve","stops":[{"time":"09:30","activity":"qué hacer, en lenguaje natural","place":"un lugar concreto para buscar en Google Maps","address":"calle o punto exacto, con ciudad"}]}]}. Incluye entre 3 y 5 planes con horas exactas por día. Para paseos por barrios o zonas generales, elige una calle peatonal, plaza, mercado, mirador o punto de inicio exacto. Para comer, elige un restaurante, mercado o cafetería concreta y añade su dirección. No uses zonas vagas como "barrio histórico" o "centro" en place. Empieza y termina de forma lógica en el hotel, agrupa lugares cercanos, respeta llegada y salida y deja pausas realistas.`;
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, responseMimeType: "application/json" } }), signal: AbortSignal.timeout(30000) });
  } catch { return NextResponse.json({ error: "No se pudo conectar con Gemini. Comprueba tu conexión e inténtalo de nuevo." }, { status: 502 }); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = result.error?.message as string | undefined;
    const error = response.status === 400 || response.status === 403 ? `Gemini rechazó la solicitud (${response.status}): ${providerMessage || "la clave no es válida o la API no está habilitada"}.` : response.status === 404 ? `El modelo ${model} no está disponible para esta clave. Cambia GEMINI_MODEL en .env.local por un modelo habilitado en tu cuenta.` : `Gemini no pudo responder (${response.status}): ${providerMessage || "error temporal del proveedor"}.`;
    return NextResponse.json({ error }, { status: 502 });
  }
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return NextResponse.json({ error: "Gemini devolvió una respuesta vacía." }, { status: 502 });
  try {
    const cleanText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleanText) as { itinerary?: unknown };
    if (!Array.isArray(parsed.itinerary)) throw new Error("missing itinerary");
    return NextResponse.json(parsed);
  } catch { return NextResponse.json({ error: "Gemini respondió, pero su itinerario no tenía un formato válido. Vuelve a intentarlo." }, { status: 502 }); }
}