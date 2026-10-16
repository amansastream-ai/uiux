/*
 * Configuration publique de Lamex TV.
 * Aucune clé secrète ne doit être ajoutée dans ce fichier.
 */
window.LAMEX_CONFIG = {
  channelId: "UCWi0IYaXV-pixRSJLqU3jwg",
  channelUrl: "https://www.youtube.com/@lamextvlive",
  playlistId: "PLAt3BZ1JJEzo",
  rssEndpoint: "/api/rss",
  liveEndpoint: "/api/live",
  liveCheckSeconds: 90,

  // "youtube" utilise le direct de la chaîne. Pour un flux vMix dédié,
  // publiez d'abord le RTMP vers un service d'ingest puis renseignez une URL HLS.
  streamMode: "youtube",
  hlsPlaybackUrl: ""
};
