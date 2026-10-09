import { apiError, json, methodNotAllowed, readJson } from '../shared/http.mjs';

const languages = new Set(['fr', 'wo', 'en']);
const languageCodes = { fr: 'fr', wo: 'wo', en: 'en' };

export default async function handler(request) {
  if (request.method !== 'POST') return methodNotAllowed();
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) return json({ error: 'ElevenLabs is not configured.' }, 503);

  try {
    const body = await readJson(request, 12_000);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const language = languages.has(body.language) ? body.language : 'fr';
    if (!text || text.length > 5_000) return json({ error: 'Text must contain 1–5000 characters.' }, 400);

    const query = new URLSearchParams({ output_format: 'mp3_44100_128' });
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?${query}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_v4_turbo',
        language_code: languageCodes[language],
        voice_settings: {
          stability: 0.52,
          similarity_boost: 0.78,
          style: 0.12,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!upstream.ok) return json({ error: 'ElevenLabs speech request failed.' }, 502);

    const audio = await upstream.arrayBuffer();
    if (!audio.byteLength || audio.byteLength > 12_000_000) return json({ error: 'Audio response unavailable.' }, 502);
    return new Response(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
