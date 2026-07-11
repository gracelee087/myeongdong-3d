// Fill real opening hours for K-Beauty shops via Google Places API (Text Search).
// Matches each OSM shop to the nearest Places result and bakes compact English
// hours into data/myeongdong-beauty.json. Unmatched shops get the Myeongdong
// road-shop norm, honestly labelled "(typical)".
//   node scripts/enrich-beauty-hours.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^GOOGLE_MAPS_KEY=(.+)$/m) || [])[1]?.trim();
const data = JSON.parse(fs.readFileSync("data/myeongdong-beauty.json", "utf8"));

const dist = (a, b) => {
  const k = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * 111320 * k, (a.lat - b.lat) * 111320);
};

// "10:00 AM – 10:30 PM" → "10:00–22:30"
function to24(s) {
  return s.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)/gi, (_, h, m, ap) => {
    let H = parseInt(h, 10);
    if (/pm/i.test(ap) && H !== 12) H += 12;
    if (/am/i.test(ap) && H === 12) H = 0;
    return `${String(H).padStart(2, "0")}:${m}`;
  }).replace(/\s*–\s*/g, "–");
}
// weekdayDescriptions → compact one-liner
function compress(descs) {
  if (!descs?.length) return "";
  const ranges = descs.map((d) => to24(d.replace(/^[A-Za-z]+:\s*/, "").trim()));
  const uniq = [...new Set(ranges)];
  if (uniq.length === 1) return uniq[0] === "Closed" ? "" : "Daily " + uniq[0];
  // most common range + note
  const count = {};
  for (const r of ranges) count[r] = (count[r] || 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
  const closedDays = descs.filter((d, i) => ranges[i] === "Closed").map((d) => d.slice(0, 3));
  if (closedDays.length) return `${top} (closed ${closedDays.join(", ")})`;
  return `${top} (varies)`;
}

async function lookup(shop) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json", "X-Goog-Api-Key": KEY,
      "X-Goog-FieldMask": "places.displayName,places.regularOpeningHours.weekdayDescriptions,places.location",
    },
    body: JSON.stringify({
      textQuery: `${shop.title} 명동`, languageCode: "en", maxResultCount: 3,
      locationBias: { circle: { center: { latitude: shop.lat, longitude: shop.lng }, radius: 400 } },
    }),
  });
  if (!r.ok) throw new Error("places " + r.status);
  const places = (await r.json()).places || [];
  // nearest result within 220 m that actually has hours
  let best = null, bd = 220;
  for (const p of places) {
    if (!p.regularOpeningHours?.weekdayDescriptions) continue;
    const d = dist(shop, { lat: p.location.latitude, lng: p.location.longitude });
    if (d < bd) { bd = d; best = p; }
  }
  return best ? compress(best.regularOpeningHours.weekdayDescriptions) : "";
}

// prettify hours already present from OSM ("Mo-Su 10:00-22:30" → "Daily 10:00–22:30")
const prettifyOSM = (h) => h
  .replace(/^Mo-Su\s*/i, "Daily ").replace(/^Mo-Sa\s*/i, "Mon–Sat ").replace(/^Mo-Fr\s*/i, "Mon–Fri ")
  .replace(/(\d)-(\d)/g, "$1–$2");

let real = 0, typical = 0, kept = 0;
for (const s of data.shops) {
  if (s.hours) { s.hours = prettifyOSM(s.hours); kept++; continue; }
  try {
    const h = await lookup(s);
    if (h) { s.hours = h; real++; process.stdout.write("."); continue; }
  } catch (e) { console.error("\n", s.title, e.message); }
  s.hours = "10:00–22:30 (typical)";
  typical++;
  process.stdout.write("t");
}
fs.writeFileSync("data/myeongdong-beauty.json", JSON.stringify(data, null, 1));
console.log(`\nDone. google=${real} osm-kept=${kept} typical=${typical}`);
console.log("Sample:", data.shops.slice(0, 5).map((s) => `${s.title}: ${s.hours}`).join(" | "));
