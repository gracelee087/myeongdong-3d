// Gemini writes CONDITION-AWARE insider tips: the guide reacts to the real
// Seoul weather/time when you arrive somewhere ("It's scorching today — time
// for patbingsu...") and teaches one Korean culture concept with a concrete
// action. Baked to data/local-tips.json.
//   node scripts/gen-local-tips.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^GEMINI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.error("GEMINI_API_KEY missing"); process.exit(1); }
const MODEL = "gemini-3.5-flash";

// per-condition seed topics — real, positive, useful Korean culture
const BUCKETS = {
  hot: {
    cond: "It is a HOT summer day in Seoul (28°C+), the traveller is sweating on the street",
    seeds: [
      "patbingsu (shaved-ice with red bean) — Myeongdong cafes pile them huge; perfect cooldown",
      "yi-yeol-chi-yeol (이열치열, 'fight heat with heat') — why Koreans eat boiling samgyetang on the hottest days",
      "Korean convenience stores (GS25/CU): ice-cup culture — buy any drink + a cup of ice, mix at the counter like locals",
      "cooling-off in Olive Young / department store basements — free AC, no one minds browsing",
    ],
  },
  cold: {
    cond: "It is a COLD day in Seoul (below 8°C), the traveller's hands are freezing",
    seeds: [
      "winter street-snack trinity: bungeoppang (fish-shaped red-bean bread), hotteok (brown-sugar pancake), odeng cups with free hot broth",
      "hot-pack (핫팩) culture — every convenience store sells shake-to-heat packs; Koreans keep them in coat pockets all winter",
      "sauna/jjimjilbang culture — where Koreans go to thaw out; sweet sikhye rice drink and baked eggs inside",
    ],
  },
  rain: {
    cond: "It is RAINING in Seoul right now",
    seeds: [
      "pajeon + makgeolli on rainy days — Koreans swear the sizzle of the pancake sounds like rain; every Korean craves it when it pours",
      "cheap clear umbrellas at any convenience store (~5,000 won) — nobody carries one in advance, everyone buys on the spot",
    ],
  },
  snow: {
    cond: "It is SNOWING in Seoul",
    seeds: [
      "first-snow (첫눈) culture — Koreans text loved ones when the first snow falls; couples promise to meet on that day",
      "roasted sweet potato (군고구마) and roasted chestnuts season — the classic snowy-day street snack",
    ],
  },
  night: {
    cond: "It is EVENING/NIGHT in Myeongdong, the neon signs are on",
    seeds: [
      "night market food carts on the main street light up after 5pm — try tornado potato, grilled cheese lobster, hotteok; standing and eating right there is the correct way",
      "hweshik / 2-cha culture — why Seoul nights move in 'rounds': dinner is round one, cafe or noraebang is round two",
      "noraebang (karaoke rooms) — private singing rooms floors above the shops; tambourines included, no one can hear you",
    ],
  },
  morning: {
    cond: "It is MORNING in Myeongdong, shops are just opening",
    seeds: [
      "Myeongdong wakes up late — most shops open 10:30-11:00; mornings are for palaces and cafes, evenings for shopping",
      "Korean cafe breakfast culture — bakery cafes (like Isaac Toast nearby) do grilled breakfast toast Koreans line up for before work",
    ],
  },
  any: {
    cond: "Any time in Myeongdong",
    seeds: [
      "free samples (샘플) culture in K-beauty shops — staff tuck extra sachets into your bag; it's polite to accept, and asking 'sample juseyo' works wonders",
      "T-money card from any convenience store works on subway, bus, taxis AND pays at convenience stores",
      "Korean age of politeness: receive items/change with both hands — locals will notice and smile",
      "'service' (서비스) — when a shop or restaurant gives you something free, they say 'service!'; just say gamsahamnida",
      "Myeongdong's underground shopping arcade below the station — locals' secret for socks, K-pop goods and phone cases at half the street price",
      "number-ticket queueing (번호표) — popular restaurants use kiosk tickets; grab one first, then window-shop until your number is called",
    ],
  },
};

async function gen(cond, seed) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are a warm Korean local friend guiding a foreign traveller through Myeongdong by voice. " +
              "Reply ONLY JSON {\"tip\": string}. tip: 2-3 spoken sentences (max 55 words). " +
              "Start by empathising with the CURRENT situation (weather/time) naturally, then teach ONE Korean culture thing " +
              "from the topic — what it is, why Koreans love it, and exactly what the traveller should do or order. " +
              "Positive and fun only. Natural spoken English, no emojis, no 'welcome'.",
          }],
        },
        contents: [{ role: "user", parts: [{ text: `Situation: ${cond}\nTopic: ${seed}` }] }],
        generationConfig: { temperature: 0.75, responseMimeType: "application/json", maxOutputTokens: 4096 },
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

let prev = {};
try { prev = JSON.parse(fs.readFileSync("data/local-tips.json", "utf8")).tips || {}; } catch { /* first run */ }
const out = {};
for (const [key, b] of Object.entries(BUCKETS)) {
  out[key] = [];
  for (const seed of b.seeds) {
    let tip = null;
    for (let a = 0; a < 3 && !tip; a++) {
      try { tip = await gen(b.cond, seed); } catch (e) { if (a === 2) console.error("\n", key, e.message); }
    }
    if (tip) { out[key].push(tip); process.stdout.write("."); }
  }
  // never lose previously-generated tips for a bucket
  for (const old of prev[key] || []) if (out[key].length < b.seeds.length && !out[key].includes(old)) out[key].push(old);
}
fs.writeFileSync("data/local-tips.json", JSON.stringify({ generator: "gemini-3.5-flash", tips: out }, null, 1));
console.log("\nSaved data/local-tips.json:", Object.entries(out).map(([k, v]) => `${k}=${v.length}`).join(" "));
