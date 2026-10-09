import { apiError, json, methodNotAllowed, readJson } from '../shared/http.mjs';

const languages = new Set(['fr', 'wo', 'en']);
const languageCodes = { fr: 'fra', wo: 'wol', en: 'eng' };
const allowedMimeTypes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav'];

export default async function handler(request) {
  if (request.method !== 'POST') return methodNotAllowed();
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return json({ error: 'ElevenLabs is not configured.' }, 503);

  try {
    const body = await readJson(request, 4_900_000);
    const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64 : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.split(';')[0].toLowerCase() : '';
    const language = languages.has(body.language) ? body.language : 'fr';
    if (!audioBase64 || audioBase64.length > 4_700_000 || !allowedMimeTypes.includes(mimeType)) {
      return json({ error: 'Audio format or size is not supported.' }, 400);
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)) return json({ error: 'Invalid audio data.' }, 400);

    const audio = Buffer.from(audioBase64, 'base64');
    if (!audio.length || audio.length > 3_500_000) return json({ error: 'Audio is too large.' }, 413);
    const extension = mimeType.split('/')[1].replace('x-', '') || 'webm';
    const form = new FormData();
    form.set('file', new Blob([audio], { type: mimeType }), `sutura-recording.${extension}`);
    form.set('model_id', process.env.ELEVENLABS_STT_MODEL_ID || 'scribe_v2');
    form.set('language_code', languageCodes[language]);
    form.set('tag_audio_events', 'false');
    form.set('diarize', 'false');

    const upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!upstream.ok) return json({ error: 'ElevenLabs transcription request failed.' }, 502);

    const result = await upstream.json();
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    if (!text) return json({ error: 'No speech detected.' }, 422);
    return json({ text: text.slice(0, 3_000) });
  } catch (error) {
    return apiError(error);
  }
}
