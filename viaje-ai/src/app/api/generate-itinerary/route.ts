import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { acquireGeminiSlot, MAX_DAILY_GENERATIONS, ensureUserDocument, getUserDailyQuota, incrementUserDailyGeneration } from "@/lib/firebaseAdmin";
import { dayBounds, isRecord, parseSettings, tripDates, validateDay, validateItinerary, ValidationError } from "@/lib/itinerary";

// Vercel Hobby plan caps serverless functions at 60s regardless of a higher value here.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function readGeminiStream(response: Response, controller: AbortController, idleMs: number) {
  if (!response.body) throw new Error("Gemini no devolvió un flujo de respuesta.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  // Only abort when Gemini stops sending new chunks; a slow-but-progressing generation is left alone.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleMs);
  };
  resetIdleTimer();
  try {
    while (true) {
      const chunk = await reader.read();
      resetIdleTimer();
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const parsed = JSON.parse(payload) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        text += parsed.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
      }
      if (chunk.done) break;
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    reader.releaseLock();
  }
  return text;
}

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
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    if (!apiKey || /pega_aqui|tu_clave/.test(apiKey)) {
      return NextResponse.json({ error: "Configura GEMINI_API_KEY en el servidor." }, { status: 503 });
    }
    const userId = session.user.id;
    await ensureUserDocument({ uid: userId, email: session.user.email, displayName: session.user.name, photoURL: session.user.image });
    const quota = await getUserDailyQuota(userId);
    if (quota.remaining <= 0) return NextResponse.json({ error: `Has alcanzado el límite diario de ${MAX_DAILY_GENERATIONS} generaciones.` }, { status: 429 });
    const slot = await acquireGeminiSlot();
    if (!slot.acquired) {
      return NextResponse.json({ error: `El planificador está atendiendo otra solicitud. Espera ${Math.ceil(slot.retryAfterMs / 1000)} segundos y vuelve a intentarlo.` }, { status: 429, headers: { "Retry-After": String(Math.ceil(slot.retryAfterMs / 1000)) } });
    }

    const windows = (correcting ? [dayIndex] : dates.map((_, index) => index)).map((index) => ({ dayIndex: index, ...dayBounds(settings, index) }));
    const prompt = `Diseña un itinerario práctico en español. Responde SOLO con JSON válido, sin markdown, introducción ni texto fuera del JSON.
  DATOS: ${JSON.stringify(settings)}
  VENTANAS HORARIAS OBLIGATORIAS: ${JSON.stringify(windows)}
${correcting
  ? `Corrige EXCLUSIVAMENTE el día de índice ${dayIndex}. Día actual: ${JSON.stringify(body.currentDay)}. Petición: ${JSON.stringify(body.adjustment)}. No generes ni devuelvas otros días.`
  : `Debes devolver el array "itinerary" con EXACTAMENTE ${dates.length} elementos, uno por cada fecha de esta lista, asignando rigurosamente cada fecha en el mismo orden al campo "date" (formato YYYY-MM-DD): ${JSON.stringify(dates)}. Ninguna fecha puede repetirse, faltar ni salirse de esta lista. Elige también UN edificio monumental real y famoso de ${settings.destination}, con su nombre propio y descripción arquitectónica reconocible, para ilustrarlo con IA.`}
REGLAS:
- Cada actividad, visita guiada, comida, paseo y traslado tiene time y endTime HH:mm de 24 horas y debe comenzar Y TERMINAR dentro de la ventana de su fecha.
- Nunca programes antes de la llegada ni después de la salida. No traslades actividades a fechas ajenas al viaje ni al día siguiente.
- Orden cronológico, sin solapamientos. Deja margen realista para desplazamientos y llegada/salida (recogida de equipaje, hotel y transporte).
- No fuerces un mínimo de actividades: una llegada tardía o salida temprana puede tener solo traslado o stops vacío. En un viaje de un solo día se aplican AMBOS límites.
- Incluye fecha ISO exacta en date. No escribas horarios alternativos fuera de la ventana en activity, title o mood.
- Respeta aperturas cuando las conozcas; no inventes disponibilidad confirmada de guías. Los tours son sugerencias sujetas a reserva.
- Ritmo intenso: hasta 5-6 actividades SOLO si caben con su duración; pausado: pocas paradas; equilibrado: mezcla descanso y visitas.
- Agrupa lugares cercanos, con nombre concreto y dirección; usa el hotel como base.
- ${settings.includePublicTransport ? "Incluye desplazamientos en transporte público cuando sean adecuados. En cada traslado interurbano o en tren/bus indica estación y coste aproximado del billete." : "Planifica los desplazamientos a pie por defecto. No inventes transporte público salvo que sea imprescindible."}
- Cuando un stop sea un desplazamiento, indica transportType como "A pie" por defecto o el medio público elegido; para trenes, buses o cambios de ciudad añade siempre station y estimatedCost aproximado.
- Si en las notas del usuario se pide visitar una ciudad o lugar externo (por ejemplo Cuzco o Machu Picchu partiendo de Lima), integra esa excursión dentro de la secuencia diaria de fechas indicada, sin añadir, quitar ni reordenar fechas: usa uno o varios de los días ya listados para esa excursión.
- Usa frases breves y directas en activity, title, mood, place y address (máximo ~12 palabras cada una); no repitas información ni escribas explicaciones largas, para evitar que la respuesta se corte.
FORMATO JSON ÚNICO:
${correcting
  ? '{"day":{"date":"YYYY-MM-DD","title":"...","mood":"...","stops":[{"time":"HH:mm","endTime":"HH:mm","activity":"...","place":"...","address":"..."}]}}'
  : '{"landmark":{"name":"nombre propio del monumento","description":"arquitectura característica"},"itinerary":[{"date":"YYYY-MM-DD","title":"...","mood":"...","stops":[{"time":"HH:mm","endTime":"HH:mm","activity":"...","place":"...","address":"...","transportType":"...","station":"...","estimatedCost":"..."}]}]}'}`;

    let feedback = "";
    const maxRetries = 2;
    // Vercel kills the function at 60s no matter what; keep an 8s safety margin for the surrounding logic.
    const hardDeadlineAt = Date.now() + 52_000;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const remainingMs = hardDeadlineAt - Date.now();
      if (remainingMs < 4_000) break;
      const controller = new AbortController();
      const hardTimer = setTimeout(() => controller.abort(), remainingMs);
      let response: Response;
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt + feedback }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" },
          }),
          signal: controller.signal,
        });
      } catch (networkError) {
        // Only retry if there is still enough budget left; otherwise it would just abort again immediately.
        if (attempt < maxRetries && hardDeadlineAt - Date.now() > 4_000) continue;
        clearTimeout(hardTimer);
        console.error("Gemini request failed", networkError instanceof Error ? networkError.message : networkError);
        return NextResponse.json({ error: "Gemini ha tardado demasiado en responder. No se ha consumido cuota; inténtalo de nuevo en unos segundos." }, { status: 503 });
      }
      if (!response.ok) {
        clearTimeout(hardTimer);
        const result = await response.json().catch(() => ({}));
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after") || "60";
          return NextResponse.json({ error: "El servicio de IA ha alcanzado su cuota compartida. No se ha iniciado ningún reintento; vuelve a intentarlo más tarde." }, { status: 429, headers: { "Retry-After": retryAfter } });
        }
        if ([500, 503].includes(response.status) && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        console.error("Gemini API error", response.status, JSON.stringify(result).slice(0, 500));
        const detail = isRecord(result) && isRecord(result.error) && typeof result.error.message === "string" ? result.error.message.slice(0, 200) : "";
        const modelIssue = response.status === 404 || response.status === 400;
        const hint = modelIssue ? `El modelo "${model}" no está disponible con tu clave. Revisa la variable GEMINI_MODEL.` : "Gemini sigue con alta demanda tras los reintentos automáticos. Tu solicitud no ha consumido cuota; inténtalo de nuevo más tarde.";
        return NextResponse.json({ error: `Gemini no pudo generar la ruta (${response.status}). ${hint}${detail ? ` Detalle: ${detail}` : ""}` }, { status: 502 });
      }
      try {
        const text = await readGeminiStream(response, controller, 20_000);
        clearTimeout(hardTimer);
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
        clearTimeout(hardTimer);
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