// Translate Korean POI metadata (opening hours / signature menu / sale items)
// into concise English for the sidebar — the audience is foreign travellers.
// Batched through gpt-4o-mini, baked into data/myeongdong-pois.json.
//   node scripts/translate-meta.mjs
import fs from "node:fs";

const OPENAI = (fs.readFileSync(".env", "utf8").match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!OPENAI) { console.error("OPENAI_API_KEY missing"); process.exit(1); }

const data = JSON.parse(fs.readFileSync("data/myeongdong-pois.json", "utf8"));
const hasKorean = (s) => /[가-힣]/.test(s || "");
const todo = data.pois.filter((p) => hasKorean(p.hours) || hasKorean(p.menu) || hasKorean(p.rest));
console.log(`Translating metadata for ${todo.length}/${data.pois.length} POIs…`);

async function translateBatch(batch) {
  const items = batch.map((p, i) => ({ i, hours: p.hours || "", menu: p.menu || "", rest: p.rest || "" }));
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + OPENAI, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini", temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system", content:
            "Translate Korean shop metadata to VERY concise English for a tourist app sidebar. " +
            "Reply ONLY JSON: {\"items\":[{\"i\":number,\"hours\":string,\"menu\":string,\"rest\":string}]}. " +
            "hours: compact like 'Mon–Fri 10:30–21:00, Sat 11:00–20:00' (keep only the essence, max 40 chars). " +
            "menu: food dishes / sale items in English, ' / ' separated, max 5 items (e.g. 'Dumplings / Bibim noodles'). " +
            "rest: closed days like 'Closed Sundays' or '' if none/annual holidays only. Keep '' fields as ''.",
        },
        { role: "user", content: JSON.stringify({ items }) },
      ],
    }),
  });
  if (!r.ok) throw new Error("openai " + r.status + " " + (await r.text()).slice(0, 100));
  return JSON.parse((await r.json()).choices[0].message.content).items;
}

const BATCH = 20;
let done = 0;
for (let off = 0; off < todo.length; off += BATCH) {
  const batch = todo.slice(off, off + BATCH);
  try {
    const out = await translateBatch(batch);
    for (const o of out) {
      const p = batch[o.i];
      if (!p) continue;
      if (o.hours) p.hours = o.hours;
      if (o.menu) p.menu = o.menu;
      p.rest = o.rest || "";
      done++;
    }
    process.stdout.write(".");
  } catch (e) { console.error("\nbatch fail:", e.message); }
}
fs.writeFileSync("data/myeongdong-pois.json", JSON.stringify(data, null, 1));
console.log(`\nTranslated ${done}. Sample:`,
  data.pois.filter((p) => p.menu).slice(0, 3).map((p) => `${p.enName}: ${p.menu} | ${p.hours}`).join("\n  "));
