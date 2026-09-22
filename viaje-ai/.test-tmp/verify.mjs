// Single-script verification of the real schedule-enforcement logic.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const ts = require(path.join(root, "node_modules/typescript/lib/typescript.js"));
const source = fs.readFileSync(path.join(root, "src/lib/itinerary.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", js)(require, mod, mod.exports);
const { tripDates, dayBounds, validateDay, replaceDay, validateItinerary, ValidationError } = mod.exports;

const window = { startDate: "2026-10-12", endDate: "2026-10-14", arrival: "10:30", departure: "18:00" };
let passed = 0, failed = 0;
const check = (ok, label) => { ok ? passed++ : failed++; console.log(`${ok ? "  ok  " : "  FAIL"} ${label}`); };
const rejects = (fn, label) => { try { fn(); check(false, label + " (no error thrown)"); } catch (e) { check(e instanceof ValidationError, `${label} → "${e.message.slice(0, 60)}"`); } };
const day = (date, from, to) => ({ date, title: "Día", mood: "ok", stops: [{ time: from, endTime: to, activity: "Paseo", place: "Praça", address: "Lisboa" }] });

// 1. Dates
check(JSON.stringify(tripDates(window)) === JSON.stringify(["2026-10-12", "2026-10-13", "2026-10-14"]), "tripDates: 3 días exactos 12–14 oct");
rejects(() => tripDates({ ...window, endDate: "2026-10-12", departure: "09:00" }), "salida ≤ llegada el mismo día se rechaza");
rejects(() => tripDates({ ...window, startDate: "2026-02-30" }), "fecha inexistente se rechaza");

// 2. Day bounds
const b0 = dayBounds(window, 0), b2 = dayBounds(window, 2);
check(b0.from === "10:30" && b0.date === "2026-10-12", "día 1 acotado por la hora de llegada (10:30)");
check(b2.to === "18:00" && b2.date === "2026-10-14", "último día acotado por la hora de salida (18:00)");
check(dayBounds(window, 1).from === "00:00" && dayBounds(window, 1).to === "23:59", "día intermedio: día completo");
rejects(() => dayBounds(window, 3), "índice fuera del viaje se rechaza");

// 3. validateDay enforces arrival/departure, order, overlaps, date
check(validateDay(day("2026-10-12", "10:30", "13:00"), window, 0).stops[0].time === "10:30", "actividad que empieza justo a la llegada es válida");
rejects(() => validateDay(day("2026-10-12", "08:00", "13:00"), window, 0), "actividad antes de la llegada se rechaza");
rejects(() => validateDay(day("2026-10-14", "16:00", "19:00"), window, 2), "actividad que termina tras la salida se rechaza");
rejects(() => validateDay(day("2026-10-13", "09:00", "20:00"), window, 0), "día con fecha equivocada se rechaza");
rejects(() => validateDay({ ...day("2026-10-13", "09:00", "12:00"), stops: [{ time: "09:00", endTime: "12:00", activity: "a" }, { time: "10:00", endTime: "11:00", activity: "b" }] }, window, 1), "solapamiento se rechaza");
rejects(() => validateDay({ ...day("2026-10-13", "09:00", "12:00"), stops: [{ time: "09:00", endTime: "12:00", activity: "a" }, { time: "08:00", endTime: "08:30", activity: "b" }] }, window, 1), "orden no cronológico se rechaza");
check(validateDay({ date: "2026-10-13", title: "t", mood: "m", stops: [] }, window, 1).stops.length === 0, "día sin actividades (llegada tardía/salida temprana) es válido");

// 4. replaceDay touches ONLY the selected day
const original = [
  day("2026-10-12", "11:00", "13:00"),
  day("2026-10-13", "09:00", "20:00"),
  day("2026-10-14", "09:00", "17:00"),
];
const merged = replaceDay(original, day("2026-10-13", "12:00", "15:00"), window, 1);
check(merged.length === 3, "replaceDay mantiene 3 días");
check(merged[0].stops[0].time === "11:00" && merged[2].stops[0].time === "09:00", "días 1 y 3 intactos (mismos horarios)");
check(JSON.stringify(merged[0]) === JSON.stringify(original[0]) && JSON.stringify(merged[2]) === JSON.stringify(original[2]), "días 1 y 3 idénticos objeto a objeto");
check(merged[1].stops[0].time === "12:00" && merged[1].stops[0].endTime === "15:00", "solo el día 2 se sustituye");
rejects(() => replaceDay(original, day("2026-10-13", "12:00", "19:30"), window, 2), "no se puede colar el día corregido en otro índice");

// 5. validateItinerary requires exactly the trip dates
check(validateItinerary(original, window).length === 3, "itinerario completo válido");
const partial = validateItinerary(original.slice(0, 2), window);
check(partial.length === 3 && partial[2].date === "2026-10-14" && partial[2].stops.length === 0, "itinerario con días de menos se autorrellena en vez de rechazarse");
rejects(() => validateItinerary("no es una lista", window), "itinerario que no es un array se rechaza");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);