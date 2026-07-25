# Myeongdong 3D 🗼

**A GPS walking audio guide for Seoul's Myeongdong district — Gemini writes, ElevenLabs speaks.**

**Live demo:** https://myeongdong-3d.netlify.app

Step out of Myeongdong Station Exit 6, put your earphones in, and walk. A warm voice
guides you down real streets, and every time you pass somewhere special — a dumpling
house from 1966, Korea's first Gothic cathedral, an Olive Young flagship — it tells
you the story. Between stops it shares the history of the exact street you're standing on.
When the day is over, snap-tagged photos become a narrated scrapbook album, written by
Gemini from what's actually *in* your pictures.

Built for the [DEV Weekend Challenge: Passion Edition](https://dev.to/challenges/weekend-2026-07-09).

## What's inside

- **A hand-built 3D city** — 3,535 real building footprints from OpenStreetMap, extruded
  to their real heights (Lotte Hotel's 150 m tower included), with procedural window /
  storefront facades, in a stylised Three.js diorama. No map SDK — Seoul has no public
  photorealistic 3D data, so we made our own city.
- **Real-time reality** — the scene matches Seoul *right now*: sun position computed from
  the actual clock (windows light up at night), live weather from Open-Meteo (rain falls
  in the app when it rains in Seoul).
- **182 real places** — 116 Korea TourAPI attractions & restaurants (every single one
  with a real photo, a Gemini-written script and a YouTube preview) + all 66 cosmetics
  shops in Myeongdong from OSM, with real opening hours (Google Places) and signature menus.
- **Themed courses** — Best of Myeongdong · Foodie Tour · Shopping · K-Beauty All-In ·
  Culture & History · Everything · 🎯 My Picks (build your own) · 📒 My Trip · 🎞 My Album.
- **Live Gemini narration** — add *any* place from Google search to My Picks and
  **Gemini 3.5 Flash writes a fresh audio-guide script on the spot**, which ElevenLabs
  then voices. All baked scripts were also written by Gemini.
- **🎞 Trip album with Gemini vision** — 📷 photos are stamped with place, time and the
  live Seoul weather at that moment; *Make my album* sends the actual pixels to Gemini,
  which writes a friend-style voiceover from what's in each frame, told by ElevenLabs
  over a paper-scrapbook slideshow (taped polaroids, mono time/weather/geo labels).
  Photos live only in the browser's localStorage — never stored on a server.
- **Mid-walk detours & replay** — search any place *while walking* and ＋ re-plans the
  remaining route through it from where you stand; ‹ Prev replays anything the guide
  already said (spots, street stories, photo tips).
- **ElevenLabs voice guide** — Amelia (the most-used voice on ElevenLabs), off-route
  warnings ("you've wandered off the route"), progress encouragement, zone-based local
  history, museum-style spot narrations. Demo-path audio is pre-baked; everything else
  is live TTS with a browser-voice fallback.
- **Two modes** — Simulation (judge-friendly: an avatar walks the route for you) and
  Live GPS (stand in Myeongdong with earphones and the same guide follows *you*).
  Works on phones too — course picker and spot list fold behind bottom chips.

## Stack

| Layer | Tech |
|---|---|
| 3D | Three.js (custom diorama renderer, merged geometry, procedural facades) |
| Script writing | **Gemini 3.5 Flash** (build-time pipeline + live `/api/narrate`) |
| Trip album | **Gemini 3.5 Flash vision** (`/api/album` — reads the traveller's photos) |
| Voice | **ElevenLabs** — Amelia (`/api/tts` proxy, baked mp3 cache) |
| Data | OpenStreetMap (buildings/streets/water/shops), Korea TourAPI (POIs), Google Places (hours/photos), YouTube Data API (previews), Open-Meteo (live weather) |
| Routing | Dijkstra over the OSM street graph (largest connected component); nearest-insertion re-routing for mid-walk detours |
| Hosting | Netlify (static + functions; keys stay server-side; GitHub-linked auto-deploy) |

Photo credits: dish and noraebang photos from Wikimedia Commons and Flickr (CC BY /
CC BY-ND); zone story photos from Wikimedia Commons and Google Places.

## Run locally

```bash
npm install
cp .env.example .env   # fill in keys
npx netlify dev        # → http://localhost:8888
```

Rebuild the data (optional): `npm run refresh-data` — refetches POIs, regenerates
Gemini scripts, translates metadata, pulls cosmetics shops and opening hours.
`node scripts/bake-audio.mjs` pre-bakes the demo-path audio.

Demo query params: `?time=day` / `?time=night` / `?wx=rain` / `?wx=snow`.

## Honest notes

- Building positions/shapes are real; heights are real where OSM has them
  (all landmarks) and typical low-rise estimates elsewhere.
- Seoul has no public photorealistic 3D tiles (Google's 3D coverage excludes Korea),
  which is why the city is stylised — every building is true 3D geometry.
- A few shops without published hours show `(typical)` and say so.

- ## Post-deadline commits

After the submission deadline (2026-07-13 06:59 UTC), only CSS and JS files were modified to improve page load performance. No features were added or changed.
