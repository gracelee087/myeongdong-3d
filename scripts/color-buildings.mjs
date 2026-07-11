// Sample each building's rooftop colour from satellite imagery and bake it into
// data/myeongdong-buildings.geojson (adds properties.color = [r,g,b]). This is the
// daytime "#2" look — buildings match the real aerial photo instead of white boxes.
//   node scripts/color-buildings.mjs
import fs from "node:fs";
import sharp from "sharp";

const Z = 18;
const TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

function lngLatToWorld(lng, lat, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}
function ringCentroid(f) { const r = f.geometry.coordinates[0]; let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; }

const tiles = new Map(); // "x,y" -> {data, w, h, channels}
async function getTile(xt, yt) {
  const key = xt + "," + yt;
  if (tiles.has(key)) return tiles.get(key);
  const url = `${TILE}/${Z}/${yt}/${xt}`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const t = { data, w: info.width, h: info.height, channels: info.channels };
  tiles.set(key, t);
  return t;
}
function samplePatch(t, px, py, rad = 4) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    const x = px + dx, y = py + dy;
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) continue;
    const i = (y * t.w + x) * t.channels;
    r += t.data[i]; g += t.data[i + 1]; b += t.data[i + 2]; n++;
  }
  return n ? [r / n, g / n, b / n] : [140, 140, 140];
}
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

(async () => {
  const fc = JSON.parse(fs.readFileSync("data/myeongdong-buildings.geojson", "utf8"));
  let ok = 0;
  // fetch tiles lazily; do sequentially per building but tile cache keeps it cheap
  for (const f of fc.features) {
    const [lng, lat] = ringCentroid(f);
    const w = lngLatToWorld(lng, lat, Z);
    const xt = Math.floor(w.x), yt = Math.floor(w.y);
    const px = Math.floor((w.x - xt) * 256), py = Math.floor((w.y - yt) * 256);
    let c;
    try { c = samplePatch(await getTile(xt, yt), px, py); ok++; }
    catch { c = [150, 150, 150]; }
    // gentle lift so roofs don't read muddy, keep hue
    const lift = 1.18, base = 14;
    f.properties.color = [clamp(c[0] * lift + base), clamp(c[1] * lift + base), clamp(c[2] * lift + base)];
    if (ok % 200 === 0) process.stdout.write(".");
  }
  fs.writeFileSync("data/myeongdong-buildings.geojson", JSON.stringify(fc));
  console.log(`\nColoured ${ok}/${fc.features.length} buildings from ${tiles.size} tiles (z${Z}).`);
  console.log("sample colors:", fc.features.slice(0, 5).map((f) => f.properties.color.join(",")).join(" | "));
})();
