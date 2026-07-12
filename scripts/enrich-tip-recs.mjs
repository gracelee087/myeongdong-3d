// For each Like-a-Local tip, Gemini names ONE real famous place near Myeongdong
// that fits it (e.g. patbingsu tip → Sulbing), then Google Places confirms it
// exists nearby and provides a photo + address. Upgrades data/local-tips.json
// entries from strings to { text, rec: { name, image, addr } }.
//   node scripts/enrich-tip-recs.mjs
import fs from "node:fs";

const env = fs.readFileSync(".env", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
const GKEY = get("GOOGLE_MAPS_KEY"), GEM = get("GEMINI_API_KEY");

async function suggestPlace(tip) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEM },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: "Reply ONLY JSON {\"query\": string}. Given a travel tip for Myeongdong, Seoul, name ONE real, " +
            "famous, currently-operating place near Myeongdong that best matches it, as a Korean search query " +
            "(e.g. \"설빙 명동\"). If no specific shop fits (etiquette tips etc.), return \"\".",
        }],
      },
      contents: [{ role: "user", parts: [{ text: tip }] }],
      generationConfig: { temperature: 0.4, responseMimeType: "application/json", maxOutputTokens: 2048 },
    }),
  });
  if (!r.ok) throw new Error("gemini " + r.status);
  const t = (await r.json()).candidates[0].content.parts[0].text;
  const s = t.indexOf("{");
  let d = 0;
  for (let i = s; i < t.length; i++) {
    if (t[i] === "{") d++;
    else if (t[i] === "}") { d--; if (!d) return JSON.parse(t.slice(s, i + 1)).query || ""; }
  }
  return "";
}

async function resolvePlace(q) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json", "X-Goog-Api-Key": GKEY,
      "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress,places.photos",
    },
    body: JSON.stringify({
      textQuery: q, languageCode: "en", maxResultCount: 1,
      locationBias: { circle: { center: { latitude: 37.5636, longitude: 126.985 }, radius: 1500 } },
    }),
  });
  if (!r.ok) throw new Error("places " + r.status);
  const p = (await r.json()).places?.[0];
  if (!p) return null;
  let image = "";
  if (p.photos?.length) {
    const m = await fetch(`https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=400&skipHttpRedirect=true&key=${GKEY}`);
    if (m.ok) image = (await m.json()).photoUri || "";
  }
  return {
    name: p.displayName?.text || q, image, addr: p.formattedAddress || "",
    lng: p.location.longitude, lat: p.location.latitude,
  };
}

// one concrete action AT the place — "watch the changing of the guard at 11am",
// not just "go there"
async function genDo(tipText, placeName) {
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEM },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: "Reply ONLY JSON {\"do\": string}. Given a Seoul travel tip and a specific place, write ONE spoken " +
            "sentence (max 22 words) telling the traveller exactly what to do/order/see AT that place — " +
            "a concrete signature thing (dish name, spot inside, time of day). No greetings.",
        }],
      },
      contents: [{ role: "user", parts: [{ text: `Tip: ${tipText}\nPlace: ${placeName}` }] }],
      generationConfig: { temperature: 0.5, responseMimeType: "application/json", maxOutputTokens: 2048 },
    }),
  });
  if (!r.ok) throw new Error("gemini " + r.status);
  const t = (await r.json()).candidates[0].content.parts[0].text;
  const s = t.indexOf("{");
  let d = 0;
  for (let i = s; i < t.length; i++) {
    if (t[i] === "{") d++;
    else if (t[i] === "}") { d--; if (!d) return JSON.parse(t.slice(s, i + 1)).do || ""; }
  }
  return "";
}

const data = JSON.parse(fs.readFileSync("data/local-tips.json", "utf8"));
for (const [bucket, arr] of Object.entries(data.tips)) {
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    const text = typeof e === "string" ? e : e.text;
    let rec = typeof e === "object" ? e.rec : undefined;
    try {
      if (rec === undefined) {                       // brand-new tip
        const q = await suggestPlace(text);
        rec = q ? await resolvePlace(q) : null;
      } else if (rec && rec.lng === undefined) {     // has a name but no coords yet
        const r2 = await resolvePlace(rec.name);
        if (r2) rec = { ...r2, name: rec.name };     // keep the cleaned-up name
      }
      if (rec && !rec.tip) rec.tip = await genDo(text, rec.name);
    } catch (err) { console.error("\n", bucket, i, err.message); }
    arr[i] = { text, rec: rec || null };
    process.stdout.write(rec ? "●" : "○");
  }
}
fs.writeFileSync("data/local-tips.json", JSON.stringify(data, null, 1));
const withRec = Object.values(data.tips).flat().filter((t) => t.rec).length;
console.log(`\nDone. ${withRec} tips got a real nearby place (photo+address).`);
console.log(Object.values(data.tips).flat().filter((t) => t.rec).map((t) => t.rec.name).join(" | "));
