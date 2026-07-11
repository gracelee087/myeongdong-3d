// One-time data build: pull ~50 real Myeongdong POIs (attractions, food, shopping,
// culture) from the Korea TourAPI, including each place's real description (overview),
// and write data/myeongdong-pois.json. Pre-fetched so the live demo never depends on
// the API being up.  Run: node scripts/fetch-pois.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^TOURAPI_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.error("TOURAPI_KEY missing in .env"); process.exit(1); }

const BASE = "https://apis.data.go.kr/B551011/KorService2";
const CENTER = { mapX: 126.9855, mapY: 37.5615 };
const RADIUS = 1050;

const TYPES = {
  12: "attraction",
  14: "culture",
  38: "shopping",
  39: "food",
};

const common = {
  serviceKey: KEY, MobileOS: "ETC", MobileApp: "Myeongdong3D", _type: "json",
};

async function getJSON(path, params) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries({ ...common, ...params })) url.searchParams.set(k, v);
  const r = await fetch(url);
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error("bad json: " + t.slice(0, 120)); }
}

function items(j) {
  const it = j?.response?.body?.items?.item;
  return Array.isArray(it) ? it : it ? [it] : [];
}

async function listByType(ctid) {
  const j = await getJSON("/locationBasedList2", {
    numOfRows: 60, pageNo: 1, mapX: CENTER.mapX, mapY: CENTER.mapY,
    radius: RADIUS, arrange: "E", contentTypeId: ctid,
  });
  return items(j).map((x) => ({
    id: x.contentid,
    typeId: ctid,
    type: TYPES[ctid],
    title: x.title,
    lng: parseFloat(x.mapx),
    lat: parseFloat(x.mapy),
    dist: parseFloat(x.dist),
    addr: (x.addr1 || "") + (x.addr2 ? " " + x.addr2 : ""),
    tel: x.tel || "",
    image: x.firstimage || x.firstimage2 || "",
  }));
}

async function overview(id) {
  try {
    const j = await getJSON("/detailCommon2", { contentId: id });
    const it = items(j)[0];
    let o = (it?.overview || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return o;
  } catch { return ""; }
}

// opening hours + signature menu/items from detailIntro2 (fields differ per type)
const clean = (s) => (s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
async function intro(p) {
  try {
    const j = await getJSON("/detailIntro2", { contentId: p.id, contentTypeId: p.typeId });
    const it = items(j)[0] || {};
    const hours = clean(it.opentimefood || it.opentime || it.usetime || it.usetimeculture);
    const rest = clean(it.restdatefood || it.restdateshopping || it.restdate || it.restdateculture);
    const menu = clean(it.treatmenu || it.firstmenu || it.saleitem);
    return { hours, rest, menu };
  } catch { return { hours: "", rest: "", menu: "" }; }
}

async function pool(arr, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx], idx); }
  }));
  return out;
}

(async () => {
  console.log("Fetching lists…");
  let all = [];
  for (const ct of Object.keys(TYPES)) {
    const list = await listByType(ct);
    console.log(`  type ${ct} (${TYPES[ct]}): ${list.length}`);
    all = all.concat(list);
  }
  // dedupe by id, keep valid coords
  const seen = new Set();
  all = all.filter((p) => p.lng && p.lat && !seen.has(p.id) && seen.add(p.id));
  // sort by distance, cap at 100
  all.sort((a, b) => a.dist - b.dist);
  all = all.slice(0, 100);
  console.log(`Merged unique POIs: ${all.length}. Fetching overviews + hours/menus…`);

  await pool(all, 6, async (p) => {
    p.overview = await overview(p.id);
    Object.assign(p, await intro(p));
  });
  const withDesc = all.filter((p) => p.overview).length;
  const withHours = all.filter((p) => p.hours).length;
  console.log(`Overviews: ${withDesc}/${all.length} · hours: ${withHours}/${all.length}`);

  // keep already-generated audio scripts / english names from the previous build
  try {
    const prev = JSON.parse(fs.readFileSync("data/myeongdong-pois.json", "utf8"));
    const byId = new Map(prev.pois.map((p) => [p.id, p]));
    let kept = 0;
    for (const p of all) {
      const o = byId.get(p.id);
      if (o?.script && o.scriptBy && o.scriptBy !== "fallback") {
        p.enName = o.enName; p.script = o.script; p.scriptBy = o.scriptBy; kept++;
      }
    }
    console.log(`Preserved existing scripts: ${kept}`);
  } catch { /* first build */ }

  const out = {
    city: "Seoul", area: "Myeongdong", center: CENTER,
    count: all.length, generatedFor: "DEV Weekend Challenge",
    pois: all,
  };
  fs.writeFileSync("data/myeongdong-pois.json", JSON.stringify(out, null, 1));
  console.log("Wrote data/myeongdong-pois.json (" + fs.statSync("data/myeongdong-pois.json").size + " bytes)");
  console.log("Sample:", all.slice(0, 6).map((p) => `${p.type}:${p.title}`).join(" | "));
})();
