// Add every real historic site near Myeongdong / City Hall that fits inside
// the 3D map (street graph: lng 126.9735–127.0085, lat 37.5426–37.5755).
// Gyeongbokgung / Changdeokgung / inner Jeong-dong are OUTSIDE the map.
//   node scripts/add-historic.mjs
import fs from "node:fs";

const env = fs.readFileSync(".env", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
const GKEY = get("GOOGLE_MAPS_KEY"), GEM = get("GEMINI_API_KEY");
// widened to the street graph — routing works anywhere in here
const BBOX = { w: 126.9737, e: 127.0000, s: 37.5545, n: 37.5752 };

const WANT = [
  ["덕수궁", "culture", "Deoksugung Palace — royal palace beside City Hall; royal guard-changing ceremony at Daehanmun gate 11:00/14:00/15:30; famous stone-wall road"],
  ["숭례문", "culture", "Sungnyemun (Namdaemun Gate) — Korea's National Treasure No. 1, the great south gate of the 1398 city wall, painstakingly rebuilt after the 2008 fire"],
  ["환구단", "culture", "Hwangudan Altar — where King Gojong proclaimed the Korean Empire in 1897; a hidden gem tucked behind the Westin Josun hotel"],
  ["보신각", "culture", "Bosingak Bell Pavilion — the city bell rung 33 times to open Seoul's gates each dawn for 500 years; struck at midnight every New Year's Eve"],
  ["광통교", "culture", "Gwangtonggyo Bridge — 1410 stone bridge over Cheonggyecheon restored with its original stones; spot the upside-down carved tomb stones in its walls"],
  ["조계사", "culture", "Jogyesa Temple — head temple of Korean Buddhism, courtyard strung with thousands of lotus lanterns, free to enter"],
  ["대한성공회 서울주교좌성당", "culture", "Seoul Anglican Cathedral — 1926 Romanesque cathedral with Korean-style eaves, hidden behind City Hall; the June 1987 democracy movement began at its gate"],
  ["광화문광장", "culture", "Gwanghwamun Square — statues of King Sejong the Great (creator of Hangul) and Admiral Yi Sun-sin, with the view up to Bugaksan mountain"],
  ["서울시립미술관 서소문본관", "culture", "Seoul Museum of Art — free museum behind the preserved 1928 facade of the former Supreme Court, at the top of leafy Jeong-dong"],
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
      locationBias: { circle: { center: { latitude: 37.5645, longitude: 126.9810 }, radius: 2500 } },
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
          text: "You are a Seoul-born walking-tour audio guide. Reply ONLY JSON {\"enName\": string, \"script\": string}. " +
            "enName: common English name. script: 2-3 spoken sentences (max 55 words) — what it is, why a traveller should care, one concrete thing to do or look for on the spot. Only verifiable facts. Natural spoken English, no greetings.",
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
let added = data.pois.filter((p) => String(p.id).startsWith("hs-")).length;
for (const [q, type, why] of WANT) {
  const p = await place(q).catch((e) => { console.log("✗", q, e.message); return null; });
  if (!p) continue;
  const lng = p.location.longitude, lat = p.location.latitude;
  const inBox = lng >= BBOX.w && lng <= BBOX.e && lat >= BBOX.s && lat <= BBOX.n;
  // dup only when it's really the same place: same-name nearby, or right on top
  const dup = data.pois.find((x) => {
    const d = dist({ lng, lat }, x);
    const nameHit = (x.title || "").includes(q.slice(0, 3)) || q.includes((x.title || "").slice(0, 3));
    return d < 15 || (d < 80 && nameHit);
  });
  console.log(`${inBox ? "○" : "✗"} ${q} → ${p.displayName?.text} (${lng.toFixed(5)},${lat.toFixed(5)})${inBox ? "" : "  [OUTSIDE MAP]"}${dup ? "  [already have: " + dup.title + "]" : ""}`);
  if (!inBox || dup) continue;
  let out = null;
  for (let t = 0; t < 3 && !out; t++) out = await gemini(q, why).catch((e) => { console.log("  retry:", e.message); return null; });
  if (!out) { console.log("  ✗ gemini gave up:", q); continue; }
  const { enName, script } = out;
  const image = await photoUri(p).catch(() => "");
  const hours = p.regularOpeningHours?.weekdayDescriptions?.[0]?.replace(/^[A-Za-z]+:\s*/, "") || "";
  data.pois.push({
    id: "hs-" + added, title: q, enName, type, lng, lat,
    addr: p.formattedAddress || "", overview: script, script, scriptBy: "gemini",
    image, hours: hours ? hours + " (Mon)" : "",
  });
  added++;
  console.log("   + added:", enName);
}
fs.writeFileSync("data/myeongdong-pois.json", JSON.stringify(data, null, 1));
console.log(`\nDone — ${added} historic sites added. Total POIs: ${data.pois.length}`);
