// Fill the 15 POIs that have no photo: Google Places Text Search → first photo
// → resolve to a keyless lh3.googleusercontent.com URL (same shape the tips
// already use). Idempotent: only touches POIs whose image is empty.
//   node scripts/fill-poi-images.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^GOOGLE_MAPS_KEY=(.+)$/m) || [])[1]?.trim();
const FILE = "data/myeongdong-pois.json";

async function placePhoto(query, lng, lat) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": KEY,
      "x-goog-fieldmask": "places.photos,places.displayName",
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 400 } },
      maxResultCount: 1,
      languageCode: "ko",
    }),
  });
  if (!r.ok) { console.log("  search", r.status); return null; }
  const photo = (await r.json())?.places?.[0]?.photos?.[0]?.name;
  if (!photo) return null;
  const m = await fetch(
    `https://places.googleapis.com/v1/${photo}/media?maxWidthPx=400&key=${KEY}&skipHttpRedirect=true`
  );
  if (!m.ok) { console.log("  media", m.status); return null; }
  return (await m.json())?.photoUri || null;
}

const db = JSON.parse(fs.readFileSync(FILE, "utf8"));
const arr = db.pois || db;
let n = 0;
for (const p of arr) {
  if (p.image) continue;
  const q = (p.title || p.enName) + " 서울";
  const url = await placePhoto(q, p.lng, p.lat);
  if (!url) { console.log(`✗ ${p.id} ${p.enName || p.title}`); continue; }
  p.image = url;
  console.log(`✓ ${p.id} ${p.enName || p.title}`);
  n++;
}
fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
console.log(`done — ${n} images filled`);
