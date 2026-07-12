# Session Handoff — Myeongdong 3D: feature batch (peek/route-edit/album/historic sites) + content audit + private repo push

## Where it started
Continuing the DEV Weekend Challenge "Passion Edition" entry (deadline 2026-07-13 06:59 UTC), targeting both bonus prizes (Google AI via Gemini, ElevenLabs via Matilda voice). This session was a rapid user-driven feature batch on the working app, a content-quality audit ("write like a Seoul native, every card needs a photo"), and end-of-day repo creation. User works in Korean; replies must be Korean.

## Decisions locked + what shipped
- Sidebar click pre-walk flies camera close (flyTo zoom 0.34) and speaks immediately — `C:\Users\honor\OneDrive\Desktop\mlhhackathon\js\scene.js` (flyTo), `js\main.js` (item click handler in renderSidebar)
- Mid-walk "peek": clicking a list item pauses the walk, glides the camera there seamlessly (beginPeek/endPeekCam in scene.js seed the orbit rig from the follow cam), speaks the spot, returns via #peekBackBtn "Resume journey" or the Pause button — startPeek/endPeekMode in `js\main.js`; frame() has a state.peek branch (orbitCam dt,0)
- Route editing: drag rows to re-order (HTML5 DnD, commitSidebarOrder), ✕ removes a stop; both rebuild the route via state.courseMods[courseId] = {removed:Set, order:[ids]}; custom order bypasses buildRoute nearest-neighbor; blocked while tour.running; cleared by resetAll
- Arrival earcons (WebAudio-synthesized, no files/credits): arrive=ding-dong, food=rising triad, photo=shutter, tip=sparkle — earcon() in `js\main.js`, hooked in narratePoi, both narration loops, tip block, onCamPick
- Avatar occlusion FINAL fix: previous depthTest=false made the avatar appear to stand on rooftops (user complaint); replaced with ghost-silhouette x-ray (child meshes, MeshBasicMaterial depthFunc GreaterDepth, opacity .5) in makeAvatar in `js\scene.js` — normal when visible, blue silhouette through buildings
- Content audit: all 8 story zones got real photos (zones.json image field, shown on filler cards via localStory→showFillerCard img param); Yi Sang fact rewritten with context; T-money tip rewritten (subway-station top-up machines + banana-milk insider bit); fake word "eocance" tip rewritten; odeng tip's wrong rec (a pizzeria) replaced with Myeongdong street-food carts; junk POI "명동 남대문 북창동 다동무교동 관광특구" (id 1957600) deleted
- Historic sites added (user: "다 때려넣어"): 7 new hs-* POIs — Deoksugung, Hwangudan, Gwangtonggyo, Jogyesa, Seoul Anglican Cathedral, Gwanghwamun Square, Seoul Museum of Art; Sungnyemun (id 128162) and Bosingak-teo already existed. Culture & History now 46 spots, total POIs 116. Gyeongbokgung/Changdeokgung are OUTSIDE the map (street graph bounds: lng 126.9735–127.0085, lat 37.5426–37.5755)
- Stamp-rally camera: si-cam button per row + dock #snapBtn for free capture (tags to avatar GPS/sim position, names it via nearestSpotName); photos compressed to 720px JPEG in localStorage md3d-photos; photo badge .si-shot on thumbnails
- Trip album ("Gemini writes it, Matilda tells it"): `netlify\functions\album.js` (/api/album, gemini-3.5-flash, friend-voice recap JSON {title,intro,scenes[],outro}); makeAlbum/runAlbum in main.js play a fullscreen Ken Burns slideshow (#album overlay) over the user's photos with ElevenLabs narration; album button at top of My Trip course; template fallback if the API fails. Album lines are runtime TTS (not baked)
- Sidebar UX: width flexes 322px ↔ 384px (.side.wide, toggled while any row's ⋯ actions are open); the 5 row buttons (📷🎬✓＋✕) are collapsed behind a ⋯ toggle (.si-more/.si-acts); renderSidebar resets wide
- Background music REMOVED entirely per user (code, 🎵 button, audio/bgm.mp3, scripts/gen-bgm.mjs deleted); arrival earcons explicitly KEPT (user: "도착 소리는 유지, 그건 중요해")
- Audio rebake: 5 new clips (~1186 credits), manifest 148 entries; ElevenLabs remaining ≈ 5.3K credits. Narration templates in scripts/bake-audio.mjs MUST stay byte-identical with js/main.js
- Repo pushed PRIVATE per user ("키 노출 안 되게") — pre-push key scan: no hardcoded keys anywhere, .env ignored and never tracked, .env.example is placeholders only. DEV submission may require flipping public later (`gh repo edit --visibility public`); history is clean so that is safe
- Commercial-use audit answered: OSM/TourAPI/Three.js OK with attribution; ElevenLabs and Gemini need paid tiers; Open-Meteo free tier is non-commercial (swap to KMA API); Google Places data on a non-Google map + cached JSON is the main ToS risk if ever monetized

## Key files for next session
- Plan file: `C:\Users\honor\.claude\plans\wondrous-noodling-pebble.md` (original architecture; superseded in places — the app is a hand-built Three.js OSM city, NOT Map3DElement)
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\js\main.js` — app logic; almost everything this session touched lives here
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\js\scene.js` — renderer; flyTo/beginPeek/endPeekCam/makeAvatar ghost
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\netlify\functions\album.js` — new /api/album
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\scripts\add-historic.mjs`, `scripts\fix-content.mjs` — idempotent data scripts (dup-guarded)
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\data\myeongdong-pois.json` (116 POIs), `data\local-tips.json`, `data\myeongdong-zones.json` (now with an image per zone)
- Memory files touched: none

## Running state
- Background processes: netlify dev on :8888, started detached in an earlier session (shell ID lost to context compaction). Kill via `npx kill-port 8888` or the node process in Task Manager; restart with `npx netlify dev`
- Dev servers / ports: http://localhost:8888 (confirmed responding this session)
- Open worktrees / branches: none

## Verification — how to confirm things still work
- `node --check js/main.js && node --check js/scene.js` — both pass
- `npx netlify dev` then open http://localhost:8888 — browser console must show 0 errors
- `curl -X POST http://localhost:8888/api/album -H "content-type: application/json" -d '{"stops":[{"name":"Myeongdong Kyoja","time":"11:20","photo":true}]}'` — returns {title,intro,scenes,outro}
- UI scenario (all verified headless this session): Culture & History shows 46 spots incl. Deoksugung; ✕ on a row drops the count and rebuilds the route; Start Walk → click a sidebar row → camera flies there + "Resume journey" appears → click it → camera glides back; ⋯ expands row actions and the sidebar widens 322→384 and back
- Photo/album: click a row's 📷, pick an image → .si-shot badge + md3d-photos in localStorage; My Trip → "Make my album" → fullscreen album plays with a Gemini-written title/intro

## Deferred + open questions
- Deferred: Netlify production deploy — BLOCKED on the user running `npx netlify login` (interactive; use the `!` prefix in Claude Code). Then: create the site, set env vars (ELEVENLABS_API_KEY, GEMINI_API_KEY, GOOGLE_MAPS_KEY, TOURAPI_KEY), deploy, verify /api/tts /api/narrate /api/album /api/nearby in production, fill LIVE_URL/REPO_URL in SUBMISSION.md
- Deferred: README.md + SUBMISSION.md are stale — missing this session's features (peek, route editing, earcons, stamp-rally camera, trip album, historic sites, BGM removal)
- Deferred: demo video + screenshots for the DEV post; the user publishes the post (English, tags #devchallenge #weekendchallenge); deadline 2026-07-13 06:59 UTC (= 15:59 KST)
- Deferred: YouTube preview rebake when quota resets (`node scripts/fetch-videos.mjs --rebake`), incl. Cheonggyecheon cgc-1
- Open: "Menu Lens" (Gemini vision reads Korean menus/signs, Matilda speaks it) — recommended to the user for the Google AI bonus, not yet approved
- Open: repo is private; DEV challenge submissions typically need a public repo — flip before submitting if required

## Pick up here
Get the user to run `npx netlify login` (via `!` prefix), then deploy to Netlify with env vars and update README/SUBMISSION with the live URL — everything else is done and verified.
