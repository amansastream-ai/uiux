export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function readJson(request, maxBytes = 20_000) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('payload-too-large');
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error('payload-too-large');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid-json');
  }
}

export function methodNotAllowed() {
  return json({ error: 'Method not allowed.' }, 405);
}

export function apiError(error) {
  if (error?.message === 'payload-too-large') return json({ error: 'Request too large.' }, 413);
  if (error?.message === 'invalid-json') return json({ error: 'Invalid JSON.' }, 400);
  return json({ error: 'The service is temporarily unavailable.' }, 502);
}
