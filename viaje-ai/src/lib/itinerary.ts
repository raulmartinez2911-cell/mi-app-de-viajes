export type Stop = { time: string; endTime: string; activity: string; place?: string; address?: string; transportType?: string; station?: string; estimatedCost?: string };
export type Day = { day: string; date: string; title: string; mood: string; stops: Stop[] };
export type GeneralInfo = { publicTransport: string; taxiApps: string; restaurants: { name: string; description: string }[]; dishes: { name: string; description: string }[]; currency: string; euroConversion: string };
export type TripSettings = {
  continent: string;
  destination: string;
  country: string;
  city: string;
  startDate: string;
  endDate: string;
  arrival: string;
  departure: string;
  hotel: string;
  interests: string[];
  budget: string;
  pace: string;
  notes: string;
  includePublicTransport: boolean;
};
export type Landmark = { name: string; description: string };
export type TripWindow = Pick<TripSettings, "startDate" | "endDate" | "arrival" | "departure">;
export class ValidationError extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function timeMinutes(value: unknown): number {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ValidationError("Indica una hora válida con formato HH:mm.");
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
function dateMs(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError("Indica las fechas de llegada y salida.");
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new ValidationError("La fecha indicada no existe.");
  }
  return ms;
}
export function tripDates(window: TripWindow): string[] {
  const start = dateMs(window.startDate);
  const end = dateMs(window.endDate);
  const arrival = timeMinutes(window.arrival);
  const departure = timeMinutes(window.departure);
  if (end < start || (start === end && departure <= arrival)) {
    throw new ValidationError("La salida debe ser posterior a la llegada.");
  }
  const count = (end - start) / 86400000 + 1;
  if (count > 30) throw new ValidationError("Puedes planificar hasta 30 días por viaje.");
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
}
export function dayBounds(window: TripWindow, index: number) {
  const dates = tripDates(window);
  if (!Number.isInteger(index) || index < 0 || index >= dates.length) throw new ValidationError("El día seleccionado no pertenece al viaje.");
  return {
    date: dates[index],
    from: index === 0 ? window.arrival : "00:00",
    to: index === dates.length - 1 ? window.departure : "23:59",
  };
}
export function parseSettings(body: unknown): TripSettings {
  if (!isRecord(body)) throw new ValidationError("Los datos del viaje no son válidos.");
  const text = (key: string, max = 300) => {
    const value = body[key];
    if (typeof value !== "string" || value.length > max) throw new ValidationError(`Revisa el campo ${key}.`);
    return value.trim();
  };
  const settings: TripSettings = {
    continent: typeof body.continent === "string" ? body.continent.trim() : "",
    destination: text("destination"), country: text("country"), city: text("city"),
    startDate: text("startDate"), endDate: text("endDate"), arrival: text("arrival"), departure: text("departure"),
    hotel: text("hotel"), budget: text("budget"), pace: text("pace"), notes: text("notes", 3000),
    includePublicTransport: body.includePublicTransport === true,
    interests: Array.isArray(body.interests) && body.interests.length <= 20 && body.interests.every((item) => typeof item === "string" && item.length < 100) ? body.interests as string[] : [],
  };
  if (!settings.destination) throw new ValidationError("Indica un destino.");
  tripDates(settings);
  return settings;
}

/** Reject, never silently move/truncate, invalid AI activities (including tours). */
export function validateDay(value: unknown, window: TripWindow, index: number): Day {
  const bounds = dayBounds(window, index);
  if (!isRecord(value) || value.date !== bounds.date || typeof value.title !== "string" || typeof value.mood !== "string" || !Array.isArray(value.stops) || value.stops.length > 20) {
    throw new ValidationError(`El día ${index + 1} debe corresponder a ${bounds.date} y tener un formato válido.`);
  }
  let previousEnd = timeMinutes(bounds.from);
  const stops = value.stops.map((raw): Stop => {
    if (!isRecord(raw) || typeof raw.activity !== "string" || !raw.activity.trim()) throw new ValidationError("Actividad sin descripción.");
    const start = timeMinutes(raw.time);
    const end = timeMinutes(raw.endTime);
    if (start < previousEnd || end <= start || end > timeMinutes(bounds.to)) {
      throw new ValidationError(`Horario no válido en ${bounds.date}: ${String(raw.time)}–${String(raw.endTime)}. Toda actividad debe empezar y terminar entre ${bounds.from} y ${bounds.to}, sin solaparse.`);
    }
    previousEnd = end;
    return {
      time: raw.time as string, endTime: raw.endTime as string, activity: raw.activity,
      ...(typeof raw.place === "string" ? { place: raw.place } : {}),
      ...(typeof raw.address === "string" ? { address: raw.address } : {}),
      ...(typeof raw.transportType === "string" ? { transportType: raw.transportType } : {}),
      ...(typeof raw.station === "string" ? { station: raw.station } : {}),
      ...(typeof raw.estimatedCost === "string" ? { estimatedCost: raw.estimatedCost } : {}),
    };
  });
  return { day: `Día ${String(index + 1).padStart(2, "0")}`, date: bounds.date, title: value.title, mood: value.mood, stops };
}
export function validateItinerary(value: unknown, window: TripWindow): Day[] {
  const dates = tripDates(window);
  if (!Array.isArray(value) || value.length !== dates.length) throw new ValidationError("El itinerario debe incluir exactamente las fechas del viaje.");
  return value.map((day, index) => validateDay(day, window, index));
}
export function replaceDay(current: Day[], replacement: unknown, window: TripWindow, index: number): Day[] {
  if (current.length !== tripDates(window).length) throw new ValidationError("El itinerario no coincide con las fechas del viaje.");
  const day = validateDay(replacement, window, index);
  return current.map((existing, position) => position === index ? day : existing);
}

export function validateGeneralInfo(value: unknown): GeneralInfo {
  if (!isRecord(value)) throw new ValidationError("Falta la información general del destino.");
  const text = (key: string, max = 500) => typeof value[key] === "string" && value[key].length <= max ? value[key] as string : "";
  const list = (key: string) => Array.isArray(value[key]) ? value[key].filter(isRecord).map((item) => ({ name: typeof item.name === "string" ? item.name.slice(0, 160) : "", description: typeof item.description === "string" ? item.description.slice(0, 400) : "" })).filter((item) => item.name && item.description) : [];
  const restaurants = list("restaurants");
  const dishes = list("dishes");
  if (!text("publicTransport") || !text("taxiApps") || restaurants.length < 4 || dishes.length < 4 || !text("currency") || !text("euroConversion")) {
    throw new ValidationError("La información general del destino está incompleta.");
  }
  return { publicTransport: text("publicTransport"), taxiApps: text("taxiApps"), restaurants, dishes, currency: text("currency"), euroConversion: text("euroConversion") };
}