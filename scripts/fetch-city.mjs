// Rebuild the 3D city data from OpenStreetMap with an expanded bbox that
// reaches Cheonggyecheon stream (north edge). Writes:
//   data/myeongdong-buildings.geojson  (footprints + heights)
//   data/myeongdong-streets.json       (walkable graph for routing)
//   data/myeongdong-water.json         (Cheonggyecheon polyline for rendering)
//   node scripts/fetch-city.mjs
import fs from "node:fs";

// south,west,north,east — Myeongdong + up to the stream
const BBOX = "37.5539,126.9769,37.5715,126.9939";

const QUERY = `
[out:json][timeout:120];
(
  way["building"](${BBOX});
);
out geom;
`;
const QUERY_STREETS = `
[out:json][timeout:120];
(
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|pedestrian|living_street|service|footway|path|steps)$"](${BBOX});
);
out geom;
`;
const QUERY_WATER = `
[out:json][timeout:60];
(
  way["waterway"](${BBOX});
  way["natural"="water"](${BBOX});
);
out geom;
`;

const MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
async function overpass(q) {
  for (const m of MIRRORS) {
    try {
      const r = await fetch(m, { method: "POST", body: "data=" + encodeURIComponent(q) });
      if (r.ok) return await r.json();
      console.error(m, "→", r.status);
    } catch (e) { console.error(m, "→", e.message); }
  }
  throw new Error("overpass failed");
}

// ---- buildings ----
console.log("Fetching buildings…");
const bj = await overpass(QUERY);
const LEVEL_M = 3.3;
const features = [];
for (const w of bj.elements) {
  if (!w.geometry || w.geometry.length < 4) continue;
  const t = w.tags || {};
  let h = parseFloat(t.height) || (parseFloat(t["building:levels"]) || 0) * LEVEL_M;
  if (!h) h = 8 + (w.id % 6) * 2; // typical low-rise Myeongdong shop block
  const min = parseFloat(t.min_height) || 0;
  features.push({
    type: "Feature",
    properties: { id: w.id, name: t.name || "", height: h, min_height: min },
    geometry: { type: "Polygon", coordinates: [w.geometry.map((g) => [g.lon, g.lat])] },
  });
}
fs.writeFileSync("data/myeongdong-buildings.geojson",
  JSON.stringify({ type: "FeatureCollection", features }));
console.log("buildings:", features.length);

// ---- streets ----
console.log("Fetching streets…");
const sj = await overpass(QUERY_STREETS);
const ways = [];
for (const w of sj.elements) {
  if (!w.geometry || w.geometry.length < 2) continue;
  ways.push(w.geometry.map((g, i) => [w.nodes?.[i] ?? `${w.id}_${i}`, g.lon, g.lat]));
}
fs.writeFileSync("data/myeongdong-streets.json", JSON.stringify({ ways }));
console.log("street ways:", ways.length);

// ---- water (Cheonggyecheon) ----
console.log("Fetching water…");
const wj = await overpass(QUERY_WATER);
const lines = [];
for (const w of wj.elements) {
  if (!w.geometry || w.geometry.length < 2) continue;
  lines.push({ name: w.tags?.name || "", pts: w.geometry.map((g) => [g.lon, g.lat]) });
}
fs.writeFileSync("data/myeongdong-water.json", JSON.stringify({ lines }));
console.log("water ways:", lines.length, lines.map((l) => l.name).filter(Boolean).slice(0, 6).join(" | "));
