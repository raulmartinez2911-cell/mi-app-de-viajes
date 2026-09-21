"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import worldCatalog from "@/data/world-catalog.json";
import WorldMap from "./WorldMap";
import { isRecord, parseSettings, replaceDay, tripDates, validateGeneralInfo, validateItinerary, type Day, type GeneralInfo, type Landmark, type TripSettings } from "@/lib/itinerary";

const interests = ["Monumentos", "Spots fotográficos", "Cafeterías", "Foodies", "Museos", "Free tours", "Actividades", "Galerías de arte", "Vida nocturna", "Compras"];
const initialSettings: TripSettings = {
  continent: "",
  country: "", city: "", destination: "",
  startDate: "", endDate: "", arrival: "", departure: "",
  hotel: "", budget: "", pace: "", interests: [], notes: "",
  includePublicTransport: false,
};
type Screen = "home" | "planner" | "itinerary" | "trips";
type CurrentTrip = { settings: TripSettings; itinerary: Day[]; landmark: Landmark | null; generalInfo: GeneralInfo | null; imageUrl: string; sourceImageUrl: string; savedId?: string };
type SavedTrip = { id: string; title: string; destination: string; subtitle: string; trip: CurrentTrip | null; raw: Record<string, unknown>; completed: boolean };

function dateLabel(date: string) {
  if (!date || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
function parseSavedTrip(raw: Record<string, unknown>): SavedTrip {
  let trip: CurrentTrip | null = null;
  try {
    const content = typeof raw.content === "string" ? JSON.parse(raw.content) : raw.content;
    if (isRecord(content)) {
      const settings = parseSettings(content.settings ?? { ...raw, city: raw.title });
      const itinerary = validateItinerary(content.itinerary, settings);
      trip = {
        settings, itinerary, savedId: String(raw.id),
        landmark: isRecord(content.landmark) && typeof content.landmark.name === "string" && typeof content.landmark.description === "string" ? content.landmark as Landmark : null,
        imageUrl: typeof content.imageUrl === "string" && /^\/api\/place-image\?id=[a-f0-9]{64}$/.test(content.imageUrl) ? content.imageUrl : "",
        sourceImageUrl: typeof content.sourceImageUrl === "string" ? content.sourceImageUrl : "",
        generalInfo: (() => { try { return validateGeneralInfo(content.generalInfo); } catch { return null; } })(),
      };
    }
  } catch { /* Keep legacy documents visible; require their missing dates before replanning. */ }
  return {
    id: String(raw.id), title: String(raw.title || "Viaje"), destination: String(raw.destination || ""),
    subtitle: `${dateLabel(String(raw.startDate || ""))} — ${dateLabel(String(raw.endDate || ""))}`, trip, raw,
    completed: raw.completed === true,
  };
}
async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "No se pudo completar la solicitud.") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data;
}
function catalogEntry(settings: TripSettings) {
  return worldCatalog.entries.find((entry) => entry.continent === settings.continent && entry.country === settings.country && entry.city === settings.city) ??
    worldCatalog.entries.find((entry) => entry.country === settings.country && entry.city === settings.city);
}
function safeImageUrl(value: string) {
  return value.replace(/^http:\/\//i, "https://");
}
function Heart({ filled = false }: { filled?: boolean }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>;
}
function PlaneSpinner() {
  return <span className="plane-spinner" aria-hidden="true"><span>✈</span></span>;
}
function Landing({ authenticated, loading, onContinue }: { authenticated: boolean; loading?: boolean; onContinue: () => void }) {
  return <section className="intro landing-screen" id="top">
    <div className="landing-content">
      <div className="landing-brand-media"><Image className="landing-map" src="/mapa-mundi.png" alt="Mapa mundial ilustrado" width={900} height={900} priority /><Image className="landing-logo" src="/Rumbo.png" alt="Rumbo" width={1200} height={183} priority /></div>
      <div className="eyebrow"><span /> Planificador inteligente de viajes</div>
      <h1>Tu próxima ruta,<br /><em>bien trazada.</em></h1>
      <p className="intro-copy">Destinos, paseos y sobremesas pensados con calma. Diseña el viaje; Gemini se ocupa de unir los puntos.</p>
      <button className="submit-button landing-cta" onClick={onContinue} disabled={loading}>{loading ? "Cargando sesión..." : authenticated ? "Diseñar mi viaje" : "Iniciar sesión con Google"}<span aria-hidden="true">↗</span></button>
      <p className="landing-note">{authenticated ? "Tus viajes guardados te esperan en Mis viajes." : "Accede con Google para planificar y guardar tus rutas en tu cuenta."}</p>
      <div className="intro-stats"><span><strong>01</strong> destino elegido</span><span><strong>∞</strong> formas de viajar</span></div>
    </div>
  </section>;
}
function Footer() {
  return <footer><span>ruta / AI</span><span>Para curiosos, caminantes y sobremesas largas.</span><span>© 2026</span></footer>;
}
function savedTripImage(trip: SavedTrip) {
  return trip.trip?.sourceImageUrl || trip.trip?.imageUrl || "";
}
function savedTripColor(index: number) {
  return ["#f8bf68", "#8bc8c2", "#e78c7e", "#9db8e7", "#c7a2d8"][index % 5];
}
export default function Home() {
  const { data: session, status } = useSession();
  if (!session?.user?.id) {
    return <main className="app-shell">
      <nav className="topbar"><Link className="brand" href="/"><span className="brand-mark">✦</span> ruta / <strong>AI</strong></Link><span className="section-kicker">travel studio</span></nav>
      <Landing authenticated={false} loading={status === "loading"} onContinue={() => void signIn("google", { callbackUrl: "/#planner" })} />
      <Footer />
    </main>;
  }
  // A different Google account gets an entirely new client state. No shared localStorage.
  return <TravelStudio key={session.user.id} userName={session.user.name || session.user.email || "Viajero"} />;
}

function TravelStudio({ userName }: { userName: string }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [settings, setSettings] = useState<TripSettings>(initialSettings);
  const [current, setCurrent] = useState<CurrentTrip | null>(null);
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [manualVisitedCountries, setManualVisitedCountries] = useState<string[]>([]);
  const [manualCountry, setManualCountry] = useState("");
  const [tripSection, setTripSection] = useState<"pending" | "completed">("pending");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [dayIndex, setDayIndex] = useState(0);
  const [deletingId, setDeletingId] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState("");
  const mounted = useRef(true);
  const operation = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const loadTrips = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError("");
    try {
      const data = await jsonRequest("/api/itineraries");
      if (!Array.isArray(data.itineraries)) throw new Error("La biblioteca no ha devuelto una respuesta válida.");
      if (mounted.current) setSavedTrips(data.itineraries.map(parseSavedTrip));
    } catch (requestError) {
      if (mounted.current) setLibraryError(requestError instanceof Error ? requestError.message : "No se pudieron cargar los viajes.");
    } finally {
      if (mounted.current) setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => {
      const hash = window.location.hash.slice(1);
      if (hash === "planner" || hash === "trips") setScreen(hash);
      void loadTrips();
      void jsonRequest("/api/visited-countries").then((data) => {
        if (mounted.current && Array.isArray(data.countries)) setManualVisitedCountries(data.countries.filter((country: unknown): country is string => typeof country === "string"));
      }).catch(() => {});
      void jsonRequest("/api/user/quota").then((data) => {
        if (mounted.current) setRemaining(typeof data.remaining === "number" ? data.remaining : null);
      }).catch(() => {});
    }, 0);
    return () => { mounted.current = false; window.clearTimeout(timer); };
  }, [loadTrips]);

  useEffect(() => {
    heading.current?.focus();
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [screen]);

  function navigate(next: Screen) {
    setScreen(next);
    setError("");
    setNotice("");
    if (next === "trips") void loadTrips();
  }
  function update<K extends keyof TripSettings>(key: K, value: TripSettings[K]) {
    setSettings((previous) => {
      const next = { ...previous, [key]: value };
      if (key === "continent") {
        next.country = "";
        next.city = "";
      }
      if (key === "country") {
        next.city = worldCatalog.entries.find((entry) => entry.continent === next.continent && entry.country === value)?.city || "";
      }
      next.destination = next.city && next.country ? `${next.city}, ${next.country}` : "";
      return next;
    });
  }
  let duration = "Revisa las fechas";
  try { duration = `${tripDates(settings).length} días`; } catch {}

  async function createItinerary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current) return;
    setError("");
    try { parseSettings(settings); } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Revisa tus fechas."); return;
    }
    operation.current = true;
    setBusy(true);
    try {
      const snapshot = { ...settings, interests: [...settings.interests] };
      const data = await jsonRequest("/api/generate-itinerary", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot),
      });
      if (!mounted.current) return;
      const trip: CurrentTrip = { settings: snapshot, itinerary: validateItinerary(data.itinerary, snapshot), landmark: data.landmark, generalInfo: validateGeneralInfo(data.generalInfo), imageUrl: "", sourceImageUrl: safeImageUrl(catalogEntry(snapshot)?.imageUrl || "") };
      setCurrent(trip);
      setDayIndex(0); setAdjustment(""); setNotice("");
      setRemaining(data.remaining ?? null);
      setScreen("itinerary");
    } catch (requestError) {
      if (mounted.current) setError(requestError instanceof Error ? requestError.message : "No se pudo crear el itinerario.");
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function correctDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !adjustment.trim() || operation.current) return;
    operation.current = true;
    setBusy(true); setError(""); setNotice("");
    const selectedIndex = dayIndex;
    const original = current;
    try {
      const data = await jsonRequest("/api/generate-itinerary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...original.settings, dayIndex: selectedIndex, currentDay: original.itinerary[selectedIndex], adjustment }),
      });
      if (!mounted.current) return;
      if (data.dayIndex !== selectedIndex) throw new Error("La corrección no corresponde al día seleccionado.");
      const itinerary = replaceDay(original.itinerary, data.day, original.settings, selectedIndex);
      setCurrent((previous) => previous ? { ...previous, itinerary, savedId: undefined } : previous);
      setAdjustment(""); setRemaining(data.remaining ?? null);
      setNotice(`Día ${selectedIndex + 1} actualizado. Los demás días no han cambiado. Pulsa Guardar para conservar esta versión.`);
    } catch (requestError) {
      if (mounted.current) setError(requestError instanceof Error ? requestError.message : "No se pudo corregir el día.");
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function saveTrip() {
    if (!current || current.savedId || operation.current) return;
    operation.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const data = await jsonRequest("/api/itineraries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current.settings, content: { itinerary: current.itinerary, landmark: current.landmark, generalInfo: current.generalInfo, imageUrl: current.imageUrl, sourceImageUrl: current.sourceImageUrl } }),
      });
      if (!mounted.current) return;
      setCurrent((previous) => previous ? { ...previous, savedId: data.id } : previous);
      setNotice("Viaje guardado en tu cuenta de Google. Seguirá en Mis viajes aunque cierres sesión.");
      void loadTrips();
    } catch (requestError) {
      if (mounted.current) setError(requestError instanceof Error ? requestError.message : "No se pudo guardar el viaje.");
    } finally {
      operation.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  function openTrip(saved: SavedTrip) {
    if (!saved.trip) {
      // Older releases omitted dates and end times. Do not invent travel boundaries.
      setSettings({
        ...initialSettings,
        continent: String(saved.raw.continent || ""), country: String(saved.raw.country || ""),
        city: String(saved.raw.city || saved.title), destination: saved.destination, hotel: String(saved.raw.hotel || ""),
        startDate: String(saved.raw.startDate || ""), endDate: String(saved.raw.endDate || ""),
        arrival: String(saved.raw.arrival || ""), departure: String(saved.raw.departure || ""),
        notes: String(saved.raw.notes || ""),
      });
      setScreen("planner"); setError("");
      setNotice("Este viaje antiguo no incluye todos los horarios necesarios. Completa sus fechas y horas para generar una ruta validada. El original sigue guardado.");
      return;
    }
    setCurrent({ ...saved.trip, sourceImageUrl: saved.trip.sourceImageUrl || safeImageUrl(catalogEntry(saved.trip.settings)?.imageUrl || "") }); setSettings(saved.trip.settings);
    setDayIndex(0); setAdjustment(""); navigate("itinerary");
  }
  async function deleteTrip(id: string) {
    setDeletingId(id); setLibraryError("");
    try {
      await jsonRequest(`/api/itineraries?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!mounted.current) return;
      setSavedTrips((previous) => previous.filter((trip) => trip.id !== id));
      setCurrent((previous) => previous?.savedId === id ? { ...previous, savedId: undefined } : previous);
      setDeleteCandidate("");
    } catch (requestError) {
      if (mounted.current) setLibraryError(requestError instanceof Error ? requestError.message : "No se pudo borrar el viaje.");
    } finally {
      if (mounted.current) setDeletingId("");
    }
  }
  async function setTripCompleted(trip: SavedTrip, completed: boolean) {
    try {
      await jsonRequest(`/api/itineraries?id=${encodeURIComponent(trip.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed }) });
      if (mounted.current) setSavedTrips((previous) => previous.map((item) => item.id === trip.id ? { ...item, completed } : item));
    } catch (requestError) {
      if (mounted.current) setLibraryError(requestError instanceof Error ? requestError.message : "No se pudo actualizar el estado.");
    }
  }
  async function addManualCountry(country?: string) {
    const target = country || manualCountry;
    if (!target || manualVisitedCountries.includes(target)) return;
    const countries = [...manualVisitedCountries, target];
    try {
      const data = await jsonRequest("/api/visited-countries", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ countries }) });
      if (mounted.current) { setManualVisitedCountries(data.countries); setManualCountry(""); }
    } catch (requestError) {
      if (mounted.current) setLibraryError(requestError instanceof Error ? requestError.message : "No se pudo añadir el país.");
    }
  }
  const locked = busy || saving;
  const countries = [...new Set(worldCatalog.entries.filter((entry) => entry.continent === settings.continent).map((entry) => entry.country))].sort((a, b) => a.localeCompare(b, "es"));
  const cities = [...new Set(worldCatalog.entries.filter((entry) => entry.continent === settings.continent && entry.country === settings.country).map((entry) => entry.city))].sort((a, b) => a.localeCompare(b, "es"));
  const completedCountries = savedTrips.filter((trip) => trip.completed && trip.trip).map((trip) => trip.trip?.settings.country || "");
  const visitedCountries = [...new Set([...completedCountries, ...manualVisitedCountries].filter(Boolean))];
  const availableManualCountries = [...new Set(worldCatalog.entries.map((entry) => entry.country))].sort((a, b) => a.localeCompare(b, "es"));

  return <main className="app-shell">
    <nav className="topbar" aria-label="Navegación principal">
      <button className="brand brand-button" onClick={() => navigate("home")} disabled={locked}><span className="brand-mark">✦</span> ruta / <strong>AI</strong></button>
      <div className="topbar-meta">
        <button className={`nav-button ${screen === "trips" ? "active" : ""}`} onClick={() => navigate("trips")} disabled={locked}>Mis viajes</button>
        <span className="user-label">{userName}</span>
        <button className="auth-button" onClick={() => void signOut({ callbackUrl: "/" })} disabled={locked}>Salir</button>
      </div>
    </nav>
    {screen === "home" && <Landing authenticated onContinue={() => navigate("planner")} />}
    {screen !== "home" && <div className="screen-toolbar">
      <button className="back-button" disabled={locked} onClick={() => navigate(screen === "itinerary" ? "planner" : "home")}>← {screen === "itinerary" ? "Modificar filtros" : "Volver a portada"}</button>
      <span className="section-kicker">{screen === "planner" ? "01 / El punto de partida" : screen === "itinerary" ? "02 / Tu itinerario" : "Tu colección"}</span>
    </div>}
    {screen === "planner" && <section className="planner-screen">
      <form className="planner-card" onSubmit={createItinerary}>
        <div className="card-heading"><div><span className="section-kicker">El punto de partida</span><h2 ref={heading} tabIndex={-1}>Diseña tu viaje</h2></div><span className="sparkle">✦</span></div>
        <fieldset disabled={locked} className="planner-fields">
          <div className="field-row">
            <label className="field"><span>Continente</span><select required value={settings.continent} onChange={(event) => update("continent", event.target.value)}><option value="">-- Selecciona un continente --</option>{worldCatalog.continents.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>País</span><select required value={settings.country} onChange={(event) => update("country", event.target.value)}><option value="">-- Selecciona un país --</option>{countries.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </div>
          <div className="field-row">
            <label className="field"><span>Ciudad</span><select required value={settings.city} onChange={(event) => update("city", event.target.value)}><option value="">-- Selecciona una ciudad --</option>{!cities.some((item) => item === settings.city) && settings.city && <option>{settings.city}</option>}{cities.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <label className="field"><span>Hotel base del viaje</span><input value={settings.hotel} onChange={(event) => update("hotel", event.target.value)} placeholder="Nombre o dirección del hotel" maxLength={300} /></label>
          <div className="field-row">
            <label className="field"><span>Fecha de llegada</span><input required type="date" value={settings.startDate} onChange={(event) => update("startDate", event.target.value)} /></label>
            <label className="field"><span>Fecha de salida</span><input required type="date" min={settings.startDate} value={settings.endDate} onChange={(event) => update("endDate", event.target.value)} /></label>
          </div>
          <div className="field-row">
            <label className="field"><span>Hora de llegada (local)</span><input required type="time" value={settings.arrival} onChange={(event) => update("arrival", event.target.value)} /></label>
            <label className="field"><span>Hora de salida (local)</span><input required type="time" value={settings.departure} onChange={(event) => update("departure", event.target.value)} /></label>
          </div>
          <p className="schedule-help">Solo habrá planes entre tu llegada y tu salida, incluida la duración de cada actividad. Máximo 30 días.</p>
          <div className="field-row">
            <label className="field"><span>Duración</span><input value={duration} readOnly /></label>
            <label className="field"><span>Presupuesto</span><select required value={settings.budget} onChange={(event) => update("budget", event.target.value)}><option value="">-- Selecciona un presupuesto --</option><option>Reducido</option><option>Medio</option><option>Sin límite</option></select></label>
          </div>
          <div className="choice-block"><span className="field-label">Quiero recomendaciones de...</span><div className="interest-grid">{interests.map((interest) => <button type="button" aria-pressed={settings.interests.includes(interest)} className={`interest ${settings.interests.includes(interest) ? "selected" : ""}`} key={interest} onClick={() => update("interests", settings.interests.includes(interest) ? settings.interests.filter((item) => item !== interest) : [...settings.interests, interest])}>{interest}<span aria-hidden="true">{settings.interests.includes(interest) ? "✓" : "+"}</span></button>)}</div></div>
          <div className="choice-block"><span className="field-label">Ritmo del viaje</span><div className="choices">{["Pausado", "Equilibrado", "Intenso"].map((option) => <button type="button" aria-pressed={settings.pace === option} className={`choice ${settings.pace === option ? "selected" : ""}`} key={option} onClick={() => update("pace", option)}>{option}</button>)}</div></div>
          <label className="transport-toggle"><input type="checkbox" checked={settings.includePublicTransport} onChange={(event) => update("includePublicTransport", event.target.checked)} /><span>Incluir traslados con transporte público en los itinerarios diarios</span></label>
          <label className="field"><span>Un detalle para hacerlo tuyo <small>opcional</small></span><textarea value={settings.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Ej. Me encantan los mercados, viajo con mi madre..." rows={3} maxLength={3000} /></label>
        </fieldset>
        <div className="quota-banner">Cuota diaria: {remaining === null ? "No disponible" : `${remaining} generaciones restantes de 5`}</div>
        <button className="submit-button" type="submit" disabled={locked || remaining === 0}>{busy ? <><PlaneSpinner /> <span className="loading-label">Trazando y validando tu ruta...</span></> : <>Planificar el viaje<span aria-hidden="true">↗</span></>}</button>
        {current && <button className="back-button resume-button" type="button" disabled={locked} onClick={() => navigate("itinerary")}>Volver al itinerario sin aplicar cambios →</button>}
        {error && <p role="alert" className="error-message">{error}</p>}
        {notice && <p role="status" className="notice-message">{notice}</p>}
        <p className="privacy-note">Tus rutas se guardan en tu cuenta al pulsar el corazón.</p>
      </form>
    </section>}
    {screen === "itinerary" && current && <section className="itinerary-screen itinerary-panel">
      <div className="panel-heading">
        <div><span className="section-kicker">Tu ruta, a tu ritmo</span><h2 ref={heading} tabIndex={-1}>{current.settings.city}</h2><p className="route-subtitle">{dateLabel(current.settings.startDate)} · {current.settings.arrival} → {dateLabel(current.settings.endDate)} · {current.settings.departure}<br />Base: {current.settings.hotel || "Sin hotel definido"} · Horas locales del destino</p></div>
        <button className={`icon-button save-button ${current.savedId ? "is-saved" : ""}`} onClick={() => void saveTrip()} disabled={locked || Boolean(current.savedId)} aria-label={current.savedId ? "Itinerario guardado en tu cuenta" : saving ? "Guardando itinerario" : "Guardar itinerario"} aria-pressed={Boolean(current.savedId)} title={current.savedId ? "Guardado en tu cuenta" : "Guardar en mi cuenta"}><Heart filled={Boolean(current.savedId)} /><span>Guardar</span></button>
      </div>
      <p className="route-meta"><span>{current.itinerary.length} días</span><i /><span>{current.settings.interests.length} intereses</span><i /><span>{current.settings.pace}</span></p>
      {error && <p role="alert" className="error-message feedback-banner">{error}</p>}
      {notice && <p role="status" className="notice-message feedback-banner">{notice}</p>}
      {current.savedId && <p className="saved-confirmation" role="status">♥ Guardado en tu cuenta</p>}
      {current.sourceImageUrl ? <figure className="destination-figure">
        {/* Authenticated same-origin image: Next's image optimizer cannot forward the session cookie. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="destination-photo" src={current.sourceImageUrl} alt={`Imagen postal de ${current.settings.city}, ${current.settings.country}`} onError={() => { setCurrent((previous) => previous ? { ...previous, sourceImageUrl: "" } : previous); }} />
        <figcaption>{current.settings.city}, {current.settings.country} · Imagen postal del catálogo.</figcaption>
      </figure> : null}
      {current.generalInfo && <section className="general-info-box"><span className="section-kicker">Información general</span><p><strong>Transporte:</strong> {current.generalInfo.publicTransport}</p><p><strong>Taxi:</strong> {current.generalInfo.taxiApps}</p><div className="general-info-columns"><div><h3>Restaurantes</h3><ul>{current.generalInfo.restaurants.map((item) => <li key={item.name}><strong>{item.name}</strong><span>{item.description}</span></li>)}</ul></div><div><h3>Platos típicos</h3><ul>{current.generalInfo.dishes.map((item) => <li key={item.name}><strong>{item.name}</strong><span>{item.description}</span></li>)}</ul></div></div><p><strong>Moneda:</strong> {current.generalInfo.currency}. {current.generalInfo.euroConversion}</p></section>}
      <div className="day-list">{current.itinerary.map((day, index) => <article className="day-card" key={day.date}>
        <div className="day-marker"><span>{String(index + 1).padStart(2, "0")}</span><div /></div>
        <div className="day-content">
          <div className="day-title"><div><span>{day.day} · {dateLabel(day.date)}</span><h3>{day.title}</h3><p>{day.mood}</p></div></div>
          {day.stops.length ? <ul>{day.stops.map((stop, stopIndex) => <li key={`${stop.time}-${stopIndex}`}><b>{stop.time}–{stop.endTime}</b><span>{stop.activity}{stop.place && <small className="stop-place">{stop.place}{stop.address ? ` · ${stop.address}` : ""}</small>}{(stop.transportType || stop.station || stop.estimatedCost) && <small className="stop-place transport-detail">{stop.transportType || "Traslado"}{stop.station ? ` · Estación: ${stop.station}` : ""}{stop.estimatedCost ? ` · Billete aprox.: ${stop.estimatedCost}` : ""}</small>}</span></li>)}</ul> : <p className="empty-state">Sin actividades programadas en este tramo. Se respeta tu horario de llegada o salida.</p>}
          {day.stops.length > 0 && <DayMap day={day} settings={current.settings} />}
        </div>
      </article>)}</div>
      <form className="adjust-box" onSubmit={correctDay}>
        <span className="section-kicker">Ajusta un día</span><h3>¿Cambiarías algo?</h3>
        <p>Solo se recalculará el día que elijas. El resto del itinerario, tus fechas y tus horas de llegada y salida se mantienen intactos.</p>
        <label className="field"><span>Día que quieres corregir</span><select value={dayIndex} disabled={locked} onChange={(event) => setDayIndex(Number(event.target.value))}>{current.itinerary.map((day, index) => <option key={day.date} value={index}>{day.day} · {dateLabel(day.date)} — {day.title}</option>)}</select></label>
        <div className="adjust-row"><input aria-label="Corrección del día seleccionado" value={adjustment} disabled={locked} maxLength={2000} onChange={(event) => setAdjustment(event.target.value)} placeholder="Ej. Sustituye el museo por un paseo..." /><button type="submit" disabled={!adjustment.trim() || locked || remaining === 0}>{busy ? "Validando el día..." : `Recalcular día ${dayIndex + 1} ↗`}</button></div>
        <p className="adjust-quota">Cada corrección consume una generación. {remaining !== null && `${remaining} disponibles hoy.`}</p>
      </form>
      <div className="gemini-note"><span>✦</span><div><strong>Una nota de tu copiloto</strong><p>Los horarios están limitados a tu estancia. Confirma aperturas y disponibilidad de las visitas guiadas antes de reservar.</p></div></div>
    </section>}
    {screen === "trips" && <section className="library-screen">
      <div className="saved-heading"><div><span className="section-kicker">Guardados en tu cuenta</span><h2 ref={heading} tabIndex={-1}>Mis viajes</h2></div><button className="saved-open-button" disabled={locked} onClick={() => navigate("planner")}>Planificar un viaje ↗</button></div>
      <div className="trip-tabs" role="tablist"><button className={tripSection === "pending" ? "active" : ""} onClick={() => setTripSection("pending")} role="tab" aria-selected={tripSection === "pending"}>Pendientes ({savedTrips.filter((trip) => !trip.completed).length})</button><button className={tripSection === "completed" ? "active" : ""} onClick={() => setTripSection("completed")} role="tab" aria-selected={tripSection === "completed"}>Realizados ({savedTrips.filter((trip) => trip.completed).length})</button></div>
      <p className="library-copy">Tus viajes permanecen aquí aunque cierres sesión. Vuelve a entrar con la misma cuenta de Google para recuperarlos.</p>
      {current && <button className="back-button" onClick={() => navigate("itinerary")}>← Volver al itinerario actual</button>}
      {libraryLoading && <p role="status" className="empty-state">Cargando tus viajes...</p>}
      {libraryError && <div role="alert" className="error-message feedback-banner">{libraryError}<button className="back-button" onClick={() => void loadTrips()}>Reintentar carga</button></div>}
      {!libraryLoading && !libraryError && savedTrips.length === 0 && <p className="empty-state">Todavía no tienes viajes guardados. Pulsa el corazón de un itinerario para añadirlo.</p>}
      {tripSection === "completed" && <section className="visited-section"><div className="visited-stats"><strong>{visitedCountries.length}</strong><span>países visitados</span><b>{Math.round((visitedCountries.length / 195) * 100)}%</b><span>del mundo</span></div><WorldMap visited={visitedCountries} onAddCountry={(country) => void addManualCountry(country)} /><div className="manual-country"><label className="field"><span>Añadir un país visitado anteriormente</span><select value={manualCountry} onChange={(event) => setManualCountry(event.target.value)}><option value="">-- Selecciona un país --</option>{availableManualCountries.filter((country) => !manualVisitedCountries.includes(country)).map((country) => <option key={country}>{country}</option>)}</select></label><button className="back-button" onClick={() => void addManualCountry()} disabled={!manualCountry}>Añadir país</button></div></section>}
      <div className="trip-card-grid">{savedTrips.filter((trip) => trip.completed === (tripSection === "completed")).map((trip, index) => {
        const image = savedTripImage(trip);
        return <article className="trip-card" key={trip.id} style={{ "--trip-color": savedTripColor(index) } as React.CSSProperties}>
          <div className="trip-card-visual" style={image ? { backgroundImage: `url("${image}")` } : undefined}><span>{trip.completed ? "Realizado" : "Pendiente"}</span></div>
          <div className="trip-card-body"><small>{trip.subtitle}</small><h3>{trip.title}</h3><p>{trip.destination}</p>{!trip.trip && <p>Versión antigua: faltan fechas u horarios completos.</p>}<div className="trip-card-actions"><button onClick={() => openTrip(trip)} disabled={Boolean(deletingId)}>{trip.trip ? "Ver viaje ↗" : "Completar datos ↗"}</button><label className="status-check"><input type="checkbox" checked={trip.completed} onChange={(event) => void setTripCompleted(trip, event.target.checked)} /> Realizado</label>{deleteCandidate === trip.id ? <><button className="delete-button" disabled={Boolean(deletingId)} onClick={() => void deleteTrip(trip.id)}>{deletingId === trip.id ? "Borrando..." : "Confirmar borrado"}</button><button disabled={Boolean(deletingId)} onClick={() => setDeleteCandidate("")}>Cancelar</button></> : <button className="delete-button" disabled={Boolean(deletingId)} onClick={() => setDeleteCandidate(trip.id)} aria-label={`Borrar viaje a ${trip.title}`}>Borrar</button>}</div></div>
        </article>;
      })}</div>
    </section>}
    <Footer />
  </main>;
}

function DayMap({ day, settings }: { day: Day; settings: TripSettings }) {
  const places = day.stops.filter((stop) => stop.place && !/llegada|traslado|check-in|hotel/i.test(stop.activity));
  if (!places.length) return null;
  const location = (stop: Day["stops"][number]) => `${stop.place}, ${stop.address || settings.city}, ${settings.country}`;
  const origin = `${settings.hotel || settings.city}, ${settings.city}, ${settings.country}`;
  const destination = location(places[places.length - 1]);
  const waypoints = places.slice(0, -1).slice(0, 8).map(location).join("|");
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "walking", ...(waypoints ? { waypoints } : {}) });
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const embedParams = new URLSearchParams({ key: mapsKey || "", origin, destination, mode: "walking", ...(waypoints ? { waypoints } : {}) });
  const embed = mapsKey && !mapsKey.includes("pega_aqui") ? `https://www.google.com/maps/embed/v1/directions?${embedParams}` : `https://www.google.com/maps?q=${encodeURIComponent(location(places[0]))}&output=embed`;
  return <div className="day-map"><div className="day-map-heading"><div><span className="section-kicker">Ruta andando</span><strong>Desde {settings.hotel || settings.city} · {places.length} paradas</strong></div><a href={`https://www.google.com/maps/dir/?${params}`} target="_blank" rel="noreferrer">Abrir / exportar ↗</a></div><iframe title={`Ruta andando del ${day.day}`} src={embed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>;
}