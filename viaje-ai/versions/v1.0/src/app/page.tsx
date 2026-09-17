"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

type Stop = { time: string; activity: string; place?: string; address?: string };
type Day = { day: string; title: string; mood: string; stops: Stop[] };
type SavedTrip = { id: number; title: string; subtitle: string; destination: string; itinerary: Day[] };

const europe = {
  Portugal: ["Lisboa", "Oporto", "Faro", "Braga", "Coímbra"], Spain: ["Barcelona", "Madrid", "Sevilla", "Valencia", "Málaga", "Bilbao", "Granada"],
  Italy: ["Roma", "Florencia", "Milán", "Nápoles", "Venecia", "Bolonia", "Turín"], France: ["París", "Lyon", "Niza", "Burdeos", "Marsella", "Estrasburgo"],
  Greece: ["Atenas", "Santorini", "Tesalónica", "Miconos", "Creta"], Netherlands: ["Ámsterdam", "Róterdam", "Utrecht", "La Haya"],
  Germany: ["Berlín", "Múnich", "Hamburgo", "Colonia", "Fráncfort"], UnitedKingdom: ["Londres", "Edimburgo", "Manchester", "Liverpool", "Bath"],
  Austria: ["Viena", "Salzburgo", "Innsbruck"], Belgium: ["Bruselas", "Brujas", "Gante", "Amberes"], Switzerland: ["Zúrich", "Ginebra", "Lucerna", "Berna"],
  Ireland: ["Dublín", "Cork", "Galway"], Denmark: ["Copenhague", "Aarhus", "Odense"], Sweden: ["Estocolmo", "Gotemburgo", "Malmö"],
  Norway: ["Oslo", "Bergen", "Tromsø"], Finland: ["Helsinki", "Rovaniemi", "Turku"], Iceland: ["Reikiavik", "Akureyri"],
  Poland: ["Cracovia", "Varsovia", "Gdansk", "Wroclaw"], Czechia: ["Praga", "Brno", "Český Krumlov"], Hungary: ["Budapest", "Szeged", "Pécs"],
  Romania: ["Bucarest", "Brașov", "Sibiu", "Cluj-Napoca"], Bulgaria: ["Sofía", "Plovdiv", "Varna"], Croatia: ["Dubrovnik", "Zagreb", "Split", "Zadar"],
  Slovenia: ["Liubliana", "Bled", "Piran"], Slovakia: ["Bratislava", "Košice"], Serbia: ["Belgrado", "Novi Sad"], Montenegro: ["Kotor", "Budva", "Podgorica"],
  Estonia: ["Tallin", "Tartu"], Latvia: ["Riga", "Jūrmala"], Lithuania: ["Vilna", "Kaunas", "Klaipėda"], Luxembourg: ["Luxemburgo"],
  Malta: ["La Valeta", "Mdina", "Sliema"], Cyprus: ["Nicosia", "Limassol", "Pafos"], Turkey: ["Estambul", "Capadocia", "Esmirna"],
} as const;
const interests = ["Monumentos", "Spots fotográficos", "Cafeterías", "Foodies", "Museos", "Free tours", "Actividades", "Galerías de arte", "Vida nocturna", "Compras"];
const exampleDays: Day[] = [
  { day: "Día 01", title: "Llegada con calma", mood: "Aterrizar sin prisa", stops: [{ time: "10:30", activity: "Llegada y traslado al hotel", place: "Memmo Príncipe Real" }, { time: "13:00", activity: "Almuerzo en el mercado", place: "Time Out Market Lisboa", address: "Av. 24 de Julho 49, Lisboa" }, { time: "18:30", activity: "Paseo al atardecer", place: "Miradouro de Santa Catarina", address: "Rua de Santa Catarina 152, Lisboa" }] },
  { day: "Día 02", title: "La ciudad a pie", mood: "Historia, diseño y sobremesa", stops: [{ time: "09:00", activity: "Desayuno", place: "Fabrica Coffee Roasters", address: "Rua das Portas de Santo Antão 136, Lisboa" }, { time: "11:00", activity: "Visita al museo", place: "Museu Nacional do Azulejo", address: "Rua da Madre de Deus 4, Lisboa" }, { time: "15:30", activity: "Ruta de galerías y librerías", place: "Rua Garrett, Chiado, Lisboa" }, { time: "20:00", activity: "Cena de cocina local", place: "Taberna da Rua das Flores", address: "Rua das Flores 103, Lisboa" }] },
  { day: "Día 03", title: "Una última postal", mood: "Arquitectura y río", stops: [{ time: "08:00", activity: "Paseo monumental", place: "Torre de Belém", address: "Av. Brasília, Lisboa" }, { time: "13:30", activity: "Comida junto al río", place: "Pão Pão Queijo Queijo", address: "Rua de Belém 126, Lisboa" }, { time: "17:00", activity: "Último paseo y compras", place: "LX Factory", address: "Rua Rodrigues de Faria 103, Lisboa" }] },
];

function dateLabel(date: string) { return date ? new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00`)) : "Sin fecha"; }

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();
  const [country, setCountry] = useState<keyof typeof europe>("Portugal");
  const [city, setCity] = useState("Lisboa");
  const [startDate, setStartDate] = useState("2026-10-12");
  const [endDate, setEndDate] = useState("2026-10-15");
  const [arrival, setArrival] = useState("10:30");
  const [departure, setDeparture] = useState("18:00");
  const [hotel, setHotel] = useState("Memmo Príncipe Real");
  const [days, setDays] = useState("3");
  const [budget, setBudget] = useState("Medio");
  const [pace, setPace] = useState("Equilibrado");
  const [selectedInterests, setSelectedInterests] = useState<string[]>(["Monumentos", "Cafeterías", "Foodies", "Museos"]);
  const [notes, setNotes] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [itinerary, setItinerary] = useState<Day[]>(exampleDays);
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = window.localStorage.getItem("ruta-ai-trips");
    return stored ? JSON.parse(stored) as SavedTrip[] : [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [destinationImage, setDestinationImage] = useState("");
  const cities = useMemo(() => europe[country], [country]);
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/place-image?q=${encodeURIComponent(`${city}, ${country}, famous landmark`)}`)
      .then((response) => response.json() as Promise<{ url?: string | null }>)
      .then((data) => { if (!cancelled) setDestinationImage(data.url || ""); })
      .catch(() => { if (!cancelled) setDestinationImage(""); });
    return () => { cancelled = true; };
  }, [city, country]);

  function changeCountry(value: keyof typeof europe) { setCountry(value); setCity(europe[value][0]); }
  function toggleInterest(interest: string) { setSelectedInterests((current) => current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest]); }
  function saveTrip() { const trip = { id: Date.now(), title: city, subtitle: `${dateLabel(startDate)} — ${dateLabel(endDate)}`, destination: `${city}, ${country}`, itinerary }; const next = [trip, ...savedTrips]; setSavedTrips(next); window.localStorage.setItem("ruta-ai-trips", JSON.stringify(next)); }
  function routePlaces(day: Day) { return day.stops.filter((stop) => stop.place && !/llegada|traslado|check-in|hotel/i.test(stop.activity)); }
  function dayMapUrl(day: Day) {
    const places = routePlaces(day);
    const origin = encodeURIComponent(`${hotel}, ${city}, ${country}`);
    const destination = encodeURIComponent(`${places[places.length - 1]?.place || city}, ${places[places.length - 1]?.address || city}, ${country}`);
    const waypoints = places.slice(0, -1).map((place) => encodeURIComponent(`${place.place}, ${place.address || city}, ${country}`)).join("|");
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ""}&travelmode=walking`;
  }
  function dayMapEmbedUrl(day: Day) {
    const places = routePlaces(day);
    const origin = encodeURIComponent(`${hotel}, ${city}, ${country}`);
    const destination = encodeURIComponent(`${places[places.length - 1]?.place || city}, ${places[places.length - 1]?.address || city}, ${country}`);
    const waypoints = places.slice(0, -1).map((place) => encodeURIComponent(`${place.place}, ${place.address || city}, ${country}`)).join("|");
    if (mapsKey && !mapsKey.includes("pega_aqui")) return `https://www.google.com/maps/embed/v1/directions?key=${mapsKey}&origin=${origin}&destination=${destination}&waypoints=${waypoints}&mode=walking`;
    return `https://www.google.com/maps?q=${destination}&output=embed`;
  }

  async function createItinerary(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault(); setIsLoading(true); setError("");
    try {
      if (!session) { await signIn("google"); return; }
      const response = await fetch("/api/itinerary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination: `${city}, ${country}`, days, startDate, endDate, arrival, departure, hotel, interests: selectedInterests, budget, pace, notes, adjustment }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "No se pudo crear el itinerario."); setItinerary(data.itinerary); setAdjustment("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Algo salió mal."); } finally { setIsLoading(false); }
  }

  return <main className="app-shell">
    <nav className="topbar"><a className="brand" href="#top"><span className="brand-mark">✦</span> ruta / <strong>AI</strong></a><div className="topbar-meta"><span className="status-dot" /> Gemini travel studio <span className="topbar-divider" /> {session?.user ? <><span className="user-label">{session.user.name || session.user.email}</span><button className="auth-button" onClick={() => signOut()}>Salir</button></> : <button className="auth-button" onClick={() => signIn("google")}>{sessionStatus === "loading" ? "Cargando..." : "Entrar con Google"}</button>}</div></nav>
    <section className="intro" id="top"><div className="eyebrow"><span /> Tu próximo capítulo empieza aquí</div><h1>Viaja con una historia<br /><em>hecha para ti.</em></h1><p className="intro-copy">Dile a Gemini qué te mueve. Nosotros convertimos tus días libres en una ruta con ritmo, sabor y espacio para descubrir.</p></section>
    <section className="workspace">
      <form className="planner-card" onSubmit={createItinerary}><div className="card-heading"><div><span className="section-kicker">01 / El punto de partida</span><h2>Diseña tu viaje</h2></div><span className="sparkle">✦</span></div>
        <div className="field-row"><label className="field"><span>País</span><select value={country} onChange={(event) => changeCountry(event.target.value as keyof typeof europe)}>{Object.keys(europe).map((item) => <option key={item} value={item}>{item === "UnitedKingdom" ? "Reino Unido" : item}</option>)}</select></label><label className="field"><span>Ciudad</span><select value={city} onChange={(event) => setCity(event.target.value)}>{cities.map((item) => <option key={item}>{item}</option>)}</select></label></div>
        <label className="field"><span>Hotel base del viaje</span><input value={hotel} onChange={(event) => setHotel(event.target.value)} placeholder="Nombre o dirección del hotel" /></label>
        <div className="field-row"><label className="field"><span>Fecha de llegada</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label className="field"><span>Fecha de salida</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
        <div className="field-row"><label className="field"><span>Hora de llegada</span><input type="time" value={arrival} onChange={(event) => setArrival(event.target.value)} /></label><label className="field"><span>Hora de salida</span><input type="time" value={departure} onChange={(event) => setDeparture(event.target.value)} /></label></div>
        <div className="field-row"><label className="field"><span>Días</span><select value={days} onChange={(event) => setDays(event.target.value)}>{["2", "3", "4", "5", "7", "10"].map((value) => <option key={value}>{value} días</option>)}</select></label><label className="field"><span>Presupuesto</span><select value={budget} onChange={(event) => setBudget(event.target.value)}><option>Esencial</option><option>Medio</option><option>Sin límite</option></select></label></div>
        <div className="choice-block"><span className="field-label">Quiero recomendaciones de...</span><div className="interest-grid">{interests.map((interest) => <button type="button" className={`interest ${selectedInterests.includes(interest) ? "selected" : ""}`} key={interest} onClick={() => toggleInterest(interest)}>{interest}<span>{selectedInterests.includes(interest) ? "✓" : "+"}</span></button>)}</div></div>
        <div className="choice-block"><span className="field-label">Ritmo del viaje</span><div className="choices">{["Pausado", "Equilibrado", "Intenso"].map((option) => <button type="button" className={`choice ${pace === option ? "selected" : ""}`} key={option} onClick={() => setPace(option)}>{option}</button>)}</div></div>
        <label className="field"><span>Un detalle para hacerlo tuyo <small>opcional</small></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej. Me encantan los mercados, viajo con mi madre..." rows={2} /></label>
        <button className="submit-button" type="submit" disabled={isLoading || sessionStatus === "loading"}>{isLoading ? "Calculando tu ruta..." : session ? "Crear mi itinerario" : "Entrar con Google para continuar"}<span>↗</span></button>{error && <p className="error-message">{error}</p>}<p className="privacy-note">✦ Diseñado con Gemini · Tus preferencias no se guardan</p>
      </form>
      <section className="itinerary-panel"><div className="panel-heading"><div><span className="section-kicker">02 / Tu ruta</span><h2>{city}</h2><p className="route-subtitle">{dateLabel(startDate)} — {dateLabel(endDate)} · base: {hotel || "tu hotel"}</p></div><button className="icon-button" onClick={saveTrip} aria-label="Guardar itinerario">♡</button></div><p className="route-meta"><span>{days}</span><i /><span>{selectedInterests.length} intereses</span><i /><span>{pace}</span></p>
        {destinationImage && <img className="destination-photo" src={destinationImage} alt={`Lugar representativo de ${city}, ${country}`} />}
        <div className="day-list">{itinerary.map((day, index) => <article className="day-card" key={`${day.day}-${index}`}><div className="day-marker"><span>{String(index + 1).padStart(2, "0")}</span><div /></div><div className="day-content"><div className="day-title"><div><span>{day.day}</span><h3>{day.title}</h3><p>{day.mood}</p></div><span className="day-arrow">↗</span></div><ul>{day.stops.map((stop) => <li key={`${stop.time}-${stop.activity}`}><b>{stop.time}</b> {stop.activity}{stop.place && <small className="stop-place"> · {stop.place}{stop.address ? `, ${stop.address}` : ""}</small>}</li>)}</ul><div className="day-map"><div className="day-map-heading"><div><span className="section-kicker">Ruta andando</span><strong>Desde {hotel || "tu hotel"} · {routePlaces(day).length} paradas</strong></div><a href={dayMapUrl(day)} target="_blank" rel="noreferrer">Abrir / exportar ↗</a></div><iframe title={`Ruta andando del ${day.day}`} src={dayMapEmbedUrl(day)} loading="lazy" /></div></div></article>)}</div>
        <div className="adjust-box"><span className="section-kicker">04 / Ajusta tu ruta</span><h3>¿Cambiarías algo?</h3><p>Escribe una petición y Gemini recalculará el itinerario manteniendo tus fechas y hotel.</p><div className="adjust-row"><input value={adjustment} onChange={(event) => setAdjustment(event.target.value)} placeholder="Ej. Cambia el museo por más vida nocturna..." /><button type="button" onClick={() => createItinerary()} disabled={!adjustment || isLoading}>Recalcular ↗</button></div></div>
        <div className="gemini-note"><span>✦</span><div><strong>Una nota de tu copiloto</strong><p>He dejado huecos para que el viaje respire. Los mejores recuerdos rara vez caben en una agenda llena.</p></div></div>
      </section>
    </section>
    <section className="saved-trips"><div className="saved-heading"><div><span className="section-kicker">05 / Tu colección</span><h2>Mis viajes</h2></div><span>{savedTrips.length} guardados</span></div>{savedTrips.length === 0 ? <p className="empty-state">Pulsa ♡ en una ruta para guardarla aquí.</p> : <div className="saved-grid">{savedTrips.map((trip) => <article className="saved-trip" key={trip.id}><span>✦</span><strong>{trip.title}</strong><small>{trip.subtitle}</small><p>{trip.destination}</p></article>)}</div>}</section>
    <footer><span>ruta / AI</span><span>Para curiosos, caminantes y sobremesas largas.</span><span>© 2026</span></footer>
  </main>;
}
