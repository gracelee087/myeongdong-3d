// Myeongdong 3D — a stylised game-diorama walking audio guide.
// 1,408 real OSM buildings extruded to real heights (Tokyo-Metro-3D style),
// you walk the real streets and famous places explain themselves (ElevenLabs),
// with Myeongdong filler commentary between.
import { playNarration, prefetch, stop as audioStop, pause as audioPause, resume as audioResume, isPlaying } from "./audio.js";
import { initScene, followCam, orbitCam, moveAvatar3d, markVisited, resetPins, render, setEnvironment, updateRoute, setPinActive, addPin, removePin, highlightCourse } from "./scene.js";

const el = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WALK_SPEED = 12;         // metres / second along the street path
const ROT_SPEED = 4;           // idle overview spin, deg/s
const POI_TRIGGER = 40;        // metres — "you're in front of it"
const FILLER_EVERY_M = 190;
const TYPE_GLYPH = { food: "🍜", attraction: "📸", culture: "🎭", shopping: "🛍️", beauty: "💄", custom: "🎯" };

// themed courses — different travellers want different Myeongdongs
const BEST = ["명동", "서울 명동성당", "명동교자", "왕비집", "남산케이블카", "남산골한옥마을",
  "신세계백화점 본점", "롯데백화점 본점", "남대문시장", "뷰티플레이", "원조남산왕돈까스", "평래옥", "청계천"];
const COURSES = [
  { id: "best", icon: "⭐", name: "Best of Myeongdong", pick: (p) => BEST.includes(p.title) },
  { id: "food", icon: "🍜", name: "Foodie Tour", pick: (p) => p.type === "food" },
  { id: "shopping", icon: "🛍️", name: "Shopping", pick: (p) => p.type === "shopping" },
  { id: "kbeauty", icon: "💄", name: "K-Beauty All-In", pick: (p) => p.type === "beauty" },
  { id: "culture", icon: "📸", name: "Culture & History", pick: (p) => p.type === "attraction" || p.type === "culture" },
  { id: "all", icon: "🌟", name: "Everything", pick: () => true },
  { id: "picks", icon: "🎯", name: "My Picks", pick: (p) => state.picks.has(p.id) },
];

// nearby subway stations — every tourist arrives underground
const SUBWAY = [
  { name: "명동역", en: "Myeongdong", lines: [{ n: "4", c: "#00a4e3" }], lng: 126.98630, lat: 37.56085 },
  { name: "을지로입구역", en: "Euljiro 1-ga", lines: [{ n: "2", c: "#00b140" }], lng: 126.98230, lat: 37.56600 },
  { name: "을지로3가역", en: "Euljiro 3-ga", lines: [{ n: "2", c: "#00b140" }, { n: "3", c: "#ef7c1c" }], lng: 126.99190, lat: 37.56640 },
  { name: "회현역", en: "Hoehyeon", lines: [{ n: "4", c: "#00a4e3" }], lng: 126.97860, lat: 37.55860 },
];

// spoken the moment the walk starts (also pre-baked to mp3 by scripts/bake-audio.mjs)
const INTRO =
  "You're standing at Myeongdong Station, Exit six — the front door of Myeongdong. " +
  "Pop your earphones in and follow the yellow line. Every time we pass somewhere special, I'll tell you all about it. Let's go.";

const state = {
  pois: [], coursePois: [], courseId: "best", picks: new Set(), fillers: [],
  zones: [], usedFacts: new Set(), fi: 0,
  graph: null, route: [], walkPath: [], cum: [], pathLen: 0, cumI: 1,
  // simulation always begins at Myeongdong Station Exit 6 — the main Myeongdong-street exit
  center: { lng: 126.9855, lat: 37.5615 }, start: { lng: 126.98565, lat: 37.56070 },
  activeId: null, visited: new Set(),
  mode: "sim", walkDist: 0, camHeading: 20, avatarPos: null,
  tour: { running: false, paused: false }, gps: { watchId: null, heading: 0 },
};

// ---------- geo ----------
const lerp = (a, b, t) => a + (b - a) * t;
function metersBetween(a, b, lat) {
  const k = Math.cos((lat * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * 111320 * k, (a[1] - b[1]) * 111320);
}
function bearingTo(a, b) {
  const dLng = (b.lng - a.lng) * Math.PI / 180, la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLng);
  const br = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return Number.isFinite(br) ? br : state.camHeading;
}

// ---------- street graph + routing ----------
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break;[a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (; ;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break;[a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}
function buildGraph(streets) {
  const coord = new Map(), adj = new Map();
  const add = (a, b, w) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push([b, w]); };
  for (const way of streets.ways) for (let i = 0; i < way.length; i++) {
    const [id, lng, lat] = way[i]; coord.set(id, [lng, lat]);
    if (i > 0) { const [pid, plng, plat] = way[i - 1]; const w = metersBetween([lng, lat], [plng, plat], lat); add(id, pid, w); add(pid, id, w); }
  }
  // keep only the LARGEST connected component — snapping to a disconnected
  // island makes Dijkstra fail and the walker cut straight through buildings
  const seen = new Set(); let main = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp = new Set([start]), q = [start]; seen.add(start);
    while (q.length) {
      const u = q.pop();
      for (const [v] of (adj.get(u) || [])) if (!seen.has(v)) { seen.add(v); comp.add(v); q.push(v); }
    }
    if (comp.size > main.size) main = comp;
  }
  return { coord, adj, main };
}
function nearestNode(g, lng, lat) {
  let best = null, bd = Infinity;
  for (const id of g.main) {
    const c = g.coord.get(id);
    const d = metersBetween([lng, lat], c, lat);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
function dijkstraPath(g, src, dst) {
  const dist = new Map([[src, 0]]), prev = new Map(), done = new Set(), h = new Heap(); h.push([0, src]);
  while (h.size) {
    const [d, u] = h.pop(); if (done.has(u)) continue; done.add(u); if (u === dst) break;
    for (const [v, w] of (g.adj.get(u) || [])) { const nd = d + w; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); h.push([nd, v]); } }
  }
  if (src !== dst && !prev.has(dst)) return null;
  const path = []; let cur = dst;
  while (cur !== undefined) { const c = g.coord.get(cur); path.push([c[0], c[1]]); if (cur === src) break; cur = prev.get(cur); }
  return path.reverse();
}
function densify(coords, step = 6) {
  const out = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1], d = metersBetween(a, b, a[1]), n = Math.max(1, Math.round(d / step));
    for (let k = 0; k < n; k++) { const t = k / n; out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]); }
  }
  out.push(coords[coords.length - 1]);
  return out;
}
function buildRoute(start, pois) {
  const rem = pois.slice(), route = []; let cur = start;
  while (rem.length) { let bi = 0, bd = Infinity; for (let i = 0; i < rem.length; i++) { const d = metersBetween([cur.lng, cur.lat], [rem[i].lng, rem[i].lat], cur.lat); if (d < bd) { bd = d; bi = i; } } cur = rem[bi]; route.push(rem.splice(bi, 1)[0]); }
  return route;
}
function buildWalkPath(g, start, ordered) {
  const wps = [start, ...ordered]; let coords = [];
  for (let i = 0; i < wps.length - 1; i++) {
    const a = nearestNode(g, wps[i].lng, wps[i].lat), b = nearestNode(g, wps[i + 1].lng, wps[i + 1].lat);
    let seg = dijkstraPath(g, a, b);
    if (!seg || seg.length < 2) seg = [[wps[i].lng, wps[i].lat], [wps[i + 1].lng, wps[i + 1].lat]];
    coords.push(...(coords.length ? seg.slice(1) : seg));
  }
  return densify(coords, 6);
}
function pointAlongPath(d) {
  const P = state.walkPath, C = state.cum;
  if (d <= 0) return { pos: P[0], heading: bearingTo({ lng: P[0][0], lat: P[0][1] }, { lng: P[1][0], lat: P[1][1] }) };
  let i = state.cumI; while (i < C.length && C[i] < d) i++; state.cumI = i;
  if (i >= P.length) return { pos: P[P.length - 1], heading: state.camHeading };
  const a = P[i - 1], b = P[i], seg = C[i] - C[i - 1], t = seg > 0 ? (d - C[i - 1]) / seg : 0;
  return { pos: [lerp(a[0], b[0], t), lerp(a[1], b[1], t)], heading: bearingTo({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] }) };
}

// ---------- ui ----------
function showError(t, m) { el("overlay").classList.remove("hidden"); el("spinner").style.display = "none"; el("overlayTitle").textContent = t; el("overlayMsg").innerHTML = m; }
const hideOverlay = () => el("overlay").classList.add("hidden");
let toastTimer;
function toast(msg, ms = 3600) { const t = el("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); if (ms) toastTimer = setTimeout(() => t.classList.remove("show"), ms); }
const toastClear = () => el("toast").classList.remove("show");

// ---------- game HUD ----------
const showHud = (on) => el("hud").classList.toggle("show", on);
function updateHud() {
  el("hudCount").textContent = `${state.visited.size} / ${state.coursePois.length}`;
  const pct = state.pathLen ? Math.min(100, (state.walkDist / state.pathLen) * 100) : 0;
  el("hudFill").style.width = pct.toFixed(1) + "%";
}
function setNowPlaying(text) {
  const n = el("hudNow"); if (!text) { n.hidden = true; return; }
  el("hudNowText").textContent = text; n.hidden = false;
}
let discTimer;
function showDiscovery(poi) {
  el("discName").textContent = poi.enName || poi.title;
  el("discKo").textContent = poi.title;
  const d = el("discovery"); d.classList.remove("show"); void d.offsetWidth; d.classList.add("show");
  clearTimeout(discTimer); discTimer = setTimeout(() => d.classList.remove("show"), 2400);
}

// ---------- Google Maps hand-off (foreigners live in Google Maps) ----------
const gmapsUrl = (p) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.title + " " + (p.addr || "서울 명동"))}`;

// ---------- video preview (know a place BEFORE you walk in) ----------
function openVideo(p) {
  if (p.video) {
    // auto-pause the tour + narration while the preview plays
    if (state.tour.running && !state.tour.paused) { togglePause(); state._videoPaused = true; }
    else if (!state.tour.running && isPlaying()) { audioPause(); state._videoPaused = "audio"; }
    el("videoTitle").textContent = p.videoTitle || (p.enName || p.title);
    el("videoFrame").src = `https://www.youtube-nocookie.com/embed/${p.video}?autoplay=1`;
    el("videoModal").classList.add("show");
  } else {
    // no baked video yet — fall back to a YouTube search in a new tab
    window.open("https://www.youtube.com/results?search_query=" +
      encodeURIComponent(`${p.title} 명동`), "_blank");
  }
}
function closeVideo() {
  el("videoModal").classList.remove("show");
  el("videoFrame").src = "";
  // resume exactly what we paused
  if (state._videoPaused === true && state.tour.running && state.tour.paused) togglePause();
  else if (state._videoPaused === "audio") audioResume();
  state._videoPaused = false;
}

// ---------- spot card ----------
const fixImg = (u) => (u ? u.replace(/^http:\/\//, "https://") : "");
function showSpot(poi) {
  el("spotType").textContent = poi.type.toUpperCase(); el("spotType").className = "badge " + poi.type;
  el("spotIdx").textContent = `${state.visited.size} / ${state.coursePois.length}`;
  el("spotName").textContent = poi.enName || poi.title;
  el("spotKo").textContent = poi.title + (poi.tel ? " · " + poi.tel : "");
  el("spotBlurb").innerHTML = `<span class="audio-dot"></span>${poi.script || poi.overview || ""}`;
  // Korean address — copyable, made to be shown to a taxi driver / shop staff
  const addr = poi.addr || "";
  el("spotAddrRow").style.display = addr ? "" : "none";
  el("spotAddr").textContent = addr;
  el("spotCopy").onclick = async () => {
    try { await navigator.clipboard.writeText(addr); toast("📋 Korean address copied"); }
    catch { toast("Couldn't copy — long-press the address to select it"); }
  };
  const img = el("spotPhoto"), src = fixImg(poi.image); if (src) { img.src = src; img.hidden = false; } else img.hidden = true;
  document.querySelector(".spot-actions").style.display = "";
  const vb = el("spotVideo");
  vb.textContent = poi.video ? "▶ Watch preview" : "▶ Preview";
  vb.onclick = () => openVideo(poi);
  el("spotGmap").href = gmapsUrl(poi);
  el("spotCard").classList.add("show");
}
function showFillerCard(text, where = "") {
  el("spotType").textContent = where ? "LOCAL STORY" : "MYEONGDONG"; el("spotType").className = "badge attraction";
  el("spotIdx").textContent = ""; el("spotName").textContent = where || "About Myeongdong";
  el("spotKo").textContent = "이 거리 이야기"; el("spotBlurb").innerHTML = `<span class="audio-dot"></span>${text}`;
  el("spotAddrRow").style.display = "none";
  // Myeongdong street photo (from the 명동 POI) so the story card isn't bare
  const img = el("spotPhoto");
  if (state.mdImage) { img.src = state.mdImage; img.hidden = false; } else img.hidden = true;
  document.querySelector(".spot-actions").style.display = "none";
  el("spotCard").classList.add("show");
}

// ---------- narration ----------
function nearestUnvisitedWithin(lng, lat, r) {
  let best = null, bd = r;
  for (const p of state.coursePois) { if (state.visited.has(p.id)) continue; const d = metersBetween([lng, lat], [p.lng, p.lat], lat); if (d < bd) { bd = d; best = p; } }
  return best;
}
async function narratePoi(poi) {
  state.activeId = poi.id; state.visited.add(poi.id); markVisited(poi.id);
  showSpot(poi); updateHud(); showDiscovery(poi); setNowPlaying(`🎧 ${poi.enName || poi.title}`);
  const next = state.coursePois.find((p) => !state.visited.has(p.id));
  if (next) prefetch(next.script);
  await playNarration(poi.script || poi.overview || `${poi.enName || poi.title}, a favourite spot in Myeongdong.`);
}
// pick a story about WHERE you are right now: zone facts (real local history)
// first, generic Myeongdong lines only when the area's stories run out
function localStory(pos) {
  let z = null, bd = Infinity;
  for (const zone of state.zones) {
    const d = metersBetween(pos, [zone.lng, zone.lat], zone.lat);
    if (d < zone.r && d < bd) { bd = d; z = zone; }
  }
  if (z) {
    const fact = z.facts.find((t) => !state.usedFacts.has(t));
    if (fact) { state.usedFacts.add(fact); return { text: fact, where: z.name }; }
  }
  return { text: state.fillers[state.fi++ % state.fillers.length], where: "" };
}
async function walkNarrationLoop() {
  let lastNarrateDist = -FILLER_EVERY_M;
  while (state.tour.running) {
    if (state.tour.paused) { await sleep(150); continue; }
    const a = state.avatarPos;
    if (a) {
      const poi = nearestUnvisitedWithin(a[0], a[1], POI_TRIGGER);
      if (poi) {
        state.tour.paused = true;
        toast(`📍 ${poi.enName || poi.title}`);
        await narratePoi(poi);
        state.tour.paused = false;
        lastNarrateDist = state.walkDist;
      } else if (!isPlaying() && state.walkDist - lastNarrateDist > FILLER_EVERY_M) {
        const { text, where } = localStory(a);
        showFillerCard(text, where); setNowPlaying(`🎧 ${where || "About Myeongdong"}`); playNarration(text);
        lastNarrateDist = state.walkDist;
      }
    }
    updateHud();
    await sleep(220);
  }
}

// ---------- themed courses ----------
function routeOrigin() {
  // GPS: route from wherever you are; simulation: always Myeongdong Stn Exit 4
  return state.mode === "gps" && state.avatarPos
    ? { lng: state.avatarPos[0], lat: state.avatarPos[1] } : state.start;
}
function applyCourse(id) {
  state.courseId = id;
  const course = COURSES.find((c) => c.id === id);
  state.coursePois = state.pois.filter(course.pick);
  if (state.coursePois.length) {
    const origin = routeOrigin();
    state.route = buildRoute(origin, state.coursePois);
    state.walkPath = buildWalkPath(state.graph, origin, state.route);
    state.cum = [0]; for (let i = 1; i < state.walkPath.length; i++) state.cum[i] = state.cum[i - 1] + metersBetween(state.walkPath[i - 1], state.walkPath[i], state.walkPath[i][1]);
    state.pathLen = state.cum[state.cum.length - 1];
    updateRoute(state.walkPath);
  } else { state.pathLen = 0; updateRoute([[state.start.lng, state.start.lat], [state.start.lng, state.start.lat]]); }
  state.walkDist = 0; state.cumI = 1; state.visited.clear(); state.activeId = null;
  setPinActive(new Set(state.coursePois.map((p) => p.id)));
  highlightCourse(state.coursePois.map((p) => [p.lng, p.lat]));
  updateHud();
  document.querySelectorAll("#courseBar button").forEach((b) => b.classList.toggle("active", b.dataset.course === id));
  renderSidebar();
  el("startBtn").disabled = !state.coursePois.length;
}

// ---------- My Picks — build your own route ----------
function savePicks() {
  const custom = state.pois.filter((p) => p.type === "custom" && state.picks.has(p.id));
  localStorage.setItem("md3d-picks", JSON.stringify({ ids: [...state.picks], custom }));
}
function loadPicks() {
  try {
    const { ids, custom } = JSON.parse(localStorage.getItem("md3d-picks") || "{}");
    for (const p of custom || []) if (!state.pois.find((x) => x.id === p.id)) { state.pois.push(p); addPin(p, TYPE_GLYPH.custom); }
    for (const id of ids || []) if (state.pois.find((p) => p.id === id)) state.picks.add(id);
  } catch { /* fresh start */ }
}
function togglePick(poi) {
  state.picks.has(poi.id) ? state.picks.delete(poi.id) : state.picks.add(poi.id);
  savePicks();
  const chip = document.querySelector('#courseBar button[data-course="picks"] .cs');
  if (chip) chip.textContent = `${state.picks.size} spots`;
  if (state.courseId === "picks") applyCourse("picks");
  else {
    document.querySelectorAll(`.side-item[data-id="${poi.id}"] .si-add`)
      .forEach((b) => b.classList.toggle("on", state.picks.has(poi.id)));
    toast(state.picks.has(poi.id)
      ? `🎯 Added to My Picks (${state.picks.size}) — tap the 🎯 course to route it`
      : `Removed — My Picks (${state.picks.size})`);
  }
}

// ---------- add ANY place from Google search ----------
const compressHours = (descs) => {
  if (!descs?.length) return "";
  const ranges = descs.map((d) => d.replace(/^[A-Za-z]+:\s*/, "").trim());
  return [...new Set(ranges)].length === 1
    ? (ranges[0] === "Closed" ? "" : "Daily " + ranges[0]) : ranges[0] + " (varies)";
};
async function googleSearch(q) {
  const box = el("gResults");
  box.innerHTML = `<div class="g-hint">Searching Google…</div>`;
  try {
    const { places, error } = await (await fetch("/api/places?q=" + encodeURIComponent(q))).json();
    if (error || !places?.length) { box.innerHTML = `<div class="g-hint">No results — try another name</div>`; return; }
    box.innerHTML = "";
    for (const g of places) {
      const row = document.createElement("div");
      row.className = "g-result";
      const thumb = g.image ? `<img class="g-img" loading="lazy" src="${g.image}" alt="">` : `<div class="g-img si-ph">🎯</div>`;
      row.innerHTML = `${thumb}<div class="g-body">
          <div class="g-name">${g.name}</div>
          <div class="g-meta">${g.kind ? g.kind + " · " : ""}${g.addr.slice(0, 44)}</div>
        </div><button class="si-add">＋</button>`;
      row.querySelector(".si-add").addEventListener("click", () => addGooglePlace(g, row));
      box.append(row);
    }
  } catch { box.innerHTML = `<div class="g-hint">Search failed — is the server up?</div>`; }
}
function addGooglePlace(g, row) {
  // walkable map covers Myeongdong — reject picks the route can't reach
  if (metersBetween([g.lng, g.lat], [state.center.lng, state.center.lat], g.lat) > 1400) {
    toast("🚫 That place is outside the Myeongdong walking map");
    return;
  }
  const id = "gp-" + g.id;
  if (!state.pois.find((p) => p.id === id)) {
    const poi = {
      id, type: "custom", title: g.name, enName: g.name,
      lng: g.lng, lat: g.lat, addr: g.addr, tel: "", image: g.image || "",
      hours: compressHours(g.hours), menu: g.kind, overview: "",
      script: `${g.name}. ${g.kind ? "A " + g.kind.toLowerCase() + " you picked yourself — " : ""}this is one of your own stops. Take your time here, then follow the route to your next pick.`,
    };
    state.pois.push(poi);
    addPin(poi, TYPE_GLYPH.custom);
    // Gemini writes a real guide script for this place in the background
    fetch("/api/narrate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: g.name, kind: g.kind, addr: g.addr }),
    }).then((r) => r.json()).then(({ script }) => {
      if (script) { poi.script = script; poi.scriptBy = "gemini"; prefetch(script); savePicks(); }
    }).catch(() => { /* template script stays */ });
  }
  state.picks.add(id);
  savePicks();
  row?.querySelector(".si-add")?.classList.add("on");
  toast(`🎯 ${g.name} added to My Picks (${state.picks.size})`);
  if (state.courseId === "picks") applyCourse("picks");
}

// ---------- sidebar: the current course as a browsable list ----------
const fmtKm = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
function poiDistance(p) {
  const from = state.avatarPos || [state.start.lng, state.start.lat];
  return metersBetween(from, [p.lng, p.lat], p.lat);
}
function renderSidebar() {
  const course = COURSES.find((c) => c.id === state.courseId);
  el("sideTitle").textContent = `${course.icon} ${course.name}`;
  el("sideCount").textContent = `${state.coursePois.length}`;
  const list = el("sideList");
  list.innerHTML = "";
  if (state.courseId === "picks") {
    const s = document.createElement("div");
    s.className = "side-search";
    s.innerHTML = `<input id="gSearch" type="search" placeholder="🔍 Add any place — Google search" autocomplete="off" />
      <div id="gResults"></div>`;
    s.querySelector("#gSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.value.trim()) googleSearch(e.target.value.trim());
    });
    list.append(s);
    if (!state.coursePois.length) {
      const h = document.createElement("div");
      h.className = "g-hint";
      h.textContent = "Search Google above, or tap ＋ in any course list.";
      list.append(h);
    }
  }
  const pois = state.courseId === "picks" ? state.coursePois : [...state.coursePois].sort((a, b) => poiDistance(a) - poiDistance(b));
  for (const p of pois) {
    const item = document.createElement("div");
    item.className = "side-item" + (state.visited.has(p.id) ? " done" : "");
    item.dataset.id = p.id;
    const img = p.image ? `<img loading="lazy" src="${fixImg(p.image)}" alt="">`
      : `<div class="si-ph">${TYPE_GLYPH[p.type] || "📍"}</div>`;
    item.innerHTML = `${img}
      <div class="si-body">
        <div class="si-name">${p.enName || p.title}</div>
        <div class="si-ko">${p.title}</div>
        <div class="si-meta">📍 <span class="si-km">${fmtKm(poiDistance(p))}</span>${p.hours ? " · ⏰ " + p.hours.slice(0, 26) : ""}</div>
        ${p.menu ? `<div class="si-menu">${TYPE_GLYPH[p.type] || ""} ${p.menu.slice(0, 34)}</div>` : ""}
      </div>
      <button class="si-vid" title="Video preview">🎬</button>
      <button class="si-add${state.picks.has(p.id) ? " on" : ""}" title="Add to My Picks">＋</button>`;
    item.querySelector(".si-vid").addEventListener("click", (e) => { e.stopPropagation(); openVideo(p); });
    item.querySelector(".si-add").addEventListener("click", (e) => { e.stopPropagation(); togglePick(p); });
    item.addEventListener("click", () => showSpot(p));
    list.append(item);
  }
}
function refreshSidebarDistances() {
  for (const item of document.querySelectorAll(".side-item")) {
    const p = state.pois.find((x) => x.id === item.dataset.id);
    if (!p) continue;
    item.querySelector(".si-km").textContent = fmtKm(poiDistance(p));
    item.classList.toggle("done", state.visited.has(p.id));
  }
}
function renderCourseBar() {
  const bar = el("courseBar");
  bar.innerHTML = "";
  for (const c of COURSES) {
    const n = state.pois.filter(c.pick).length;
    const b = document.createElement("button");
    b.dataset.course = c.id;
    b.innerHTML = `<span class="ci">${c.icon}</span><span class="cn">${c.name}</span><span class="cs">${c.id === "picks" && !n ? "build yours" : n + " spots"}</span>`;
    b.addEventListener("click", () => {
      if (state.tour.running) return;
      applyCourse(c.id);
      const cnt = state.coursePois.length;
      if (c.id === "picks" && !cnt) { toast("🎯 Tap ＋ in the list to build your own route"); return; }
      const min = Math.round(state.pathLen / 70 + cnt * 1.5); // 4.2 km/h + ~90s listening per spot
      toast(`${c.icon} ${c.name} — ${cnt} spots · ~${min} min real walk`);
    });
    bar.append(b);
  }
}

// ---------- the walk ----------
function startWalk() {
  if (state.tour.running) return;
  state.walkDist = 0; state.cumI = 1; state.visited.clear(); state.activeId = null; resetPins();
  state.usedFacts.clear(); state.fi = 0;
  state.tour.running = true; state.tour.paused = false;
  updateHud(); setNowPlaying(""); showHud(true);
  el("courseBar").classList.add("hidden");
  setControls(true);
  toast("🚶 Myeongdong Station, Exit 6 — let's walk");
  // the guide greets you at the exit before you start moving
  (async () => {
    state.tour.paused = true;
    setNowPlaying("🎧 Your guide");
    await playNarration(INTRO);
    if (state.tour.running) state.tour.paused = false;
  })();
  walkNarrationLoop();
}
function endWalk() {
  state.tour.running = false; state.tour.paused = false; audioStop();
  state.activeId = null; setNowPlaying(""); showHud(false);
  el("courseBar").classList.remove("hidden");
  el("startBtn").disabled = false; el("startBtn").textContent = "▶ Restart Walk";
  el("pauseBtn").disabled = true; el("skipBtn").disabled = true; el("pauseBtn").textContent = "Pause";
  if (state.mode === "gps") startGPS();
}
function setControls(on) {
  el("startBtn").disabled = on; el("startBtn").textContent = on ? "▶ Walking…" : "▶ Start Walk";
  el("pauseBtn").disabled = !on; el("skipBtn").disabled = !on;
}

// ---------- per-frame loop ----------
let lastTs = 0;
function frame(ts) {
  if (!lastTs) lastTs = ts; const dt = Math.min((ts - lastTs) / 1000, 0.05); lastTs = ts;
  if (state.mode === "sim" && state.tour.running) {
    if (!state.tour.paused) {
      state.walkDist += WALK_SPEED * dt;
      if (state.walkDist >= state.pathLen) { state.walkDist = state.pathLen; endWalk(); }
    }
    const { pos, heading } = pointAlongPath(state.walkDist);
    state.avatarPos = pos;
    const diff = ((heading - state.camHeading + 540) % 360) - 180;
    state.camHeading = (state.camHeading + diff * 0.12 + 360) % 360;
    followCam(pos[0], pos[1], state.camHeading, dt);
  } else if (state.mode === "gps" && state.avatarPos) {
    followCam(state.avatarPos[0], state.avatarPos[1], state.gps.heading, dt);
  } else {
    orbitCam(dt, ROT_SPEED);
  }
  render(dt);
  requestAnimationFrame(frame);
}

// ---------- live GPS ----------
function startGPS() {
  if (!navigator.geolocation) { toast("This browser has no geolocation."); return; }
  toast("📍 Getting your location… (allow location access)");
  state.tour.running = false; updateHud(); showHud(true);
  state.gps.watchId = navigator.geolocation.watchPosition(onGPS, onGPSErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  if (!state._gpsLoop) { state._gpsLoop = true; gpsNarrationLoop(); }
}
function stopGPS() { if (state.gps.watchId != null) { navigator.geolocation.clearWatch(state.gps.watchId); state.gps.watchId = null; } state._gpsLoop = false; }
function onGPS(pos) {
  const { latitude: lat, longitude: lng } = pos.coords, prev = state.avatarPos;
  if (prev) state.gps.heading = bearingTo({ lng: prev[0], lat: prev[1] }, { lng, lat }) || state.gps.heading;
  state.avatarPos = [lng, lat]; moveAvatar3d(lng, lat, state.gps.heading); toastClear();
  if (metersBetween([lng, lat], [state.center.lng, state.center.lat], lat) > 1600) toast("You're outside Myeongdong — the guide starts when you arrive.");
}
function onGPSErr(err) {
  const m = err.code === 1 ? "Location denied. Enable it from the address-bar location icon." : err.code === 2 ? "No location signal (indoors / desktop can be inaccurate)." : "Location timed out.";
  toast("📍 " + m, 6000);
}
// distance from a point to the planned route (walkPath is densified every ~6 m)
function distToRoute(lng, lat) {
  let bd = Infinity;
  for (const p of state.walkPath) { const d = metersBetween([lng, lat], p, lat); if (d < bd) bd = d; }
  return bd;
}
const nextStop = () => state.coursePois.find((p) => !state.visited.has(p.id));

// live navigation voice — off-route warnings, back-on-track, gentle progress pings
async function gpsNarrationLoop() {
  let offRoute = false, lastNavTalk = 0, lastPing = Date.now();
  const say = async (text) => { lastNavTalk = Date.now(); setNowPlaying("🎧 Guide"); await playNarration(text); };
  while (state._gpsLoop) {
    const a = state.avatarPos;
    if (a && !isPlaying()) {
      const poi = nearestUnvisitedWithin(a[0], a[1], POI_TRIGGER);
      if (poi) { toast(`📍 ${poi.enName || poi.title}`); await narratePoi(poi); lastPing = Date.now(); }
      else {
        const next = nextStop();
        const d = state.walkPath.length ? distToRoute(a[0], a[1]) : 0;
        if (d > 45 && !offRoute && Date.now() - lastNavTalk > 25000) {
          offRoute = true;
          toast("↩️ Off the route");
          await say(`Looks like you've wandered off the route. ${next ? `Head back toward ${next.enName || next.title} — it's about ${Math.round(metersBetween(a, [next.lng, next.lat], a[1]))} metres away.` : "Follow the yellow line on the map to get back."}`);
        } else if (d < 28 && offRoute) {
          offRoute = false;
          toast("✅ Back on the route");
          await say(`Nice — you're back on the route.${next ? ` Keep going, ${next.enName || next.title} is coming up.` : ""}`);
        } else if (!offRoute && next && Date.now() - lastPing > 90000 && Date.now() - lastNavTalk > 30000) {
          lastPing = Date.now();
          await say(`You're doing great. ${next.enName || next.title} is about ${Math.round(metersBetween(a, [next.lng, next.lat], a[1]))} metres ahead.`);
        }
      }
    }
    await sleep(700);
  }
}

// ---------- real-time environment: Seoul clock + live weather ----------
const WX_KIND = (code) =>
  code >= 95 ? "rain" : code >= 71 && code <= 77 ? "snow" : code >= 51 ? "rain" :
  code >= 45 ? "fog" : code >= 1 ? "clouds" : "clear";
const WX_EMOJI = { clear: "☀️", clouds: "⛅", fog: "🌫️", rain: "🌧️", snow: "❄️" };
const env = { weather: null, override: new URLSearchParams(location.search) };

function seoulNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}
function envDate() {
  const d = seoulNow(), t = env.override.get("time");
  if (t === "day") d.setHours(13, 0);
  if (t === "night") d.setHours(22, 0);
  return d;
}
async function fetchWeather() {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${state.center.lat}&longitude=${state.center.lng}&current=temperature_2m,weather_code,cloud_cover,is_day&timezone=Asia%2FSeoul`;
    const { current } = await (await fetch(u)).json();
    env.weather = {
      kind: WX_KIND(current.weather_code), cloud: (current.cloud_cover ?? 0) / 100,
      temp: Math.round(current.temperature_2m), isDay: !!current.is_day,
    };
  } catch { env.weather = { kind: "clear", cloud: 0, temp: null, isDay: true }; }
  const wx = env.override.get("wx");
  if (wx) env.weather = { ...env.weather, kind: wx, cloud: wx === "clear" ? 0 : 0.85 };
  applyEnv();
}
function applyEnv() {
  const d = envDate(), w = env.weather || { kind: "clear", cloud: 0 };
  setEnvironment(d, w);
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  const night = d.getHours() < 6 || d.getHours() >= 19;
  const icon = w.kind === "clear" ? (night ? "🌙" : "☀️") : WX_EMOJI[w.kind];
  el("envChip").textContent =
    `${icon} ${hh}:${mm} Seoul · ${w.kind}${w.temp != null ? " " + w.temp + "°" : ""}` +
    (env.override.get("time") || env.override.get("wx") ? " (demo)" : " · live");
}
function startEnv() {
  fetchWeather();                                  // weather now + every 10 min
  setInterval(fetchWeather, 600000);
  setInterval(applyEnv, 60000);                    // clock every minute
}

// ---------- controls ----------
function resetAll() {
  // stop everything
  state.tour.running = false; state.tour.paused = false; audioStop(); stopGPS();
  // clear picks (incl. Google-added custom places) + progress
  localStorage.removeItem("md3d-picks");
  state.picks.clear();
  for (const p of state.pois) if (p.type === "custom") removePin(p.id);
  state.pois = state.pois.filter((p) => p.type !== "custom");
  state.visited.clear(); state.activeId = null; state.avatarPos = null;
  // back to defaults
  el("spotCard").classList.remove("show"); closeVideo(); setNowPlaying(""); showHud(false);
  setControls(false); el("startBtn").textContent = "▶ Start Walk";
  moveAvatar3d(state.start.lng, state.start.lat, 20);
  renderCourseBar();
  setMode("sim");
  applyCourse("best");
  toast("↺ Reset — back to Myeongdong Station Exit 6");
}
function startExperience() { if (state.mode === "gps") startGPS(); else startWalk(); }
function togglePause() { const t = state.tour; if (!t.running) return; t.paused = !t.paused; el("pauseBtn").textContent = t.paused ? "Resume" : "Pause"; t.paused ? audioPause() : audioResume(); }
function skip() { if (state.mode === "sim" && state.tour.running) { audioStop(); state.tour.paused = false; } }
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll("#modeToggle button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  if (mode === "gps") toast("Live GPS — press Start, then walk Myeongdong with earphones.");
  else { stopGPS(); state.tour.running = false; state.activeId = null; state.visited.clear(); resetPins(); setNowPlaying(""); showHud(false); setControls(false); }
}

// ---------- boot ----------
async function boot() {
  try {
    const [pois, streets, fillers, buildings, beauty, water, zones] = await Promise.all([
      fetch("./data/myeongdong-pois.json").then((r) => r.json()),
      fetch("./data/myeongdong-streets.json").then((r) => r.json()),
      fetch("./data/myeongdong-fillers.json").then((r) => r.json()),
      fetch("./data/myeongdong-buildings.geojson").then((r) => r.json()),
      fetch("./data/myeongdong-beauty.json").then((r) => r.json()).catch(() => ({ shops: [] })),
      fetch("./data/myeongdong-water.json").then((r) => r.json()).catch(() => ({ lines: [] })),
      fetch("./data/myeongdong-zones.json").then((r) => r.json()).catch(() => ({ zones: [] })),
    ]);
    state.pois = [...pois.pois, ...beauty.shops]; state.fillers = fillers.fillers;
    state.zones = zones.zones || [];
    state.mdImage = fixImg(pois.pois.find((p) => p.title === "명동")?.image || "");
    state.center = pois.center ? { lng: pois.center.mapX, lat: pois.center.mapY } : state.center;

    state.graph = buildGraph(streets);
    state.coursePois = state.pois;
    state.walkPath = buildWalkPath(state.graph, state.start, buildRoute(state.start, state.pois));

    initScene({
      container: el("map"), buildings, streets,
      walkPath: state.walkPath, pois: state.pois,
      center: state.center, glyphs: TYPE_GLYPH, subway: SUBWAY, water,
    });
    moveAvatar3d(state.start.lng, state.start.lat, 20);

    window.__s = state;
    startEnv();
    loadPicks();                          // restore saved My Picks (incl. Google adds)
    renderCourseBar();
    applyCourse(state.courseId);          // default: Best of Myeongdong
    setInterval(refreshSidebarDistances, 4000); // live km while walking
    wireControls(); setMode("sim");
    el("startBtn").disabled = false;
    el("overlayMsg").textContent = `${buildings.features.length} real buildings · ${state.pois.length} famous spots`;
    hideOverlay();
    requestAnimationFrame(frame);
  } catch (err) { console.error(err); showError("Couldn't build the 3D city", `${err.message}`); }
}
function wireControls() {
  el("startBtn").addEventListener("click", startExperience);
  el("pauseBtn").addEventListener("click", togglePause);
  el("skipBtn").addEventListener("click", skip);
  el("resetBtn").addEventListener("click", resetAll);
  el("sideFold").addEventListener("click", () => el("sidebar").classList.toggle("folded"));
  el("sidebar").addEventListener("click", () => {
    if (el("sidebar").classList.contains("folded")) el("sidebar").classList.remove("folded");
  });
  el("spotClose").addEventListener("click", (e) => { e.stopPropagation(); el("spotCard").classList.remove("show"); });
  el("videoClose").addEventListener("click", closeVideo);
  el("videoModal").addEventListener("click", (e) => { if (e.target === el("videoModal")) closeVideo(); });
  document.querySelectorAll("#modeToggle button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
}

boot();
