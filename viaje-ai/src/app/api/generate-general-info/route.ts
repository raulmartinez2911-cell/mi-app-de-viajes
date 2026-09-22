import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { acquireGeminiSlot } from "@/lib/firebaseAdmin";
import { isRecord, validateGeneralInfo, ValidationError } from "@/lib/itinerary";

// Split from generate-itinerary so each Gemini call stays well under the 60s Hobby limit.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function readGeminiStream(response: Response) {
  if (!response.body) throw new Error("Gemini no devolvió un flujo de respuesta.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
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
    reader.releaseLock();
  }
  return text;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Inicia sesión con Google para generar itinerarios." }, { status: 401 });
  }
  try {
    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body.city !== "string" || !body.city.trim() || typeof body.country !== "string" || !body.country.trim()) {
      throw new ValidationError("Faltan la ciudad o el país del destino.");
    }
    const city = body.city.trim().slice(0, 120);
    const country = body.country.trim().slice(0, 120);

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_GENERAL_INFO_MODEL || "gemini-2.5-flash";
    if (!apiKey || /pega_aqui|tu_clave/.test(apiKey)) {
      return NextResponse.json({ error: "Configura GEMINI_API_KEY en el servidor." }, { status: 503 });
    }
    const slot = await acquireGeminiSlot();
    if (!slot.acquired) {
      return NextResponse.json({ error: `El planificador está atendiendo otra solicitud. Espera ${Math.ceil(slot.retryAfterMs / 1000)} segundos y vuelve a intentarlo.` }, { status: 429, headers: { "Retry-After": String(Math.ceil(slot.retryAfterMs / 1000)) } });
    }

    const prompt = `Devuelve SOLO JSON válido, sin markdown ni texto fuera del JSON, con información práctica y breve para viajeros de ${city}, ${country}.
FORMATO ÚNICO:
{"publicTransport":"tipo y precio aproximado del transporte público (metro, bus, tranvía, etc.)","taxiApps":"si funcionan Uber, Bolt u otras apps de taxi locales","restaurants":[{"name":"...","description":"..."}],"dishes":[{"name":"...","description":"..."}],"currency":"moneda oficial","euroConversion":"conversión aproximada a euros, indicando que puede variar"}
Incluye entre 4 y 5 restaurantes típicos y entre 4 y 5 platos típicos, cada uno con una descripción breve.`;

    let feedback = "";
    const maxRetries = 1;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response: Response;
      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt + feedback }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 1200, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (networkError) {
        console.error("Gemini general-info request failed", networkError instanceof Error ? networkError.message : networkError);
        return NextResponse.json({ error: "Gemini ha tardado demasiado en responder la información general." }, { status: 503 });
      }
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after") || "60";
          return NextResponse.json({ error: "El servicio de IA ha alcanzado su cuota compartida." }, { status: 429, headers: { "Retry-After": retryAfter } });
        }
        if ([500, 503].includes(response.status) && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
        console.error("Gemini general-info API error", response.status, JSON.stringify(result).slice(0, 500));
        return NextResponse.json({ error: `Gemini no pudo generar la información general (${response.status}).` }, { status: 502 });
      }
      try {
        const text = await readGeminiStream(response);
        const parsed: unknown = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim());
        return NextResponse.json({ generalInfo: validateGeneralInfo(parsed) });
      } catch (error) {
        if (!(error instanceof ValidationError || error instanceof SyntaxError)) throw error;
        feedback = `\nLa respuesta anterior no superó la validación: ${error.message}. Corrige el JSON con el formato exacto solicitado.`;
      }
    }
    return NextResponse.json({ error: "Gemini no ha conseguido generar la información general del destino. Inténtalo de nuevo." }, { status: 502 });
  } catch (error) {
    if (error instanceof ValidationError || error instanceof SyntaxError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("General info generation failed", error instanceof Error ? error.name : "Unknown error");
    return NextResponse.json({ error: "No se pudo completar la solicitud de información general." }, { status: 503 });
  }
}
