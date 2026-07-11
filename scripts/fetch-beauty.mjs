// One-time data build: every cosmetics shop in Myeongdong from OpenStreetMap
// (brand road-shops aren't in TourAPI). Writes data/myeongdong-beauty.json.
// Then generates one short audio blurb per BRAND (reused across branches).
//   node scripts/fetch-beauty.mjs
import fs from "node:fs";

const env = fs.readFileSync(".env", "utf8");
const OPENAI = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1]?.trim();

const QUERY = `
[out:json][timeout:60];
(
  node["shop"="cosmetics"](around:800,37.5615,126.9855);
  way["shop"="cosmetics"](around:800,37.5615,126.9855);
  node["name"~"올리브영|이니스프리|에뛰드|미샤|네이처리퍼블릭|토니모리|스킨푸드|더페이스샵|아리따움|홀리카|바닐라코|클리오|롬앤|이솝|러쉬|3CE"](around:800,37.5615,126.9855);
);
out center tags;`;

const MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

async function overpass() {
  for (const m of MIRRORS) {
    try {
      const r = await fetch(m, { method: "POST", body: "data=" + encodeURIComponent(QUERY) });
      if (r.ok) return await r.json();
      console.error(m, "→", r.status);
    } catch (e) { console.error(m, "→", e.message); }
  }
  throw new Error("all overpass mirrors failed");
}

// normalise a shop name to its brand (branch suffixes stripped)
const BRANDS = ["올리브영", "이니스프리", "에뛰드", "미샤", "네이처리퍼블릭", "토니모리", "스킨푸드",
  "더페이스샵", "아리따움", "홀리카홀리카", "바닐라코", "클리오", "롬앤", "이솝", "러쉬",
  "3CE", "설화수", "라네즈", "헤라", "더샘", "잇츠스킨", "너무너무", "시코르", "무지개맨션",
  "Olive Young", "Innisfree", "Etude", "Missha", "Nature Republic", "Tonymoly", "Skinfood",
  "The Face Shop", "Aritaum", "Holika Holika", "Banila Co", "Clio", "Aesop", "Lush", "3CE"];
function brandOf(name) {
  const n = (name || "").toLowerCase();
  for (const b of BRANDS) if (n.includes(b.toLowerCase())) return b;
  return name || "K-Beauty shop";
}

async function brandBlurb(brand, sample) {
  if (!OPENAI) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + OPENAI, "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini", temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a warm walking-tour audio guide in Myeongdong, Seoul. Reply ONLY JSON {\"enName\": string, \"script\": string}. enName: the shop's common English brand name. script: 2 spoken sentences (max 40 words) about this Korean cosmetics brand/shop — what it's famous for, one product or detail worth trying. Natural spoken English, no greetings." },
          { role: "user", content: `Brand/shop: ${brand}\nExample store name: ${sample}` },
        ],
      }),
    });
    if (!r.ok) throw new Error("openai " + r.status);
    return JSON.parse((await r.json()).choices[0].message.content);
  } catch (e) { console.error(" blurb fail:", brand, e.message); return null; }
}

(async () => {
  console.log("Querying OpenStreetMap for Myeongdong cosmetics shops…");
  const j = await overpass();
  const seen = new Set();
  let shops = j.elements.map((e) => {
    const t = e.tags || {};
    return {
      id: "kb-" + e.id,
      type: "beauty",
      title: t.name || t["name:en"] || "화장품",
      enName: t["name:en"] || "",
      brand: brandOf(t.name || t["name:en"]),
      lng: e.lon ?? e.center?.lon,
      lat: e.lat ?? e.center?.lat,
      hours: t.opening_hours || "",
      addr: t["addr:street"] ? `${t["addr:street"]} ${t["addr:housenumber"] || ""}`.trim() : "",
      tel: t.phone || "",
      image: "",
      menu: "",
    };
  }).filter((s) => s.lng && s.lat && s.title !== "화장품");
  // dedupe by name+rounded coords
  shops = shops.filter((s) => {
    const k = s.title + s.lng.toFixed(4) + s.lat.toFixed(4);
    return !seen.has(k) && seen.add(k);
  });
  console.log(`Found ${shops.length} cosmetics shops. Generating brand blurbs…`);

  const brands = [...new Set(shops.map((s) => s.brand))];
  const blurbs = {};
  for (const b of brands) {
    const sample = shops.find((s) => s.brand === b).title;
    const r = await brandBlurb(b, sample);
    if (r) blurbs[b] = r;
    process.stdout.write(r ? "." : "x");
  }
  console.log(`\nBlurbs: ${Object.keys(blurbs).length}/${brands.length} brands`);

  for (const s of shops) {
    const b = blurbs[s.brand];
    s.enName = s.enName || b?.enName || s.brand;
    s.script = b?.script ||
      `${s.enName}, one of Myeongdong's many Korean beauty shops — step inside for K-beauty skincare and free samples.`;
    s.scriptBy = b ? "openai" : "fallback";
    s.overview = s.script;
  }

  fs.writeFileSync("data/myeongdong-beauty.json",
    JSON.stringify({ area: "Myeongdong", source: "OpenStreetMap", count: shops.length, shops }, null, 1));
  console.log(`Wrote data/myeongdong-beauty.json (${shops.length} shops)`);
  console.log("Brands:", brands.join(" | "));
})();
