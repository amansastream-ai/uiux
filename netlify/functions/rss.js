'use strict';

const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{20,28}$/;

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
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
    const response = await fetch(feedUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'User-Agent': 'LamexTV-Web/1.0 (+https://lamextvlive.netlify.app)'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'Le flux YouTube est momentanément indisponible.' })
      };
    }

    const xml = await response.text();
    if (!xml.includes('<feed') || xml.length > 1_500_000) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'Réponse inattendue du flux YouTube.' })
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/atom+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=900',
        'X-Content-Type-Options': 'nosniff'
      },
      body: xml
    };
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: timedOut ? 'Délai dépassé pour contacter YouTube.' : 'Impossible de récupérer le flux YouTube.' })
    };
  } finally {
    clearTimeout(timeout);
  }
};
