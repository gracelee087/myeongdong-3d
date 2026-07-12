<!--
DEV Weekend Challenge submission draft.
Paste into a new DEV post, add the cover image + screenshots where marked,
set tags: #devchallenge #weekendchallenge (+ #webdev #ai if you like).
Live URL and repo are filled in. Make the repo PUBLIC before publishing!
-->

# Myeongdong 3D — I built a talking 3D copy of my favourite Seoul district

*This is a submission for the [DEV Weekend Challenge: Passion Edition](https://dev.to/challenges/weekend-2026-07-09)*

## What I Built

**Myeongdong 3D** is a GPS walking audio guide for Seoul's most-loved shopping district — inside a hand-built 3D copy of the real city.

You come out of Myeongdong Station Exit 6, put your earphones in, and just walk. A warm voice walks with you. Pass the dumpling house that's been steaming mandu since 1966 and she tells you. Pass Korea's first Gothic cathedral and she tells you why protesters once felt safe on its steps. Wander off your route and she gently calls you back.

My passion behind this: **I love Myeongdong, and it hurts me watching tourists walk straight past its best stories.** They queue at one famous restaurant from TikTok, buy sheet masks, and leave — never learning that the street they're standing on was Seoul's Montmartre in the 1950s, or that the department store on the corner was Korea's very first. This app is my love letter to a neighbourhood: a guide that makes sure no one walks past the good parts ever again.

**Try it (no GPS needed):** pick a themed course — 🍜 Foodie Tour, 💄 K-Beauty All-In (all 66 cosmetics shops in the district!), 📸 Culture & History, or 🎯 build your own — and press **Start Walk**. An avatar walks the real streets for you while the guide talks. If you're actually *in* Myeongdong, switch to Live GPS and the same guide follows your real position.

And when the walk is over, the part I'm proudest of: **📷 snap photos as you go** (each one stamped with the place, the time, and the *actual Seoul weather at that moment*), then press **🎞 Make my album**. Gemini *looks at your photos* — not the location tags, the actual pixels — and writes a voiceover like a friend flipping through the album with you ("I still laugh at how seriously you posed under that sunny sky…"), and ElevenLabs tells it over a paper scrapbook of taped-down polaroids. Your photos never leave your browser except for that one narration request — nothing is stored on any server.

## Demo

**Live app:** https://myeongdong-3d.netlify.app

<!-- COVER / HERO screenshot: night overview with glowing windows -->
<!-- Screenshot: walking view with YOU ARE HERE + spot card -->
<!-- Screenshot: 🎞 trip album — taped polaroid + time/weather/geo label -->
<!-- Screenshot: K-Beauty course with mint-highlighted buildings -->
<!-- Screenshot: rain / day comparison -->
<!-- Optional: 30-60s screen recording -->

A few things to try:

- The city matches Seoul **right now** — real sun position (windows light up after dark) and live weather (if it's raining in Seoul, it rains in the app). Add `?time=night` or `?wx=rain` to the URL to time-travel.
- Click 🎬 on any place in the sidebar for a YouTuber's video of it — know the place *before* you walk in. All 116 spots have one.
- In **My Picks**, search *any* place on Google (try "Gentle Monster") and add it — **Gemini writes a brand-new guide script for it on the spot**, and ElevenLabs speaks it when you arrive.
- **Change your mind mid-walk.** Spot something interesting while walking? Search it and tap ＋ — the route re-plans from where you're standing and detours there, without restarting the tour. Missed something the guide said? **‹ Prev** replays it.
- 📷 snap a few photos during the walk, then open **🎞 My Album** and press *Make my album* — and listen to Gemini describe what's actually in your pictures.
- Every spot card shows the Korean address with a copy button — made to be shown to a taxi driver.

## My Code

https://github.com/gracelee087/myeongdong-3d

## How I Built It

**The city itself is hand-made.** Seoul has no public photorealistic 3D data (Google's 3D tiles skip Korea entirely — I learned this the hard way), so I built the district from scratch: 3,535 real building footprints from OpenStreetMap, extruded to their real heights in Three.js, with procedurally generated window grids and colourful street-level storefronts, at real-world metre scale. Cheonggyecheon stream flows through the north of the map — actually flows, with animated current.

**Walking is real routing.** Courses are solved with Dijkstra over the OSM street graph, so the avatar (and you, in GPS mode) always follow real, connected streets from Myeongdong Station Exit 6.

**The narration is a two-AI pipeline:**

- ✍️ **Google AI (Gemini 3.5 Flash)** is the *writer* — and the *eyes*. Every guide script in the app — 116 attractions & restaurants, 66 K-Beauty shops — was written by Gemini from Korean tourism-board descriptions. It's not just build-time: add any Google-searched place to My Picks and a serverless function asks Gemini for a fresh guide script, live. And the trip album uses **Gemini's vision**: your photos are sent as pixels, and it writes each line from what's actually in the frame — the food you're holding, the pose, the neon — weaving in the real weather and time each shot was taken (the location tag is treated as just a hint, because travellers photograph whatever they love, wherever they stand).
- 🎙️ **ElevenLabs** is the *voice*. **Amelia** — the most-used voice on all of ElevenLabs, an enthusiastic British storyteller — narrates spots museum-style, tells zone-based local history between stops (each area of the map has its own true stories), warns you when you drift off-route, replays anything on ‹ Prev, and tells your photo album like a friend. The demo path is pre-baked to mp3 for instant playback; everything else is live TTS with a browser-voice fallback so the guide never goes silent.

**Real data everywhere:** Korea TourAPI (places, photos, Korean addresses), Google Places (real opening hours), YouTube Data API (preview videos, news channels filtered out — you get vloggers' experiences, not headlines), Open-Meteo (live Seoul weather), and the actual solar position computed from Seoul's clock.

Built over the weekend with an AI pair-programmer (Claude Code) — and an unreasonable amount of love for one square kilometre of Seoul.

## Prize categories

**Best use of Google AI** — Gemini 3.5 Flash writes every word the guide says: the full script pipeline at build time, live script generation for user-added places at runtime (`/api/narrate`), and **multimodal vision** for the trip album (`/api/album`) — it looks at the traveller's actual photos and writes a personal voiceover from what's in each frame, plus the weather and hour each photo was taken.

**Best use of ElevenLabs** — the entire product is a voice: museum-style narrations, location-aware history, navigation guidance ("you've wandered off the route"), instant ‹ Prev replay, and a narrated photo-album finale — all spoken by Amelia, with a pre-baked demo path so judging never depends on live credits.

---

*명동을 사랑하는 마음으로 — with love, for Myeongdong.* 🇰🇷
