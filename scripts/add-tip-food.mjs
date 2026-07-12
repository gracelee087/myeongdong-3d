// Food tips get the FOOD's photo (not the restaurant's storefront) + a YouTube
// link. Downloads one Wikimedia Commons dish photo per food tip into img/food/
// (local file = offline-safe demo) and stamps { food: {name, img, yt} } onto the
// tip in data/local-tips.json. Idempotent: skips tips that already have `food`
// and images that already exist.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const TIPS = "data/local-tips.json";
// [category, index, display name, commons search, youtube search]
const FOOD = [
  ["hot", 0, "Patbingsu", "patbingsu shaved ice", "patbingsu korean shaved ice"],
  ["hot", 1, "Samgyetang", "samgyetang", "samgyetang ginseng chicken soup"],
  ["hot", 2, "Ice-cup coffee", "iced coffee cup korea", "korean convenience store ice cup"],
  ["cold", 0, "Odeng (fish cake)", "eomuk skewer", "odeng korean fish cake street food"],
  ["rain", 0, "Pajeon & makgeolli", "pajeon", "pajeon makgeolli rainy day"],
  ["snow", 1, "Gun-goguma", "roasted sweet potato korea", "gungoguma roasted sweet potato korea"],
  ["night", 0, "Hotteok", "hotteok", "hotteok korean street food"],
  ["morning", 1, "Isaac Toast", "korean street toast", "isaac toast korea"],
  ["any", 5, "Kalguksu", "kalguksu", "myeongdong kyoja kalguksu"],
];

const UA = { headers: { "user-agent": "myeongdong-3d-hackathon/1.0 (demo app)" } };
async function commonsImage(query) {
  const u =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    "&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=" +
    encodeURIComponent(query) +
    "&prop=imageinfo&iiprop=url|mime&iiurlwidth=640";
  const j = await (await fetch(u, UA)).json();
  const pages = Object.values(j?.query?.pages || {});
  const pick = pages.find((p) => /jpe?g|png/i.test(p.imageinfo?.[0]?.mime || ""));
  return pick?.imageinfo?.[0]?.thumburl || null;
}

const db = JSON.parse(readFileSync(TIPS, "utf8"));
mkdirSync("img/food", { recursive: true });
let added = 0;
for (const [cat, idx, name, q, yt] of FOOD) {
  const tip = db.tips?.[cat]?.[idx];
  if (!tip || typeof tip === "string") { console.log(`skip ${cat}[${idx}] — missing/string`); continue; }
  if (tip.food) { console.log(`skip ${cat}[${idx}] — already has food`); continue; }
  const slug = name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
  const file = `img/food/${slug}.jpg`;
  if (!existsSync(file)) {
    const url = await commonsImage(q);
    if (!url) { console.log(`✗ ${name}: no commons image for "${q}"`); continue; }
    let buf = null;
    for (let tryN = 1; tryN <= 3 && !buf; tryN++) {
      const res = await fetch(url, UA);
      const b = Buffer.from(await res.arrayBuffer());
      if (res.ok && b.length >= 5000) buf = b;
      else {
        console.log(`  retry ${tryN} ${name}: status ${res.status}, ${b.length}B`);
        await new Promise((r) => setTimeout(r, 1500 * tryN));
      }
    }
    if (!buf) { console.log(`✗ ${name}: download failed`); continue; }
    writeFileSync(file, buf);
    console.log(`↓ ${name}: ${file} (${(buf.length / 1024).toFixed(0)} KB)`);
    await new Promise((r) => setTimeout(r, 800));
  }
  tip.food = {
    name,
    img: file,
    yt: "https://www.youtube.com/results?search_query=" + encodeURIComponent(yt),
  };
  added++;
}
writeFileSync(TIPS, JSON.stringify(db, null, 1));
console.log(`done — ${added} tips tagged with food media`);
