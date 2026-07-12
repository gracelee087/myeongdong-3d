// Trip album narration — Gemini plays your local friend recapping the day
// you spent together ("So, remember this morning..."), one line per stop,
// then ElevenLabs speaks it over the traveller's own photos. Key stays
// server-side.
// POST { stops: [{name, time, photo}] } -> { title, intro, scenes[], outro }
const MODEL = "gemini-3.5-flash";

export default async (req) => {
  if (req.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const { stops } = await req.json().catch(() => ({}));
  if (!Array.isArray(stops) || !stops.length) return Response.json({ error: "stops required" }, { status: 400 });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  const day = stops.slice(0, 14).map((s, i) =>
    `${i + 1}. ${s.name} at ${s.time}${s.weather ? ` (${s.weather})` : ""}${s.photo ? " — they took a photo here" : ""}`).join("\n");
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "You are the traveller's playful Seoul-born friend, recapping the day you spent together in Myeongdong " +
              "as a spoken photo-album voiceover. Reply ONLY JSON " +
              "{\"title\": string, \"intro\": string, \"scenes\": string[], \"outro\": string}. " +
              "title: a short album title, max 6 words. " +
              "intro: 1-2 warm sentences opening the memory, like 'So — remember this day?'. " +
              "scenes: EXACTLY one entry per numbered stop, in the same order — each ONE casual spoken sentence " +
              "(max 20 words) about being there together; when a photo was taken, tease them about posing for it; " +
              "when weather is given, weave it in naturally sometimes ('that sunny afternoon...') without reciting numbers. " +
              "outro: 1-2 sentences closing the day warmly, with a promise to come back. " +
              "Natural spoken English, like a close friend talking. No emojis, no lists.",
          }],
        },
        contents: [{ role: "user", parts: [{ text: `Our day, in order:\n${day}` }] }],
        generationConfig: { temperature: 0.85, responseMimeType: "application/json", maxOutputTokens: 4096 },
      }),
    }
  );
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 200);
    return Response.json({ error: "gemini " + r.status, detail }, { status: 502 });
  }
  const j = await r.json();
  try {
    const out = JSON.parse(j.candidates[0].content.parts[0].text);
    if (!Array.isArray(out.scenes)) throw new Error("bad shape");
    // keep scenes aligned with the stops — pad or trim if Gemini miscounts
    while (out.scenes.length < stops.length) out.scenes.push("");
    out.scenes = out.scenes.slice(0, stops.length);
    return Response.json(out);
  } catch {
    return Response.json({ error: "bad gemini reply" }, { status: 502 });
  }
};

export const config = { path: "/api/album" };
