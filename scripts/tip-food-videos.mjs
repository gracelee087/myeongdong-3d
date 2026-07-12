// Bake one YouTube video per food tip so the tip card's "Watch preview" opens
// the SAME in-app modal as every other spot (no new tabs). Same API + news
// filter as fetch-videos.mjs. Idempotent: skips tips that already have a video.
//   node scripts/tip-food-videos.mjs
import fs from "node:fs";

const KEY = (fs.readFileSync(".env", "utf8").match(/^GOOGLE_MAPS_KEY=(.+)$/m) || [])[1]?.trim();
const NEWS = /뉴스|news|속보|기자|취재|다큐|시사|KBS|MBC|SBS|YTN|JTBC|연합|TV조선|채널A|MBN|매일경제|한국경제|조선일보|중앙일보|동아일보|아리랑|Arirang|EBS|국민일보|헤럴드|뉴시스|노컷|오마이|이데일리|머니투데이/i;
const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');

const QUERIES = {
  "hot.0": "팥빙수 먹방 명동",
  "hot.1": "삼계탕 맛집 서울",
  "hot.2": "편의점 아이스컵 꿀조합",
  "cold.0": "오뎅 어묵 길거리 붕어빵 포장마차",
  "rain.0": "파전 막걸리 비오는날",
  "snow.1": "군고구마 겨울 간식",
  "night.0": "호떡 명동 길거리음식",
  "morning.1": "이삭토스트 먹방",
  "any.5": "명동교자 칼국수",
};

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
  if (!r.ok) throw new Error("youtube " + r.status);
  const j = await r.json();
  return (j.items || []).find(
    (v) => !NEWS.test(v.snippet.channelTitle) && !NEWS.test(v.snippet.title)
  );
}

const db = JSON.parse(fs.readFileSync("data/local-tips.json", "utf8"));
let n = 0;
for (const [key, q] of Object.entries(QUERIES)) {
  const [cat, idx] = key.split(".");
  const tip = db.tips?.[cat]?.[+idx];
  if (!tip?.food) { console.log(`skip ${key} — no food tag`); continue; }
  if (tip.food.video) { console.log(`skip ${key} — already has video`); continue; }
  const v = await search(q);
  if (!v) { console.log(`✗ ${key}: no result for "${q}"`); continue; }
  tip.food.video = v.id.videoId;
  tip.food.videoTitle = unesc(v.snippet.title);
  console.log(`✓ ${key} ${tip.food.name} → ${v.id.videoId} · ${tip.food.videoTitle.slice(0, 50)}`);
  n++;
}
fs.writeFileSync("data/local-tips.json", JSON.stringify(db, null, 1));
console.log(`done — ${n} tip videos baked`);
