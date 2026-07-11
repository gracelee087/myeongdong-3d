// Regenerate K-Beauty brand blurbs with Gemini (one per brand, shared by
// branches) — updates data/myeongdong-beauty.json in place.
//   node scripts/gen-beauty-blurbs.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^GEMINI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.error("GEMINI_API_KEY missing"); process.exit(1); }
const MODEL = "gemini-3.5-flash";

async function gen(brand, sample) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are a warm walking-tour audio guide in Myeongdong, Seoul. " +
              "Reply ONLY JSON {\"enName\": string, \"script\": string}. " +
              "enName: the shop's common English brand name. " +
              "script: 2 spoken sentences (max 40 words) about this Korean cosmetics brand/shop — " +
              "what it's famous for, one product or detail worth trying. Natural spoken English, no greetings.",
          }],
        },
        contents: [{ role: "user", parts: [{ text: `Brand/shop: ${brand}\nExample store name: ${sample}` }] }],
        generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
      }),
    }
  );
  if (!r.ok) throw new Error("gemini " + r.status + " " + (await r.text()).slice(0, 100));
  const t = (await r.json()).candidates[0].content.parts[0].text;
  // take the first balanced JSON object (gemini sometimes appends stray text)
  const s = t.indexOf("{");
  let d = 0;
  for (let i = s; i < t.length; i++) {
    if (t[i] === "{") d++;
    else if (t[i] === "}") { d--; if (!d) return JSON.parse(t.slice(s, i + 1)); }
  }
  throw new Error("no JSON in reply");
}

const data = JSON.parse(fs.readFileSync("data/myeongdong-beauty.json", "utf8"));
// only brands not yet regenerated with gemini
const brands = [...new Set(data.shops.filter((s) => s.scriptBy !== "gemini").map((s) => s.brand))];
let ok = 0;
for (const b of brands) {
  const sample = data.shops.find((s) => s.brand === b).title;
  try {
    const { enName, script } = await gen(b, sample);
    for (const s of data.shops.filter((s) => s.brand === b)) {
      s.enName = s.enName || enName || s.brand;
      s.script = script; s.overview = script; s.scriptBy = "gemini";
    }
    ok++; process.stdout.write(".");
  } catch (e) { process.stdout.write("x"); if (ok < 2) console.error("\n", e.message); }
}
fs.writeFileSync("data/myeongdong-beauty.json", JSON.stringify(data, null, 1));
console.log(`\nDone: ${ok}/${brands.length} brands regenerated with Gemini.`);
