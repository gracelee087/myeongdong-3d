// Bake one YouTube video per POI (what is this place / what do they sell) so
// tourists can preview before walking in. Uses the official YouTube Data API v3
// at build time; playback in-app is a plain embed (zero quota).
//
// Quota note: search costs 100 units, default quota 10,000/day → ~100 searches.
// The script SKIPS POIs that already have a video, so just re-run it the next
// day to finish the rest. Priority order: Best → food → beauty → shopping → rest.
//   node scripts/fetch-videos.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^GOOGLE_MAPS_KEY=(.+)$/m) || [])[1]?.trim();

const BEST = ["명동", "서울 명동성당", "명동교자", "왕비집", "남산케이블카", "남산골한옥마을",
  "신세계백화점 본점", "롯데백화점 본점", "남대문시장", "뷰티플레이", "원조남산왕돈까스", "평래옥"];

// tourists want a youtuber's EXPERIENCE, not the news — hard-filter news outlets
const NEWS = /뉴스|news|속보|기자|취재|다큐|시사|KBS|MBC|SBS|YTN|JTBC|연합|TV조선|채널A|MBN|매일경제|한국경제|조선일보|중앙일보|동아일보|아리랑|Arirang|EBS|국민일보|헤럴드|뉴시스|노컷|오마이|이데일리|머니투데이/i;
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

async function search(q) {
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  u.searchParams.set("part", "snippet");
  u.searchParams.set("q", q);
  u.searchParams.set("type", "video");
  u.searchParams.set("maxResults", "10");
  u.searchParams.set("videoEmbeddable", "true");
  u.searchParams.set("safeSearch", "moderate");
  u.searchParams.set("key", KEY);
  const r = await fetch(u);
  if (r.status === 403 || r.status === 429) throw Object.assign(new Error("quota/blocked " + r.status), { fatal: true });
  if (!r.ok) throw new Error("yt " + r.status);
  const items = (await r.json()).items || [];
  const v = items.find((i) => !NEWS.test(i.snippet.channelTitle) && !NEWS.test(i.snippet.title));
  return v ? { video: v.id.videoId, videoTitle: unesc(v.snippet.title), videoBy: unesc(v.snippet.channelTitle) } : null;
}

// query ladder per type — vlog/mukbang first, plain last
function queriesFor(p) {
  const t = p.title;
  if (p.type === "food") return [`${t} 명동 먹방`, `${t} 브이로그`, `${t} 명동`];
  if (p.type === "beauty") return [`${t} 명동 쇼핑 브이로그`, `${t} 하울`, `${t} 명동`];
  if (p.type === "shopping") return [`${t} 쇼핑 브이로그`, `${t} vlog`, `${t} 명동`];
  return [`${t} 브이로그`, `${p.enName || t} vlog`, `${t} 명동`];
}
async function searchLadder(p) {
  for (const q of queriesFor(p)) {
    const r = await search(q);
    if (r) return r;
  }
  return null;
}

const pois = JSON.parse(fs.readFileSync("data/myeongdong-pois.json", "utf8"));
const beauty = JSON.parse(fs.readFileSync("data/myeongdong-beauty.json", "utf8"));

// priority: Best course → K-Beauty brands (branches share one video) → food → rest
// --rebake: re-search everything (e.g. after improving the query/news filter),
// keeping the old video when no better result is found.
const REBAKE = process.argv.includes("--rebake");
const want = (x) => REBAKE || !x.video;
const prio = (p) => BEST.includes(p.title) ? 0 : p.type === "food" ? 2 : p.type === "shopping" ? 4 : 3;
const queueP = pois.pois.filter(want).sort((a, b) => prio(a) - prio(b));
const brands = [...new Set(beauty.shops.filter(want).map((s) => s.brand))];
const queue = [
  ...queueP.filter((p) => prio(p) === 0).map((p) => ({ kind: "poi", p })),
  ...brands.map((b) => ({ kind: "brand", b })),
  ...queueP.filter((p) => prio(p) > 0).map((p) => ({ kind: "poi", p })),
];

let used = 0, got = 0, stopped = false;
for (const item of queue) {
  if (stopped) break;
  try {
    used++;
    if (item.kind === "poi") {
      const r = await searchLadder(item.p);
      if (r) { Object.assign(item.p, r); got++; process.stdout.write("."); }
      else process.stdout.write("o");
    } else {
      const r = await searchLadder({ title: item.b, type: "beauty" });
      if (r) {
        for (const s of beauty.shops) if (s.brand === item.b && (REBAKE || !s.video)) Object.assign(s, r);
        got++; process.stdout.write(".");
      } else process.stdout.write("o");
    }
  } catch (e) { if (e.fatal) { stopped = true; console.error("\nAPI stopped (quota/blocked) after", used, "searches"); } }
}

fs.writeFileSync("data/myeongdong-pois.json", JSON.stringify(pois, null, 1));
fs.writeFileSync("data/myeongdong-beauty.json", JSON.stringify(beauty, null, 1));
const totalP = pois.pois.filter((p) => p.video).length;
const totalB = beauty.shops.filter((s) => s.video).length;
console.log(`\nSearches used: ${used} (~${used * 100} quota units) · new videos: ${got}`);
console.log(`Coverage now — pois: ${totalP}/${pois.pois.length} · beauty: ${totalB}/${beauty.shops.length}`);
if (stopped) console.log("Re-run tomorrow (or with a fresh key) to fill the rest — already-done POIs are skipped.");
