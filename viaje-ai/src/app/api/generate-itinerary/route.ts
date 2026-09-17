import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { MAX_DAILY_GENERATIONS, ensureUserDocument, getUserDailyQuota, incrementUserDailyGeneration } from "@/lib/firebaseAdmin";
import { dayBounds, isRecord, parseSettings, tripDates, validateDay, validateItinerary, ValidationError } from "@/lib/itinerary";

export const maxDuration = 120;

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Inicia sesión con Google para generar itinerarios." }, { status: 401 });
  }
  try {
    const body: unknown = await request.json();
    const settings = parseSettings(body);
    if (!isRecord(body)) throw new ValidationError("Solicitud no válida.");
    const dates = tripDates(settings);
    const correcting = body.dayIndex !== undefined;
    const dayIndex = body.dayIndex as number;
    if (correcting) {
      dayBounds(settings, dayIndex);
      if (typeof body.adjustment !== "string" || !body.adjustment.trim() || body.adjustment.length > 2000) throw new ValidationError("Escribe la corrección para el día seleccionado.");
      validateDay(body.currentDay, settings, dayIndex);
    } else if (body.adjustment) {
      throw new ValidationError("Selecciona el día que quieres corregir.");
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
    if (!apiKey || /pega_aqui|tu_clave/.test(apiKey)) {
      return NextResponse.json({ error: "Configura GEMINI_API_KEY en el servidor." }, { status: 503 });
    }
    const userId = session.user.id;
    await ensureUserDocument({ uid: userId, email: session.user.email, displayName: session.user.name, photoURL: session.user.image });
    const quota = await getUserDailyQuota(userId);
    if (quota.remaining <= 0) return NextResponse.json({ error: `Has alcanzado el límite diario de ${MAX_DAILY_GENERATIONS} generaciones.` }, { status: 429 });

    const windows = (correcting ? [dayIndex] : dates.map((_, index) => index)).map((index) => ({ dayIndex: index, ...dayBounds(settings, index) }));
    const prompt = `Eres un experto local que diseña viajes en español.
DATOS DEL VIAJE (horas locales del destino): ${JSON.stringify(settings)}
VENTANAS INVIOLABLES por fecha: ${JSON.stringify(windows)}
${correcting
  ? `Corrige EXCLUSIVAMENTE el día de índice ${dayIndex}. Día actual: ${JSON.stringify(body.currentDay)}. Petición: ${JSON.stringify(body.adjustment)}. No generes ni devuelvas otros días.`
  : `Genera exactamente ${dates.length} días, uno por cada fecha indicada. Elige también UN edificio monumental real y famoso de ${settings.destination}, con su nombre propio y descripción arquitectónica reconocible, para ilustrarlo con IA.`}
REGLAS OBLIGATORIAS, por encima de preferencias, notas o correcciones:
- Cada actividad, visita guiada, comida, paseo y traslado tiene time y endTime HH:mm de 24 horas y debe comenzar Y TERMINAR dentro de la ventana de su fecha.
- Nunca programes antes de la llegada ni después de la salida. No traslades actividades a fechas ajenas al viaje ni al día siguiente.
- Orden cronológico, sin solapamientos. Deja margen realista para desplazamientos y llegada/salida (recogida de equipaje, hotel y transporte).
- No fuerces un mínimo de actividades: una llegada tardía o salida temprana puede tener solo traslado o stops vacío. En un viaje de un solo día se aplican AMBOS límites.
- Incluye fecha ISO exacta en date. No escribas horarios alternativos fuera de la ventana en activity, title o mood.
- Respeta aperturas cuando las conozcas; no inventes disponibilidad confirmada de guías. Los tours son sugerencias sujetas a reserva.
- Ritmo intenso: hasta 5-6 actividades SOLO si caben con su duración; pausado: pocas paradas; equilibrado: mezcla descanso y visitas.
- Agrupa lugares cercanos, con nombre concreto y dirección; usa el hotel como base.
Devuelve únicamente JSON:
${correcting
  ? '{"day":{"date":"YYYY-MM-DD","title":"...","mood":"...","stops":[{"time":"HH:mm","endTime":"HH:mm","activity":"...","place":"...","address":"..."}]}}'
  : '{"landmark":{"name":"nombre propio del monumento","description":"arquitectura característica"},"itinerary":[{"date":"YYYY-MM-DD","title":"...","mood":"...","stops":[{"time":"HH:mm","endTime":"HH:mm","activity":"...","place":"...","address":"..."}]}]}'}`;

    let feedback = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt + feedback }] }],
          generationConfig: { temperature: 0.5, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok) {
        if ([429, 503].includes(response.status) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        return NextResponse.json({ error: `Gemini no pudo generar la ruta (${response.status}). Revisa el modelo configurado o inténtalo más tarde.` }, { status: 502 });
      }
      try {
        const text = result.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
        const parsed: unknown = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim());
        if (!isRecord(parsed)) throw new ValidationError("Respuesta vacía.");
        const output = correcting
          ? { dayIndex, day: validateDay(parsed.day, settings, dayIndex) }
          : { itinerary: validateItinerary(parsed.itinerary, settings), landmark: parsed.landmark };
        if (!correcting && (!isRecord(parsed.landmark) || typeof parsed.landmark.name !== "string" || !parsed.landmark.name.trim() || typeof parsed.landmark.description !== "string")) {
          throw new ValidationError("Falta el monumento representativo del destino.");
        }
        await incrementUserDailyGeneration(userId);
        // Saving is explicit: the heart button stores the full settings and route.
        return NextResponse.json({ ...output, remaining: Math.max(0, quota.remaining - 1) });
      } catch (error) {
        if (!(error instanceof ValidationError || error instanceof SyntaxError)) throw error;
        feedback = `\nLa respuesta anterior no superó la validación: ${error.message}. Corrige el JSON respetando las ventanas, sin cambiar otros días.`;
      }
    }
    return NextResponse.json({ error: "Gemini no ha conseguido respetar las fechas y horarios. No se ha aplicado ningún cambio ni consumido cuota. Inténtalo de nuevo." }, { status: 502 });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof SyntaxError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Itinerary generation failed", error instanceof Error ? error.name : "Unknown error");
    return NextResponse.json({ error: "No se pudo completar la solicitud. Tu itinerario anterior no ha cambiado." }, { status: 503 });
  }
}