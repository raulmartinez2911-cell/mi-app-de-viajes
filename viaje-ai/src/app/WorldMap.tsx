"use client";

import { ComposableMap, Geographies, Geography } from "react-simple-maps";
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

export default function WorldMap({ visited }: { visited: string[] }) {
  const visitedSet = new Set(visited.map((country) => (countryAliases[country] || country).toLocaleLowerCase("es")));
  return <div className="world-map" aria-label="Mapa mundial de países visitados">
    <ComposableMap projectionConfig={{ scale: 145 }}>
      <Geographies geography={worldData as unknown as string}>
        {({ geographies }) => geographies.map((geography) => {
          const name = String(geography.properties?.name || "");
          const isVisited = visitedSet.has(name.toLocaleLowerCase("es"));
          return <Geography key={geography.rsmKey} geography={geography} fill={isVisited ? colorFor(name) : "#dce3e1"} stroke="#ffffff" strokeWidth={0.5} />;
        })}
      </Geographies>
    </ComposableMap>
  </div>;
}