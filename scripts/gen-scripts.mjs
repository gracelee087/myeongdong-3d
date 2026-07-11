// Turn each POI's Korean overview into a short ENGLISH audio-guide script + an
// English display name. Baked into data/myeongdong-pois.json so the live demo has
// zero LLM latency. Prefers Gemini (→ Google AI bonus); falls back to OpenAI.
// Re-run after adding GEMINI_API_KEY to regenerate everything with Gemini.
//   node scripts/gen-scripts.mjs
import fs from "node:fs";

const env = fs.readFileSync(".env", "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim();
const GEMINI = get("GEMINI_API_KEY");
const OPENAI = get("OPENAI_API_KEY");
const GEMINI_MODEL = "gemini-3.5-flash";

const provider = GEMINI ? "gemini" : OPENAI ? "openai" : null;
if (!provider) { console.error("Need GEMINI_API_KEY or OPENAI_API_KEY in .env"); process.exit(1); }
console.log("Generating with:", provider);

const SYS =
  "You are a warm, concise walking-tour audio guide for Myeongdong, Seoul. " +
  "For each place, a tourist hears you the moment they arrive in front of it. " +
  "Reply ONLY as JSON: {\"enName\": string, \"script\": string}. " +
  "enName: the place's common English or romanized name. " +
  "script: 2-3 spoken sentences (max 55 words) — what it is, why it's worth stopping, one vivid concrete detail. " +
  "No greetings, no 'welcome', no emojis, no stage directions. Natural spoken English.";

function userPrompt(p) {
  return `Place: ${p.title}\nType: ${p.type}\nAddress: ${p.addr}\nKorean description: ${p.overview || "(none)"}`;
}

async function viaOpenAI(p) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + OPENAI, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYS }, { role: "user", content: userPrompt(p) }],
      response_format: { type: "json_object" }, temperature: 0.7,
    }),
  });
  if (!r.ok) throw new Error("openai " + r.status + " " + (await r.text()).slice(0, 120));
  const j = await r.json();
  return JSON.parse(j.choices[0].message.content);
}

async function viaGemini(p) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYS }] },
      contents: [{ role: "user", parts: [{ text: userPrompt(p) }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
    }),
  });
  if (!r.ok) throw new Error("gemini " + r.status + " " + (await r.text()).slice(0, 120));
  const j = await r.json();
  return firstJSON(j.candidates[0].content.parts[0].text);
}

// gemini sometimes appends stray text after the JSON — take the first balanced object
function firstJSON(t) {
  const s = t.indexOf("{");
  let d = 0;
  for (let i = s; i < t.length; i++) {
    if (t[i] === "{") d++;
    else if (t[i] === "}") { d--; if (!d) return JSON.parse(t.slice(s, i + 1)); }
  }
  throw new Error("no JSON in reply");
}

const gen = provider === "gemini" ? viaGemini : viaOpenAI;

async function pool(arr, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < arr.length) { const idx = i++; await fn(arr[idx], idx); }
  }));
}

(async () => {
  const data = JSON.parse(fs.readFileSync("data/myeongdong-pois.json", "utf8"));
  const todo = process.argv.includes("--all")
    ? data.pois
    : data.pois.filter((p) => !p.script || p.scriptBy === "fallback");
  console.log(`Generating ${todo.length}/${data.pois.length} (use --all to regenerate everything)`);
  let ok = 0, fail = 0;
  await pool(todo, 6, async (p) => {
    try {
      const { enName, script } = await gen(p);
      p.enName = enName || p.title;
      p.script = script;
      p.scriptBy = provider;
      ok++;
      process.stdout.write(".");
    } catch (e) {
      p.enName = p.enName || p.title;
      p.script = p.script || `${p.title}, a favorite ${p.type} spot in the heart of Myeongdong — well worth a stop as you explore the district.`;
      p.scriptBy = "fallback";
      fail++;
      process.stdout.write("x");
      if (fail <= 3) console.error("\n ", e.message);
    }
  });
  data.scriptProvider = provider;
  fs.writeFileSync("data/myeongdong-pois.json", JSON.stringify(data, null, 1));
  console.log(`\nDone. ok=${ok} fail=${fail}. Provider=${provider}`);
  console.log("Sample:", data.pois.slice(0, 4).map((p) => `${p.enName}: ${p.script?.slice(0, 60)}…`).join("\n  "));
})();
