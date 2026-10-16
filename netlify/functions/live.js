'use strict';

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{20,28}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;

function extractVideoId(data) {
  const htmlMatch = String(data.html || '').match(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,20})/i);
  if (htmlMatch && VIDEO_ID_PATTERN.test(htmlMatch[1])) return htmlMatch[1];
  const thumbnailMatch = String(data.thumbnail_url || '').match(/\/vi(?:_webp)?\/([A-Za-z0-9_-]{6,20})\//i);
  return thumbnailMatch && VIDEO_ID_PATTERN.test(thumbnailMatch[1]) ? thumbnailMatch[1] : null;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { Allow: 'GET', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Méthode non autorisée.' })
    };
  }

  const channelId = event.queryStringParameters && event.queryStringParameters.channelId;
  if (!channelId || !CHANNEL_ID_PATTERN.test(channelId)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Identifiant de chaîne YouTube invalide.' })
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
    'X-Content-Type-Options': 'nosniff'
  };

  try {
    const livePage = `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(livePage)}&format=json`;
    const response = await fetch(oembedUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'LamexTV-Web/1.0' },
      signal: controller.signal
    });

    if (!response.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ isLive: false }) };
    }

    const data = await response.json();
    const isLive = Boolean(data && data.type === 'video');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        isLive,
        videoId: isLive ? extractVideoId(data) : null,
        title: isLive && data.title ? String(data.title).slice(0, 180) : null
      })
    };
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: timedOut ? 'Délai dépassé pour vérifier le direct.' : 'Impossible de vérifier le direct.' })
    };
  } finally {
    clearTimeout(timeout);
  }
};
