// Pre-bake ElevenLabs audio for the default demo path (Best of Myeongdong
// course + About-Myeongdong fillers) into static mp3s, so judging never
// depends on live TTS credits/latency. Other courses still use runtime TTS
// (with browser-voice fallback).
//   node scripts/bake-audio.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^ELEVENLABS_API_KEY=(.+)$/m) || [])[1]?.trim();
const VOICE = "XrExE9yKIg1WjnnlVkGX"; // Matilda — must match netlify/functions/tts.js
const MODEL = "eleven_multilingual_v2";

const BEST = ["명동", "서울 명동성당", "명동교자", "왕비집", "남산케이블카", "남산골한옥마을",
  "신세계백화점 본점", "롯데백화점 본점", "남대문시장", "뷰티플레이", "원조남산왕돈까스", "평래옥", "청계천"];

// djb2 hash — same function lives in js/audio.js to look files up
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

async function tts(text) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text, model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true },
    }),
  });
  if (!r.ok) throw new Error("elevenlabs " + r.status + " " + (await r.text()).slice(0, 140));
  return Buffer.from(await r.arrayBuffer());
}

// must stay byte-identical to INTRO in js/main.js
const INTRO =
  "Welcome to Seoul! I'm so glad you're here, standing right outside Myeongdong Station Exit 6. " +
  "You are stepping into a place unlike anywhere else in Korea—this is the country's most expensive land, welcoming up to a million visitors every single day. " +
  "But Myeongdong is so much more than just shopping; back in the 1950s, it was Seoul's very own Montmartre, where artists and poets filled the cozy tea rooms. " +
  "Ever since, almost every major Korean trend has started right on these streets. " +
  "Now, pop your earphones in, follow the yellow line, and I'll share its stories as we walk.";

const pois = JSON.parse(fs.readFileSync("data/myeongdong-pois.json", "utf8")).pois;
const fillers = JSON.parse(fs.readFileSync("data/myeongdong-fillers.json", "utf8")).fillers;
const zones = JSON.parse(fs.readFileSync("data/myeongdong-zones.json", "utf8")).zones;
const photoTips = fs.existsSync("data/photo-spots.json")
  ? JSON.parse(fs.readFileSync("data/photo-spots.json", "utf8")).spots.map((s) => s.tip) : [];
const tipEntries = fs.existsSync("data/local-tips.json")
  ? Object.values(JSON.parse(fs.readFileSync("data/local-tips.json", "utf8")).tips).flat() : [];
const localTips = tipEntries.flatMap((t) => {
  const text = t.text || t;
  // recommendation line template — must match js/main.js exactly
  if (!t.rec) return [text];
  return [text, `Locals' favourite for this is ${t.rec.name}, just around here.`,
    ...(t.rec.tip ? [t.rec.tip] : [])];
});
const texts = [
  INTRO,
  ...pois.filter((p) => BEST.includes(p.title)).map((p) => p.script).filter(Boolean),
  ...zones.flatMap((z) => z.facts),
  ...fillers,
  ...photoTips,
  ...localTips,
  ...Array.from({ length: 12 }, (_, i) => `Local tip number ${i + 1}.`),
  // turn-by-turn + arrival-side callouts (templates must match js/main.js)
  "Coming up — turn left.", "Coming up — turn right.",
  "Look to your left.", "Look to your right.",
];

fs.mkdirSync("audio", { recursive: true });
const manifest = fs.existsSync("audio/manifest.json")
  ? JSON.parse(fs.readFileSync("audio/manifest.json", "utf8")) : {};

let chars = 0, made = 0;
for (const t of texts) {
  const h = hash(t), file = h + ".mp3";
  if (manifest[h] && fs.existsSync("audio/" + file)) { process.stdout.write("-"); continue; }
  try {
    const buf = await tts(t);
    fs.writeFileSync("audio/" + file, buf);
    manifest[h] = file;
    chars += t.length; made++;
    process.stdout.write(".");
  } catch (e) { console.error("\n", e.message); break; }
}
fs.writeFileSync("audio/manifest.json", JSON.stringify(manifest, null, 1));
console.log(`\nBaked ${made} clips (~${chars} credits). Manifest: ${Object.keys(manifest).length} entries.`);
