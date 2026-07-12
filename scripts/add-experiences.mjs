// Audit famous Myeongdong-area hot places against our POI data, and append
// the missing ones (experiences: shows, museums, markets) with exact coords
// from Google Places and a guide script written by Gemini.
//   node scripts/add-experiences.mjs
import fs from "node:fs";

const env = fs.readFileSync(".env", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
const GKEY = get("GOOGLE_MAPS_KEY"), GEM = get("GEMINI_API_KEY");
const BBOX = { w: 126.9769, e: 126.9939, s: 37.5539, n: 37.5715 };

// the hot-list — query name, our display type, why it matters
const WANT = [
  ["난타 명동극장", "culture", "NANTA non-verbal cooking-percussion show, Myeongdong theatre — the show every foreign visitor sees"],
  ["명동예술극장", "culture", "Myeongdong Art Theater — 1936 baroque-facade theatre, heart of 1950s-60s Korean drama"],
  ["한국은행 화폐박물관", "culture", "Bank of Korea Money Museum in the 1912 renaissance building — free entry"],
  ["서울애니메이션센터", "culture", "Seoul Animation Center & Zaemiro comics street on the way up Namsan"],
  ["남산골한옥마을", "attraction", "Namsangol Hanok Village — five restored Joseon houses, free hanbok-era photo scenery"],
  ["서울시청 서울광장", "attraction", "Seoul City Hall & Seoul Plaza — 1926 stone hall under the 2012 glass wave; ice rink in winter"],
  ["을지로 노가리골목", "food", "Euljiro Nogari Alley ('Hipjiro') — beer-crate alley where office workers drink under strings of lights"],
  ["명동지하쇼핑센터", "shopping", "Myeongdong Underground Shopping Center — locals' half-price K-pop goods, socks, phone cases"],
  ["하이커그라운드", "culture", "HiKR Ground — Korea Tourism Organization's free K-pop & media-art playground: XR K-pop stage where you shoot your own music video"],
  ["우표박물관", "culture", "Korea Stamp Museum in the basement of Post Tower — tiny free museum, make your own postcard and mail it home"],
  ["남산예장공원", "culture", "Namsan Yejang Park — new hillside park over the old Japanese-era site, with the Lee Hoe-yeong memorial and a view terrace toward N Seoul Tower"],
];

const dist = (a, b) => {
  const k = Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * 111320 * k, (a.lat - b.lat) * 111320);
};

async function place(q) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json", "X-Goog-Api-Key": GKEY,
      "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress,places.photos,places.regularOpeningHours.weekdayDescriptions",
    },
    body: JSON.stringify({
      textQuery: q + " 서울", languageCode: "ko", maxResultCount: 1,
      locationBias: { circle: { center: { latitude: 37.5627, longitude: 126.9854 }, radius: 2500 } },
    }),
  });
  if (!r.ok) throw new Error("places " + r.status);
  return (await r.json()).places?.[0];
}
async function photoUri(p) {
  if (!p.photos?.length) return "";
  const m = await fetch(`https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=400&skipHttpRedirect=true&key=${GKEY}`);
  return m.ok ? (await m.json()).photoUri || "" : "";
}
async function gemini(name, why) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEM },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: "You are a warm walking-tour audio guide in Myeongdong, Seoul. Reply ONLY JSON {\"enName\": string, \"script\": string}. " +
            "enName: common English name. script: 2-3 spoken sentences (max 55 words) — what it is, why it's worth stopping, one concrete thing to do or see there. Natural spoken English, no greetings.",
        }],
      },
      contents: [{ role: "user", parts: [{ text: `Place: ${name}\nContext: ${why}` }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json", maxOutputTokens: 4096 },
    }),
  });
  if (!r.ok) throw new Error("gemini " + r.status);
  const t = (await r.json()).candidates[0].content.parts[0].text;
  const s = t.indexOf("{");
  let d = 0;
  for (let i = s; i < t.length; i++) {
    if (t[i] === "{") d++;
    else if (t[i] === "}") { d--; if (!d) return JSON.parse(t.slice(s, i + 1)); }
  }
  throw new Error("no JSON");
}

const data = JSON.parse(fs.readFileSync("data/myeongdong-pois.json", "utf8"));
let added = 0;
for (const [q, type, why] of WANT) {
  const p = await place(q).catch((e) => { console.log("✗", q, e.message); return null; });
  if (!p) continue;
  const lng = p.location.longitude, lat = p.location.latitude;
  const inBox = lng >= BBOX.w && lng <= BBOX.e && lat >= BBOX.s && lat <= BBOX.n;
  const dup = data.pois.find((x) => dist({ lng, lat }, x) < 80 && (x.title.includes(q.slice(0, 4)) || q.includes((x.title || "").slice(0, 4))));
  console.log(`${inBox ? "○" : "✗"} ${q} → ${p.displayName?.text} (${lng.toFixed(5)},${lat.toFixed(5)})${inBox ? "" : "  [OUTSIDE MAP]"}${dup ? "  [already have: " + dup.title + "]" : ""}`);
  if (!inBox || dup) continue;
  const { enName, script } = await gemini(q, why);
  const image = await photoUri(p).catch(() => "");
  const hours = p.regularOpeningHours?.weekdayDescriptions?.[0]?.replace(/^[A-Za-z]+:\s*/, "") || "";
  data.pois.push({
    id: "xp-" + added, title: q, enName, type, lng, lat,
    addr: p.formattedAddress || "", overview: script, script, scriptBy: "gemini",
    image, hours: hours ? hours + " (Mon)" : "", experience: true,
  });
  added++;
  console.log("   + added:", enName);
}
fs.writeFileSync("data/myeongdong-pois.json", JSON.stringify(data, null, 1));
console.log(`\nDone — ${added} experiences added. Total POIs: ${data.pois.length}`);
