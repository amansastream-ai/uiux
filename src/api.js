async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Sutura API indisponible (${response.status}).`);
  return response;
}

export async function askSutura({ message, language, history = [] }) {
  const response = await postJson('/api/assistant', { message, language, history });
  const result = await response.json();
  if (!result.text) throw new Error('Réponse IA vide.');
  return result.text;
}

export async function playSuturaVoice(text, language = 'fr') {
  const response = await postJson('/api/speech', { text, language });
  const mime = response.headers.get('content-type') || '';
  if (!mime.startsWith('audio/')) throw new Error('Audio invalide.');
  const url = URL.createObjectURL(await response.blob());
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.onerror = () => URL.revokeObjectURL(url);
  try {
    await audio.play();
    return true;
  } catch {
    URL.revokeObjectURL(url);
    return false;
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function transcribeSuturaAudio(blob, language = 'fr') {
  if (blob.size > 3_500_000) throw new Error('Enregistrement trop long. Réessayez avec un message plus court.');
  const response = await postJson('/api/transcribe', {
    audioBase64: toBase64(await blob.arrayBuffer()),
    mimeType: blob.type || 'audio/webm',
    language,
  });
  const result = await response.json();
  if (!result.text) throw new Error('Aucune parole détectée. Réessayez.');
  return result.text;
}
