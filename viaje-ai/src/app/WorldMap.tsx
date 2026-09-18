"use client";

import { useState } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import worldData from "world-atlas/countries-110m.json";

const colors = ["#ef8f72", "#72a8d9", "#8ebf8a", "#c29bd7", "#e4b45f", "#5db7b0"];
const countryAliases: Record<string, string> = {
  Alemania: "Germany", España: "Spain", Francia: "France", Italia: "Italy", Portugal: "Portugal", Grecia: "Greece",
  "Países Bajos": "Netherlands", Bélgica: "Belgium", Austria: "Austria", Suiza: "Switzerland", Irlanda: "Ireland",
  Dinamarca: "Denmark", Suecia: "Sweden", Noruega: "Norway", Finlandia: "Finland", Islandia: "Iceland", Polonia: "Poland",
  "República Checa": "Czechia", Hungría: "Hungary", Rumanía: "Romania", Bulgaria: "Bulgaria", Croacia: "Croatia",
  Eslovenia: "Slovenia", Eslovaquia: "Slovakia", Serbia: "Serbia", Montenegro: "Montenegro", Estonia: "Estonia",
  Letonia: "Latvia", Lituania: "Lithuania", Luxemburgo: "Luxembourg", Malta: "Malta", Chipre: "Cyprus", Turquía: "Turkey",
};
function colorFor(country: string) {
  let total = 0;
  for (const character of country) total = (total * 31 + character.charCodeAt(0)) % colors.length;
  return colors[total];
}

export default function WorldMap({ visited, onAddCountry }: { visited: string[]; onAddCountry: (country: string) => void }) {
  const [selected, setSelected] = useState<{ name: string; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const visitedSet = new Set(visited.map((country) => (countryAliases[country] || country).toLocaleLowerCase("es")));
  const sortedVisited = [...visited].sort((a, b) => a.localeCompare(b, "es"));

  const map = <>
    <div className="world-map-toolbar">
      <p className="world-map-hint">Rueda para ampliar, arrastra para moverte, pulsa un país para añadirlo.</p>
      <button type="button" className="world-map-fullscreen-toggle" onClick={() => setFullscreen((value) => !value)}>{fullscreen ? "✕ Cerrar" : "⤢ Pantalla completa"}</button>
    </div>
    <div className="world-map">
      <ComposableMap projectionConfig={{ scale: 145 }}>
        <ZoomableGroup zoom={zoom} onMoveEnd={({ zoom: nextZoom }) => setZoom(nextZoom ?? zoom)} minZoom={1} maxZoom={8}>
          <Geographies geography={worldData as unknown as string}>
            {({ geographies }) => geographies.map((geography) => {
              const name = String(geography.properties?.name || "");
              const isVisited = visitedSet.has(name.toLocaleLowerCase("es"));
              return <Geography
                key={geography.rsmKey}
                geography={geography}
                fill={isVisited ? colorFor(name) : "#dce3e1"}
                stroke="#ffffff"
                strokeWidth={0.5}
                onClick={(event) => setSelected({ name, x: event.clientX, y: event.clientY })}
              />;
            })}
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>
    </div>
    {selected && <div className="world-map-popup" style={{ left: selected.x, top: selected.y }} role="dialog">
      <strong>{selected.name}</strong>
      <div className="world-map-popup-actions">
        <button onClick={() => { onAddCountry(selected.name); setSelected(null); }}>Añadir destino</button>
        <button onClick={() => setSelected(null)}>Cerrar</button>
      </div>
    </div>}
    <div className="world-map-summary">
      <h4>Países visitados ({sortedVisited.length})</h4>
      {sortedVisited.length ? <ul>{sortedVisited.map((country) => <li key={country}>{country}</li>)}</ul> : <p className="empty-state">Todavía no hay países marcados como visitados.</p>}
    </div>
  </>;

  if (!fullscreen) return <div aria-label="Mapa mundial de países visitados">{map}</div>;
  return <div className="world-map-overlay" role="dialog" aria-modal="true" aria-label="Mapa mundial de países visitados a pantalla completa" onClick={(event) => { if (event.target === event.currentTarget) setFullscreen(false); }}>
    <div className="world-map-overlay-panel">{map}</div>
  </div>;
}