// Content-quality pass:
//  1. every story zone gets its own photo (Google Places) — no more bare cards
//  2. rewrite weak/wrong texts: T-money tip (subway-station top-up + banana
//     milk), "eocance" tip (made-up word), Yi Sang fact (context for
//     foreigners), and fix the odeng tip's mismatched rec (was a pizzeria!)
//   node scripts/fix-content.mjs
import fs from "node:fs";

const env = fs.readFileSync(".env", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
const GKEY = get("GOOGLE_MAPS_KEY");

async function place(q) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json", "X-Goog-Api-Key": GKEY,
      "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress,places.photos",
    },
    body: JSON.stringify({
      textQuery: q, languageCode: "en", maxResultCount: 1,
      locationBias: { circle: { center: { latitude: 37.5636, longitude: 126.985 }, radius: 1800 } },
    }),
  });
  if (!r.ok) throw new Error("places " + r.status);
  return (await r.json()).places?.[0];
}
async function photoUri(p, px = 640) {
  if (!p?.photos?.length) return "";
  const m = await fetch(`https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=${px}&skipHttpRedirect=true&key=${GKEY}`);
  return m.ok ? (await m.json()).photoUri || "" : "";
}

// ---- 1. zone photos ----
const ZONE_Q = {
  "Myeongdong Street": "명동거리", "Cathedral Hill": "명동성당", "Namdaemun": "남대문시장",
  "Hoehyeon": "신세계백화점 본점", "Euljiro": "세운상가", "Namsan Foothills": "남산케이블카",
  "Cheonggyecheon": "청계천", "Myeongdong Station": "명동역",
};
const zones = JSON.parse(fs.readFileSync("data/myeongdong-zones.json", "utf8"));
for (const z of zones.zones) {
  if (z.image) { process.stdout.write("-"); continue; }
  const p = await place(ZONE_Q[z.name] || z.name).catch(() => null);
  z.image = await photoUri(p).catch(() => "");
  process.stdout.write(z.image ? "●" : "○");
}

// ---- 2. rewrite the Yi Sang fact so it lands for a foreigner ----
const hoehyeon = zones.zones.find((z) => z.name === "Hoehyeon");
hoehyeon.facts[1] =
  "Korea's most famous modernist writer, Yi Sang — think of him as Seoul's Kafka — ended his 1936 masterpiece 'Wings' on that department store's rooftop, with the cry: let us fly, just once more. Every Korean meets that rooftop scene in school — and you're standing right under it.";
fs.writeFileSync("data/myeongdong-zones.json", JSON.stringify(zones, null, 1));
console.log("\nzones done");

// ---- 3. tip rewrites ----
const tips = JSON.parse(fs.readFileSync("data/local-tips.json", "utf8"));
tips.tips.any[1].text =
  "Those tired feet deserve the subway, so grab a T-money card — one tap covers every subway, bus and taxi in Korea. Buy one at any convenience store counter, and top it up with cash there — or at the English-menu machines inside every subway station. Then do what we all do on the way out: grab a yellow-cap banana milk from the fridge. We've loved it since 1974.";
tips.tips.hot[3].text =
  "This Seoul summer heat is brutal, so here's the real local survival move — shop-hopping through the air conditioning. Nobody minds you browsing just to cool off; half the people inside are doing exactly the same. Step into the nearest Olive Young, find the tester zone, and spray a cooling mist on your face before you head back out.";

// ---- 4. odeng tip: swap the pizzeria (!) for the actual street-food carts ----
const p = await place("명동 길거리 음식").catch(() => null);
if (p) {
  tips.tips.cold[0].rec = {
    name: "the Myeongdong street-food carts",
    image: await photoUri(p, 400).catch(() => ""),
    addr: p.formattedAddress || "Myeongdong-gil, Jung-gu, Seoul",
    lng: p.location.longitude, lat: p.location.latitude,
    tip: "Order one odeng skewer, then help yourself to the hot broth — refilling your paper cup again and again is exactly what everyone does.",
  };
  console.log("odeng rec →", p.displayName?.text, p.formattedAddress);
} else console.log("odeng rec: places lookup failed — left as-is");
fs.writeFileSync("data/local-tips.json", JSON.stringify(tips, null, 1));
console.log("tips done");
