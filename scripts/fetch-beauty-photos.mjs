// Bake a real photo URL for each K-Beauty shop via Google Places (Text Search
// + Photo media). Writes `image` into data/myeongdong-beauty.json so the
// sidebar list and the spot card show pictures like every other category.
//   node scripts/fetch-beauty-photos.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^GOOGLE_MAPS_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.error("GOOGLE_MAPS_KEY missing in .env"); process.exit(1); }
const data = JSON.parse(fs.readFileSync("data/myeongdong-beauty.json", "utf8"));

const dist = (a, b) => {
  const k = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * 111320 * k, (a.lat - b.lat) * 111320);
};

async function photoFor(shop) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json", "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "places.displayName,places.photos,places.location",
    },
    body: JSON.stringify({
      textQuery: `${shop.title} 명동`, languageCode: "en", maxResultCount: 3,
      locationBias: { circle: { center: { latitude: shop.lat, longitude: shop.lng }, radius: 400 } },
    }),
  });
  if (!r.ok) throw new Error("places " + r.status);
  const places = (await r.json()).places || [];
  let best = null, bd = 300;
  for (const p of places) {
    if (!p.photos?.length) continue;
    const d = dist(shop, { lat: p.location.latitude, lng: p.location.longitude });
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return "";
  const name = best.photos[0].name; // places/…/photos/…
  const m = await fetch(
    `https://places.googleapis.com/v1/${name}/media?maxWidthPx=400&skipHttpRedirect=true&key=${KEY}`
  );
  if (!m.ok) throw new Error("photo " + m.status);
  return (await m.json()).photoUri || "";
}

// same brand branches can share one photo when a branch has no match
const brandImg = {};
let ok = 0, shared = 0, none = 0;
for (const s of data.shops) {
  if (s.image) { ok++; continue; }                    // incremental
  try {
    const uri = await photoFor(s);
    if (uri) {
      s.image = uri; brandImg[s.brand] = brandImg[s.brand] || uri;
      ok++; process.stdout.write("."); continue;
    }
  } catch (e) { console.error("\n", s.title, e.message); }
  if (brandImg[s.brand]) { s.image = brandImg[s.brand]; shared++; process.stdout.write("s"); }
  else { none++; process.stdout.write("x"); }
}
// second pass: brands resolved later in the list
for (const s of data.shops) {
  if (!s.image && brandImg[s.brand]) { s.image = brandImg[s.brand]; shared++; none--; }
}
fs.writeFileSync("data/myeongdong-beauty.json", JSON.stringify(data, null, 1));
console.log(`\nDone. photo=${ok} brand-shared=${shared} none=${none} / ${data.shops.length}`);
