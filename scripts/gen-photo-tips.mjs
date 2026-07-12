// Gemini writes the photo-spot narrations: WHY this corner is one of Seoul's
// most-photographed places (history/culture), then HOW to take the shot.
// Bakes to data/photo-spots.json (loaded by main.js).
//   node scripts/gen-photo-tips.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^GEMINI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.error("GEMINI_API_KEY missing"); process.exit(1); }
const MODEL = "gemini-3.5-flash";

const SPOTS = [
  {
    id: "ps-cathedral", enName: "Cathedral Front Steps", ko: "명동성당 앞계단", lng: 126.98715, lat: 37.5633,
    context: "Myeongdong Cathedral (1898), Korea's first Gothic brick church, symbol of Korean Catholicism and 1980s democracy movement sanctuary. The classic shot: from the bottom of the front steps shooting up at the spire.",
  },
  {
    id: "ps-mainstreet", enName: "Main Street Neon Canyon", ko: "명동거리 네온", lng: 126.9851, lat: 37.56348,
    context: "Myeongdong 8-gil main shopping street: a canyon of stacked neon and LED signs, street food carts, K-beauty storefronts. The signature Seoul-shopping-district photo, best at dusk.",
  },
  {
    id: "ps-cheonggye", enName: "Cheonggye Plaza · Spring", ko: "청계광장 스프링", lng: 126.9779, lat: 37.5689,
    context: "Cheonggye Plaza with Claes Oldenburg's 20m 'Spring' sculpture (red/blue snail shell) at the head of the restored Cheonggyecheon stream (2005 urban renewal icon; the stream was a covered highway before).",
  },
  {
    id: "ps-bok", enName: "Bank of Korea Fountain", ko: "한국은행 분수광장", lng: 126.9817, lat: 37.5599,
    context: "Fountain square in front of the 1912 Bank of Korea building (renaissance-style granite, designed in the colonial era, now the Money Museum). One of the few grand European-style facades left in Seoul.",
  },
  {
    id: "ps-plaza", enName: "Seoul Plaza Lawn", ko: "서울광장", lng: 126.978, lat: 37.5656,
    context: "Seoul Plaza: oval lawn in front of City Hall — the 1926 stone hall with the 2012 glass-wave new City Hall curling above it. Site of 2002 World Cup crowds and winter ice rink.",
  },
  {
    id: "ps-cablecar", enName: "Namsan Cable Car View", ko: "남산케이블카 뷰", lng: 126.9819, lat: 37.5565,
    context: "Spot near the lower Namsan cable car station where the cars glide up the forested hill toward N Seoul Tower — running since 1962, Korea's first commercial cable car; a classic Seoul postcard.",
  },
];

async function gen(s) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are a warm walking-tour audio guide in Seoul. The traveller just reached a famous photo spot. " +
              "Reply ONLY JSON {\"tip\": string}. tip: 3 spoken sentences (max 65 words), starting with 'Photo spot!'. " +
              "Sentence 1-2: WHY this exact place is one of Seoul's most photographed — its story, told vividly. " +
              "Sentence 3: HOW to take the shot — where to stand, angle, best light. Natural spoken English, no emojis.",
          }],
        },
        contents: [{ role: "user", parts: [{ text: `Spot: ${s.enName}\nFacts: ${s.context}` }] }],
        generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
      }),
    }
  );
  if (!r.ok) throw new Error("gemini " + r.status + " " + (await r.text()).slice(0, 100));
  const t = (await r.json()).candidates[0].content.parts[0].text;
  const i = t.indexOf("{");
  let d = 0;
  for (let j = i; j < t.length; j++) {
    if (t[j] === "{") d++;
    else if (t[j] === "}") { d--; if (!d) return JSON.parse(t.slice(i, j + 1)).tip; }
  }
  throw new Error("no JSON");
}

const out = [];
for (const s of SPOTS) {
  const tip = await gen(s);
  out.push({ id: s.id, enName: s.enName, ko: s.ko, lng: s.lng, lat: s.lat, type: "photo", tip });
  console.log("✓", s.enName, "—", tip.slice(0, 70) + "…");
}
fs.writeFileSync("data/photo-spots.json", JSON.stringify({ generator: "gemini-3.5-flash", spots: out }, null, 1));
console.log(`\nSaved data/photo-spots.json (${out.length} spots, written by Gemini)`);
