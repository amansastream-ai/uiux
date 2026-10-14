/**
 * SunuÉcole — Jeu d'icônes SVG inline.
 *
 * Choix délibéré : icônes vectorielles intégrées au JS plutôt qu'une police
 * d'icônes ou un CDN. Résultat : zéro requête réseau supplémentaire, rendu
 * net à toute taille, compatible hors-ligne, et colorable via currentColor.
 */

const P = {
  // --- Navigation & interface ---
  dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.6"/><rect x="3" y="15" width="7.5" height="6" rx="1.6"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  home: '<path d="m3 9.5 9-7 9 7V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  'panel-left': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.35-4.35"/>',
  filter: '<path d="M21 4H3l7.2 8.5V19l3.6 2v-8.5z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  bell: '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.4 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 5.96-2.74 7.33"/>',
  'bell-ring': '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.4 13.96 18 12.5 18 8a6 6 0 0 0-9.3-5"/><path d="M2 8c0-3.9 1.8-6.3 2.7-7.2"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1.4"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',

  // --- Actions ---
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  'check-circle': '<circle cx="12" cy="12" r="9.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
  'x-circle': '<circle cx="12" cy="12" r="9.5"/><path d="m15 9-6 6M9 9l6 6"/>',
  'alert-triangle': '<path d="M21.7 18.3 13.4 3.6a1.6 1.6 0 0 0-2.8 0L2.3 18.3A1.6 1.6 0 0 0 3.7 21h16.6a1.6 1.6 0 0 0 1.4-2.7z"/><path d="M12 9v4.5M12 17.2h.01"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5M12 16.3h.01"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16.5v-5M12 8h.01"/>',
  'help-circle': '<circle cx="12" cy="12" r="9.5"/><path d="M9.2 9.3a3 3 0 0 1 5.8 1c0 2-3 2.7-3 2.7"/><path d="M12 17h.01"/>',
  'chevron-down': '<path d="m6 9.5 6 6 6-6"/>',
  'chevron-up': '<path d="m6 14.5 6-6 6 6"/>',
  'chevron-left': '<path d="m14.5 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  'chevrons-left': '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
  'chevrons-right': '<path d="m13 17 5-5-5-5M6 17l5-5-5-5"/>',
  'arrow-right': '<path d="M5 12h14M12.5 5.5 19 12l-6.5 6.5"/>',
  'arrow-left': '<path d="M19 12H5M11.5 5.5 5 12l6.5 6.5"/>',
  'arrow-up': '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  'arrow-down': '<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>',
  'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
  'arrow-down-right': '<path d="M7 7l10 10M17 8v9H8"/>',
  'arrow-left-right': '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
  edit: '<path d="M12.5 20H21"/><path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.5 18.5l-4 1 1-4z"/>',
  'pen-tool': '<path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><circle cx="11" cy="11" r="2"/>',
  trash: '<path d="M3.5 6h17M8.5 6V4.2A1.7 1.7 0 0 1 10.2 2.5h3.6A1.7 1.7 0 0 1 15.5 4.2V6"/><path d="M18.5 6 17.6 20a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9L5.5 6"/><path d="M10 11v6M14 11v6"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  download: '<path d="M21 15.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M12 3v12"/>',
  printer: '<path d="M6.5 9V3h11v6"/><path d="M6.5 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1.5"/><rect x="6.5" y="14" width="11" height="7" rx="1.2"/>',
  refresh: '<path d="M3.5 12a8.5 8.5 0 0 1 14.4-6.1L21 8.5"/><path d="M21 3.5v5h-5"/><path d="M20.5 12a8.5 8.5 0 0 1-14.4 6.1L3 15.5"/><path d="M3 20.5v-5h5"/>',
  copy: '<rect x="9" y="9" width="12.5" height="12.5" rx="2"/><path d="M5.5 15H4.5a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2H13a2 2 0 0 1 2 2v1"/>',
  'external-link': '<path d="M15 3.5h5.5V9"/><path d="M10 14 20.5 3.5"/><path d="M18.5 13.5v5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h5"/>',
  send: '<path d="m21.5 2.5-7 19.5-4-8.5-8.5-4z"/><path d="M21.5 2.5 10.5 13.5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  maximize: '<path d="M8 3.5H5.5a2 2 0 0 0-2 2V8M21 8V5.5a2 2 0 0 0-2-2h-2.5M3.5 16v2.5a2 2 0 0 0 2 2H8M16 20.5H18.5a2 2 0 0 0 2-2V16"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M9.9 9.9a3 3 0 1 0 4.2 4.2"/><path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/>',
  'more-h': '<circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  'more-v': '<circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/>',
  repeat: '<path d="m17 2.5 3.5 3.5L17 9.5"/><path d="M3.5 11.5v-1a4 4 0 0 1 4-4h13"/><path d="m7 21.5-3.5-3.5L7 14.5"/><path d="M20.5 12.5v1a4 4 0 0 1-4 4h-13"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3.5 2"/>',
  sparkles: '<path d="m12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M19 3v3.5M20.8 4.8h-3.5"/>',
  zap: '<path d="M13 2 4.5 13.5H11L10 22l9-11.5h-6.5z"/>',
  target: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.6"/>',
  flag: '<path d="M4.5 15s1-1 4-1 5 2 8 2 3.5-1 3.5-1V3.5s-1 1-3.5 1-5.5-2-8.5-2-3.5 1-3.5 1z"/><path d="M4.5 22v-7"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none"/>',
  bookmark: '<path d="m19 21-7-4.5L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  'log-out': '<path d="M9.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4.5"/><path d="m16 16.5 4.5-4.5L16 7.5"/><path d="M20.5 12H9.5"/>',
  'log-in': '<path d="M14.5 21H19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4.5"/><path d="m10 16.5-4.5-4.5L10 7.5"/><path d="M5.5 12h14"/>',

  // --- Personnes ---
  user: '<path d="M19 21v-1.8a4.2 4.2 0 0 0-4.2-4.2H9.2A4.2 4.2 0 0 0 5 19.2V21"/><circle cx="12" cy="7.2" r="4.2"/>',
  users: '<path d="M16 21v-1.8a4.2 4.2 0 0 0-4.2-4.2H6.2A4.2 4.2 0 0 0 2 19.2V21"/><circle cx="9" cy="7.2" r="4.2"/><path d="M22 21v-1.8a4.2 4.2 0 0 0-3.2-4.1M16.5 3.3a4.2 4.2 0 0 1 0 8"/>',
  'user-plus': '<path d="M15 21v-1.8a4.2 4.2 0 0 0-4.2-4.2H6.2A4.2 4.2 0 0 0 2 19.2V21"/><circle cx="8.5" cy="7.2" r="4.2"/><path d="M19 8.5v6M22 11.5h-6"/>',
  'user-check': '<path d="M15 21v-1.8a4.2 4.2 0 0 0-4.2-4.2H6.2A4.2 4.2 0 0 0 2 19.2V21"/><circle cx="8.5" cy="7.2" r="4.2"/><path d="m16.5 11.5 2 2 4-4"/>',
  'user-x': '<path d="M15 21v-1.8a4.2 4.2 0 0 0-4.2-4.2H6.2A4.2 4.2 0 0 0 2 19.2V21"/><circle cx="8.5" cy="7.2" r="4.2"/><path d="m17 9 5 5M22 9l-5 5"/>',
  'user-cog': '<path d="M13.5 21v-1.8a4.2 4.2 0 0 0-4.2-4.2H5.2A4.2 4.2 0 0 0 1 19.2V21"/><circle cx="7.5" cy="7.2" r="4.2"/><circle cx="18.3" cy="12.6" r="2.4"/><path d="M18.3 8.9v1.3M18.3 15v1.3M22 12.6h-1.3M15.9 12.6h-1.3M20.9 15.2l-.9-.9M16.6 10.9l-.9-.9M20.9 10l-.9.9M16.6 14.3l-.9.9"/>',
  'id-card': '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><circle cx="8.4" cy="11" r="2.2"/><path d="M4.8 16.2c.6-1.5 2-2.3 3.6-2.3s3 .8 3.6 2.3M14.6 10h4M14.6 13.6h4"/>',
  pencil: '<path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5z"/><path d="M14.5 5.5 17.5 8.5"/>',
  note: '<path d="M4 4.6A1.6 1.6 0 0 1 5.6 3h12.8A1.6 1.6 0 0 1 20 4.6V21l-4-2.4-4 2.4-4-2.4L4 21z"/><path d="M8 8.2h8M8 12h5"/>',
  'check-check': '<path d="m1.6 12.6 4 4L14.2 8"/><path d="m10.4 15.6 1.6 1.6L22.4 6.8"/>',
  loader: '<path d="M12 2.6v4M12 17.4v4M4.4 4.4 7.2 7.2M16.8 16.8l2.8 2.8M2.6 12h4M17.4 12h4M4.4 19.6 7.2 16.8M16.8 7.2l2.8-2.8"/>',
  landmark: '<path d="m3 9.4 9-5.4 9 5.4"/><path d="M5 9.6v8.6M9.7 9.6v8.6M14.3 9.6v8.6M19 9.6v8.6M2.6 21h18.8M3.6 18.2h16.8"/>',
  hourglass: '<path d="M6.6 2.6h10.8M6.6 21.4h10.8"/><path d="M7.6 2.6c0 4 4.4 5.6 4.4 9.4s-4.4 5.4-4.4 9.4M16.4 2.6c0 4-4.4 5.6-4.4 9.4s4.4 5.4 4.4 9.4"/>',
  beach: '<path d="M12 3.2a8.4 8.4 0 0 1 8.4 8.4H3.6A8.4 8.4 0 0 1 12 3.2z"/><path d="M12 11.6V19a2.6 2.6 0 0 0 5.2 0"/><path d="M12 3.2v1.4"/>',
  'chef-hat': '<path d="M6.2 20.4h11.6v-6.2a4.2 4.2 0 1 0-2.6-7.4 4.2 4.2 0 0 0-6.4-.5A4.2 4.2 0 1 0 6.2 14.2z"/><path d="M6.2 17.2h11.6"/>',
  seat: '<path d="M5.4 4.2v9.6a2.2 2.2 0 0 0 2.2 2.2h6.2"/><path d="M5.4 16h8.4a2.6 2.6 0 0 1 2.6 2.6v1.6"/><path d="M3.6 20.2h14.2M18.4 6.2v6"/>',
  ambulance: '<path d="M2.6 17.4V8.6a1.6 1.6 0 0 1 1.6-1.6h10.6a1.6 1.6 0 0 1 1.6 1.6v8.8"/><path d="M16.4 11h2.8a1.6 1.6 0 0 1 1.4.8l1.4 2.6v3"/><circle cx="7" cy="18.4" r="1.8"/><circle cx="17" cy="18.4" r="1.8"/><path d="M9.2 11.6h3M10.7 10.1v3"/>',
  tags: '<path d="M4.6 10.9V5.4A1.8 1.8 0 0 1 6.4 3.6h5.5a1.8 1.8 0 0 1 1.3.5l7 7a1.8 1.8 0 0 1 0 2.6l-5.5 5.5a1.8 1.8 0 0 1-2.6 0l-7-7a1.8 1.8 0 0 1-.5-1.3z"/><path d="M2.8 13.6V6.6a3.4 3.4 0 0 1 3.4-3.4h6.6"/><circle cx="8.7" cy="8.2" r="1.3"/>',
  'contact-card': '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="11" r="2.4"/><path d="M5 17c.6-1.6 2.1-2.6 4-2.6s3.4 1 4 2.6M15.5 9.5h4M15.5 13.5h4"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5.5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2V21"/><path d="M2 12.5h20"/>',
  'graduation-cap': '<path d="M21.4 10.9a1 1 0 0 0 0-1.8L12.8 5.2a2 2 0 0 0-1.6 0L2.6 9.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  school: '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9.5 21v-6h5v6"/><path d="M9 11h.01M15 11h.01"/>',
  baby: '<path d="M9 12h.01M15 12h.01"/><path d="M10 16c.5.6 1.2.9 2 .9s1.5-.3 2-.9"/><path d="M14.5 4.5A2.5 2.5 0 0 0 12 2a2.5 2.5 0 0 0-2.5 2.5"/><path d="M12 22a8 8 0 0 0 8-8c0-2.5-1.5-4-3-5-1.6-1-3.2-1-5-1s-3.4 0-5 1c-1.5 1-3 2.5-3 5a8 8 0 0 0 8 8z"/>',

  // --- Pédagogie ---
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'book-marked': '<path d="M10 2v8l3-3 3 3V2"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  library: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  notebook: '<path d="M2.5 6.5h4M2.5 10.5h4M2.5 14.5h4M2.5 18.5h4"/><rect x="6.5" y="2.5" width="15" height="19" rx="2"/><path d="M10 7h7M10 11h7"/>',
  clipboard: '<rect x="8" y="2.5" width="8" height="4" rx="1.2"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/>',
  'clipboard-check': '<rect x="8" y="2.5" width="8" height="4" rx="1.2"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/><path d="m9 13.5 2.2 2.2 4.3-4.4"/>',
  'clipboard-list': '<rect x="8" y="2.5" width="8" height="4" rx="1.2"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/><path d="M12 11h4.5M12 16h4.5M8.5 11h.01M8.5 16h.01"/>',
  'clipboard-plus': '<rect x="8" y="2.5" width="8" height="4" rx="1.2"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/><path d="M12 10.8v5.4M9.3 13.5h5.4"/>',
  'file-text': '<path d="M14.5 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7.5z"/><path d="M14.5 2.5v5h5"/><path d="M8.5 13h7M8.5 17h7M8.5 9h2"/>',
  'file-plus': '<path d="M14.5 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7.5z"/><path d="M14.5 2.5v5h5"/><path d="M12 12.5v6M9 15.5h6"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2a2 2 0 0 0-1.7-.9H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/>',
  medal: '<path d="M7.2 14.5 3 7.5a1.5 1.5 0 0 1 .1-1.6L5 3.5h14l1.9 2.4a1.5 1.5 0 0 1 .1 1.6l-4.2 7"/><circle cx="12" cy="17.5" r="4.5"/><path d="m12 15.5.8 1.6 1.7.3-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.3z"/>',
  award: '<circle cx="12" cy="8.5" r="6"/><path d="m15.5 13.5 1.5 8-5-3-5 3 1.5-8"/>',
  trophy: '<path d="M6.5 9H4.8A2.3 2.3 0 0 1 4.8 4.4h1.7M17.5 9h1.7a2.3 2.3 0 0 0 0-4.6h-1.7"/><path d="M5 21.5h14"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2-.9.4-1.5 1.3-1.5 2.3M14 14.7V17c0 .6.5 1 1 1.2.9.4 1.5 1.3 1.5 2.3"/><path d="M18 2.5H6v6.8a6 6 0 0 0 12 0z"/>',
  scale: '<path d="m16 16 3-8 3 8a5 5 0 0 1-6 0z"/><path d="m2 16 3-8 3 8a5 5 0 0 1-6 0z"/><path d="M7 21.5h10M12 3.5v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  flask: '<path d="M4.5 3h15M6.5 3v15.5a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V3"/><path d="M6.5 14h11"/>',

  // --- Calendrier & temps ---
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  'calendar-check': '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/><path d="m9 15.5 2.2 2.2 4.3-4.4"/>',
  'calendar-plus': '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/><path d="M12 13.5v6M9 16.5h6"/>',
  'calendar-days': '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.8V12l3.5 2.1"/>',
  timer: '<path d="M10 2.5h4"/><circle cx="12" cy="14" r="8"/><path d="M12 14v-3.5"/>',
  'clock-alert': '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5.2l3 1.8"/>',

  // --- Finance ---
  wallet: '<path d="M19 7.5V5a1.5 1.5 0 0 0-1.5-1.5H5A2.5 2.5 0 0 0 2.5 6v12A2.5 2.5 0 0 0 5 20.5h14A1.5 1.5 0 0 0 20.5 19v-2.5"/><path d="M21.5 7.5h-5a3.5 3.5 0 0 0 0 7h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1z"/>',
  'credit-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h3"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.4"/><path d="M6 12h.01M18 12h.01"/>',
  coins: '<circle cx="8.5" cy="8.5" r="6"/><path d="M18.1 10.4a6 6 0 1 1-7.7 7.7"/><path d="M7 6h1.2v4.4"/><path d="m16.7 13.9.7.7-2.8 2.8"/>',
  receipt: '<path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5z"/><path d="M9 8.5h6M9 12.5h6M9 16.5h4"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.4"/><circle cx="17" cy="17" r="2.4"/>',
  trending: '<path d="m22 7-8.5 8.5-4.5-4.5L2 18"/><path d="M16 7h6v6"/>',
  'trending-down': '<path d="m22 17-8.5-8.5-4.5 4.5L2 6"/><path d="M16 17h6v-6"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12.5" width="3.2" height="5.5" rx="1"/><rect x="12.4" y="8.5" width="3.2" height="9.5" rx="1"/><rect x="17.8" y="5" width="3.2" height="13" rx="1"/>',
  'chart-line': '<path d="M3 3v18h18"/><path d="m7 15.5 4-5 3 3 5.5-7"/>',
  'chart-pie': '<path d="M21.2 15.9A10 10 0 1 1 8.1 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  activity: '<path d="M22 12h-4l-3 8.5L9 3.5 6 12H2"/>',
  gauge: '<path d="m12 14.5 4-4.5"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/><path d="M12 14.5h.01"/>',

  // --- Communication ---
  message: '<path d="M21 15a2 2 0 0 1-2 2H7.5L3 21V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  megaphone: '<path d="m3 11 18-5.5v13L3 13z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/><path d="M7 12.2V19a1.5 1.5 0 0 0 3 0v-5.6"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7.5-10 6-10-6"/>',
  sms: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.8L3 21l1.9-5.2a8.4 8.4 0 0 1-.8-3.8 8.4 8.4 0 0 1 8.4-8.4h.5a8.4 8.4 0 0 1 8 8z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/>',
  'at-sign': '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  share2: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',

  // --- Vie scolaire / services ---
  bus: '<path d="M8 6.5v6M16 6.5v6"/><path d="M2.5 12.5h19"/><path d="M19 18.5h1.5s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2V7a4 4 0 0 0-4-4H6.5a4 4 0 0 0-4 4v7.5c0 .4.1.8.2 1.2.3 1.1.8 2.8.8 2.8H5"/><circle cx="7.5" cy="18.5" r="2"/><circle cx="16.5" cy="18.5" r="2"/><path d="M9.5 18.5h5"/>',
  utensils: '<path d="M3 2.5v7a3 3 0 0 0 3 3 3 3 0 0 0 3-3v-7"/><path d="M6 12.5v9"/><path d="M18 2.5v19c-1.5 0-3-1.5-3-4v-5c0-2.5 1.5-7.5 3-7.5z"/>',
  'heart-pulse': '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/><path d="M3.2 12h6.3l.5-1 2 4.5 2-7 1.5 3.5h5.3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  lock: '<rect x="3.5" y="11" width="17" height="10.5" rx="2"/><path d="M7.5 11V7a4.5 4.5 0 0 1 9 0v4"/>',
  unlock: '<rect x="3.5" y="11" width="17" height="10.5" rx="2"/><path d="M7.5 11V7a4.5 4.5 0 0 1 8.8-1.3"/>',
  key: '<circle cx="7.5" cy="15.5" r="5"/><path d="m20.5 2.5-9.3 9.4M15.5 7.5l3 3L21.5 7l-3-3"/>',
  database: '<ellipse cx="12" cy="5.5" rx="8.5" ry="3"/><path d="M3.5 5.5v13a8.5 3 0 0 0 17 0v-13"/><path d="M3.5 12a8.5 3 0 0 0 17 0"/>',
  server: '<rect x="2.5" y="2.5" width="19" height="8" rx="2"/><rect x="2.5" y="13.5" width="19" height="8" rx="2"/><path d="M6.5 6.5h.01M6.5 17.5h.01"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6.5 6.5 0 0 0-12.4 2A4 4 0 0 0 6 19z"/>',
  'cloud-off': '<path d="m2 2 20 20"/><path d="M5.8 5.8A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.2"/><path d="M21.5 16.5A4.5 4.5 0 0 0 17.5 10h-1.8A7 7 0 0 0 10 5.1"/>',
  'wifi-off': '<path d="m2 2 20 20"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-2-1.6"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-11.3-3.8"/><path d="M12 20h.01"/>',
  smartphone: '<rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M12 18.5h.01"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8.5 21h7M12 17v4"/>',
  gift: '<rect x="2.5" y="7.5" width="19" height="13.5" rx="2"/><path d="M2.5 12.5h19M12 21V7.5"/><path d="M12 7.5H7.8a2.3 2.3 0 0 1 0-4.6C11 2.9 12 7.5 12 7.5z"/><path d="M12 7.5h4.2a2.3 2.3 0 0 0 0-4.6C13 2.9 12 7.5 12 7.5z"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
  ticket: '<path d="M2.5 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2h-15a2 2 0 0 0-2 2z"/><path d="M13.5 5.5v2M13.5 11v2M13.5 16.5v2"/>',
  hash: '<path d="M4 9h16M4 15h16M10.5 3 8.5 21M16.5 3l-2 18"/>',
  globe: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5a15 15 0 0 1 0 19 15 15 0 0 1 0-19"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  'map-pin': '<path d="M20 10.5c0 5.5-8 11.5-8 11.5s-8-6-8-11.5a8 8 0 0 1 16 0z"/><circle cx="12" cy="10.5" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
  moon: '<path d="M12 3a6.5 6.5 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  contrast: '<circle cx="12" cy="12" r="9.5"/><path d="M12 2.5v19a9.5 9.5 0 0 0 0-19z" fill="currentColor" stroke="none"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="1.1" fill="currentColor" stroke="none"/><path d="M12 2.5A9.5 9.5 0 0 0 2.5 12 9.5 9.5 0 0 0 12 21.5c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1a1.6 1.6 0 0 1 1.6-1.7h2a5.6 5.6 0 0 0 5.6-5.6C22 6.1 17.5 2.5 12 2.5z"/>',
  type: '<path d="M4 7V4.5h16V7M9.5 20h5M12 4.5V20"/>',
  'life-buoy': '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="4"/><path d="m5 5 4 4M15 15l4 4M15 9l4-4M9 15l-4 4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/>',
};

/** Renvoie le SVG d'une icône (chaîne prête à insérer). */
export function icon(name, opts = {}) {
  const body = P[name] || P.info;
  const size = opts.size || 18;
  const cls = opts.class ? ` class="${opts.class}"` : '';
  const sw = opts.strokeWidth || 1.85;
  const aria = opts.label ? ` aria-label="${opts.label}" role="img"` : ' aria-hidden="true"';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${cls}${aria}>${body}</svg>`;
}

export const hasIcon = (name) => Boolean(P[name]);
export const iconNames = Object.keys(P);

export default icon;
