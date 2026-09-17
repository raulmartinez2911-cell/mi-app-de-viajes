import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import {
  MAX_DAILY_GENERATIONS,
  ensureUserDocument,
  getUserDailyQuota,
  incrementUserDailyGeneration,
  saveUserItinerary,
} from "@/lib/firebaseAdmin";

type ItineraryRequest = {
  destination?: string;
  days?: string;
  startDate?: string;
  endDate?: string;
  arrival?: string;
  departure?: string;
  hotel?: string;
  interests?: string[];
  budget?: string;
  pace?: string;
  notes?: string;
  adjustment?: string;
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Inicia sesión con Google para generar itinerarios." }, { status: 401 });
  }

  const userId = (session.user as { id?: string }).id ?? session.user.email;

  await ensureUserDocument({
    uid: userId,
    email: session.user.email,
    displayName: session.user.name,
    photoURL: session.user.image,
  });

  const quota = await getUserDailyQuota(userId);
  if (quota.dailyGenerationsCount >= MAX_DAILY_GENERATIONS) {
    return NextResponse.json(
      {
        error: `Has alcanzado el límite diario de ${MAX_DAILY_GENERATIONS} itinerarios. Vuelve mañana para generar más rutas.`,
      },
      { status: 429 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  if (!apiKey || apiKey.includes("pega_aqui") || apiKey.includes("tu_clave")) {
    return NextResponse.json(
      {
        error:
          "Gemini no está configurado: sustituye el valor de GEMINI_API_KEY en .env.local por una clave real y reinicia npm run dev.",
      },
      { status: 503 },
    );
  }

  const body = (await request.json()) as ItineraryRequest;
  if (!body.destination?.trim()) {
    return NextResponse.json({ error: "Indica un destino para comenzar." }, { status: 400 });
  }

  const tripDays = Math.max(2, Number(body.days || 3));
  const paceInstructions =
    (body.pace || "Equilibrado").toLowerCase() === "intenso"
      ? "Este viaje es intenso: diseña 5 a 6 actividades bien encadenadas por día, con un ritmo activo, varias paradas y poco tiempo muerto. Hazlo suficientemente cargado para sentirse dinámico, pero aún realista y organizado."
      : (body.pace || "Equilibrado").toLowerCase() === "pausado"
        ? "Este viaje es pausado: deja más tiempo libre, menos paradas por día y un ritmo relajado."
        : "Este viaje es equilibrado: mezcla actividad y descanso con un ritmo cómodo y uniforme.";

  const prompt = `Eres un experto local y diseñador de viajes. Crea un itinerario de ${tripDays} días para ${body.destination}. El viajero llega el ${body.startDate || "primer día"} a las ${body.arrival || "hora no indicada"}, sale el ${body.endDate || "último día"} a las ${body.departure || "hora no indicada"} y se aloja en ${body.hotel || "un hotel céntrico"}. Prioriza estos intereses: ${(body.interests || []).join(", ") || "descubrimientos variados"}. Presupuesto: ${body.budget || "medio"}; ritmo: ${body.pace || "equilibrado"}; detalles: ${body.notes || "ninguno"}. Ajuste solicitado: ${body.adjustment || "ninguno"}. ${paceInstructions} Devuelve únicamente JSON válido con esta forma: {"itinerary":[{"day":"Día 01","title":"título corto","mood":"frase breve","stops":[{"time":"09:30","activity":"qué hacer, en lenguaje natural","place":"un lugar concreto para buscar en Google Maps","address":"calle o punto exacto, con ciudad"}]}]}. Incluye entre 3 y 5 planes con horas exactas por día, y si el ritmo es intenso aumenta hasta 5 o 6 planos bien encadenados. Para paseos por barrios o zonas generales, elige una calle peatonal, plaza, mercado, mirador o punto de inicio exacto. Para comer, elige un restaurante, mercado o cafetería concreta y añade su dirección. No uses zonas vagas como "barrio histórico" o "centro" en place. Empieza y termina de forma lógica en el hotel, agrupa lugares cercanos, respeta llegada y salida y deja pausas realistas.`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
  };

  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const providerMessage = result.error?.message as string | undefined;
        const serviceBusy = response.status === 503 || /high demand|spikes in demand|temporarily/i.test(String(providerMessage || ""));
        if (serviceBusy && attempt < 2) {
          lastError = `Gemini está saturado (${response.status}). Reintentando...`;
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }

        const error =
          response.status === 400 || response.status === 403
            ? `Gemini rechazó la solicitud (${response.status}): ${providerMessage || "la clave no es válida o la API no está habilitada"}.`
            : response.status === 404
              ? `El modelo ${model} no está disponible para esta clave. Cambia GEMINI_MODEL en .env.local por un modelo habilitado en tu cuenta.`
              : `Gemini no pudo responder (${response.status}): ${providerMessage || "error temporal del proveedor"}.`;
        return NextResponse.json({ error }, { status: 502 });
      }

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return NextResponse.json({ error: "Gemini devolvió una respuesta vacía." }, { status: 502 });
      }

      try {
        const cleanText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        const parsed = JSON.parse(cleanText) as { itinerary?: unknown };
        if (!Array.isArray(parsed.itinerary)) {
          throw new Error("missing itinerary");
        }

        await incrementUserDailyGeneration(userId);
        await saveUserItinerary({
          userId,
          title: `${body.destination} · ${tripDays} días`,
          destination: body.destination,
          duration: tripDays,
          content: parsed,
        });

        return NextResponse.json(parsed);
      } catch {
        return NextResponse.json(
          { error: "Gemini respondió, pero su itinerario no tenía un formato válido. Vuelve a intentarlo." },
          { status: 502 },
        );
      }
    } catch {
      lastError = "No se pudo conectar con Gemini. Comprueba tu conexión e inténtalo de nuevo.";
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      return NextResponse.json({ error: lastError }, { status: 502 });
    }
  }

  return NextResponse.json({ error: lastError || "Gemini no pudo responder en este momento. Inténtalo de nuevo." }, { status: 502 });
}
