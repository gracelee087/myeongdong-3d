# Session Handoff — Myeongdong 3D walking audio guide (DEV hackathon)

## Where it started
Submission for the DEV Weekend Challenge "Passion Edition" (deadline 2026-07-13 06:59 UTC), aiming to win via the ElevenLabs + Google AI bonus categories. The app is a **first-person walking audio guide of Myeongdong**: you walk the real streets, each famous place explains itself (ElevenLabs), and between spots the guide keeps talking about Myeongdong. Live GPS on a phone is the real use; a simulated walk is the demo.

## Decisions locked + what shipped
- **Renderer = Google Photorealistic 3D Maps (`Map3DElement`).** After trying, in order, a deck.gl stylised OSM diorama (night-neon shader + day satellite-roof-colour), the user kept asking for real, photo-textured buildings. Final answer: Google's own 3D map renderer. It renders dense Seoul in real 3D perfectly (deck.gl's `Tile3DLayer` could NOT — only distant terrain rendered). All deck.gl code was removed.
- **Maps JS API loaded on the `beta` channel** (`v: "beta"`, `libraries=maps3d`) in `js/main.js` `loadGoogleMaps()`. Beta removes the "alpha 개발 전용" watermark banner that `v:"alpha"` shows. Key comes from `/api/config` (`GOOGLE_MAPS_KEY`).
- **Overlay on the real map**: 50 `Marker3DElement` POI pins (label = type emoji + English name), a `Polyline3DElement` walking route along real streets, and a `Marker3DElement` avatar. All in `js/main.js` `addMarkers()`.
- **First-person walk**: camera follows by setting `map.center/range/tilt/heading` each rAF frame (`setCamera()` in `frame()`), `WALK_RANGE=140, WALK_TILT=72`. Avatar hidden during sim walk (you are the camera). Idle = slow orbit overview (`OVERVIEW_RANGE=1600`).
- **Street routing** (`data/myeongdong-streets.json`, OSM highways) → Dijkstra graph builds the walk path along real streets; `pointAlongPath()` advances the walker.
- **Continuous narration**: `walkNarrationLoop()` — arrive within 40 m of an unvisited POI → pause + narrate its script; otherwise every ~190 m play an "About Myeongdong" filler line. `data/myeongdong-fillers.json` (14 lines). ElevenLabs via `js/audio.js` → `/api/tts`.
- **50 real POIs** from Korea TourAPI (name, coords, photo, Korean overview) → `data/myeongdong-pois.json` (`scripts/fetch-pois.mjs`). English names + audio scripts by `scripts/gen-scripts.mjs` (OpenAI now; prefers Gemini if key present).

## Key files for next session
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\js\main.js` — the whole app: `Map3DElement` init, markers/route/avatar, first-person camera (`setCamera`/`frame`), walk engine, `walkNarrationLoop`, GPS, spot card. Read first.
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\js\audio.js` — ElevenLabs playback + caching + prefetch.
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\index.html`, `...\css\style.css` — UI (top bar, mode toggle, dock, spot card, toast). deck.gl script and the old Night/Day look toggle were removed.
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\netlify\functions\config.js` — returns `GOOGLE_MAPS_KEY` to the client (needed again). `tts.js` — ElevenLabs proxy (`ELEVENLABS_API_KEY`).
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\scripts\gen-scripts.mjs` — regenerate POI scripts; add `GEMINI_API_KEY` to swap to Gemini.
- Plan file: `C:\Users\honor\.claude\plans\wondrous-noodling-pebble.md` (original plan; superseded — concept is now first-person walk on Google 3D).
- Now UNUSED (safe to ignore/delete): `data/myeongdong-buildings.geojson`, `data/myeongdong-course.json`, `scripts/color-buildings.mjs` (all from the abandoned deck.gl looks). Memory files touched: none.

## Running state
- Background process: `netlify dev` — Bash shell ID **bt6lmcaye** (`npx netlify dev`), serving http://localhost:8888 (+ functions). Restart via KillShell `bt6lmcaye` then rerun `npx netlify dev` if needed.
- Dev server / port: http://localhost:8888 (netlify dev, port 8888).
- Open worktrees / branches: none. (Not a git repo.)

## Verification — how to confirm things still work
- Open `http://localhost:8888` in a real browser → real 3D Seoul, "Myeongdong 3D" header, 50 labelled POI pins + yellow route. **Start Walk** → first-person walk down the real Myeongdong streets, ElevenLabs narration at each POI, "About Myeongdong" fillers between.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:8888/api/config` → `200` (returns `mapsKey`).
- `curl -s -X POST http://localhost:8888/api/tts -H "content-type: application/json" -d '{"text":"test"}' -o /dev/null -w "%{http_code} %{content_type}"` → `200 audio/mpeg`.
- Headless GPU screenshot tool (dev only, gitignored): `node C:\Users\honor\OneDrive\Desktop\mlhhackathon\_shot.mjs <out.png> <waitMs> [start]` — `start` clicks Start Walk. Uses `--use-angle=d3d11` (real GPU) headless Chrome; Google 3D tiles need a real GPU (swiftshader renders blank). Reads live state via `window.__s` (`window.__s.map` is the Map3DElement).

## Deferred + open questions
- Deferred: **Gemini swap** for the Google AI bonus — add `GEMINI_API_KEY` to `C:\Users\honor\OneDrive\Desktop\mlhhackathon\.env` (line present but commented), then `node scripts/gen-scripts.mjs` regenerates all POI scripts with Gemini.
- Deferred: **Netlify deploy** (submission URL + real phone GPS over HTTPS). Needs `netlify login`. Netlify env vars: `GOOGLE_MAPS_KEY` (config.js serves it to the client — restrict the key by HTTP referrer in Google Cloud Console), `ELEVENLABS_API_KEY`, `TOURAPI_KEY`. The key already has Map Tiles API + Maps JavaScript API enabled (verified).
- Polish candidates (not blocking): 50 red pins are dense in the overview (consider showing labels only near the walker / smaller pins); spot-card photo occasionally slow to load; first-person `WALK_RANGE` (140) could go closer for more immersion.

## Pick up here
Look/architecture is locked on Google Photorealistic 3D Maps and works end-to-end at localhost:8888. Remaining path to submission: `GEMINI_API_KEY` + rerun `scripts/gen-scripts.mjs` (Google AI bonus), then Netlify deploy with the three env vars.
