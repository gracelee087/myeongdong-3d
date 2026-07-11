// ElevenLabs narration playback with per-text caching and graceful fallback.
// If TTS fails (no key / quota / network), we fall back to the browser's own
// speech synthesis so the guide never goes silent.

const cache = new Map(); // text -> objectURL
let current = { audio: null, resolve: null };
let speaking = false;

// pre-baked clips (audio/manifest.json) — demo path plays without spending credits
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
let baked = {};
fetch("./audio/manifest.json").then((r) => (r.ok ? r.json() : {})).then((m) => { baked = m; }).catch(() => {});
const bakedUrl = (text) => { const f = baked[hash(text)]; return f ? "./audio/" + f : null; };

// browser TTS fallback — robotic but never silent
function speakFallback(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return setTimeout(resolve, 4000);
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      u.voice = voices.find((v) => /en[-_]/.test(v.lang) && /female|natural|samantha|zira|aria/i.test(v.name))
        || voices.find((v) => /en[-_]/.test(v.lang)) || null;
      u.rate = 0.98; u.pitch = 1.05;
      speaking = true;
      const done = () => { speaking = false; resolve(); };
      u.onend = done; u.onerror = done;
      speechSynthesis.speak(u);
    } catch { setTimeout(resolve, 4000); }
  });
}

export async function playNarration(text, { voiceId } = {}) {
  let url = cache.get(text) || bakedUrl(text);
  if (!url) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
      });
      if (!res.ok) throw new Error("tts " + res.status);
      url = URL.createObjectURL(await res.blob());
      cache.set(text, url);
    } catch (e) {
      console.warn("[audio] TTS failed → browser voice fallback:", e.message);
      stop();
      await speakFallback(text);
      return;
    }
  }
  await new Promise((resolve) => {
    stop();
    const a = new Audio(url);
    current = { audio: a, resolve };
    const done = () => { const r = current.resolve; current = { audio: null, resolve: null }; r && r(); };
    a.onended = done;
    a.onerror = done;
    a.play().catch(done);
  });
}

// Warm the cache in the background so the next stop starts instantly.
export function prefetch(text, { voiceId } = {}) {
  if (!text || cache.has(text) || bakedUrl(text)) return;
  fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voiceId }),
  })
    .then((res) => (res.ok ? res.blob() : Promise.reject()))
    .then((blob) => cache.set(text, URL.createObjectURL(blob)))
    .catch(() => {});
}

export function stop() {
  if (current.audio) current.audio.pause();
  if (speaking) { try { speechSynthesis.cancel(); } catch { } speaking = false; }
  const r = current.resolve;
  current = { audio: null, resolve: null };
  if (r) r();
}
export function pause() {
  current.audio && current.audio.pause();
  if (speaking) try { speechSynthesis.pause(); } catch { }
}
export function resume() {
  current.audio && current.audio.play().catch(() => {});
  if (speaking) try { speechSynthesis.resume(); } catch { }
}
export function isPlaying() { return (!!current.audio && !current.audio.paused) || speaking; }
