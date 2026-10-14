/**
 * SunuÉcole — Utilitaires partagés côté serveur.
 */
import crypto from 'node:crypto';

export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

/** Date ISO + n jours (n peut être négatif). */
export function addDays(dateStr, days) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function addMonths(dateStr, months) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0));
  return d.toISOString().slice(0, 10);
}

export function monthKey(dateStr = today()) {
  return String(dateStr).slice(0, 7);
}

export const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

/** Génère une référence lisible : FAC-2026-00042 */
export function ref(prefix, n, pad = 5) {
  const year = new Date().getUTCFullYear();
  return `${prefix}-${year}-${String(n).padStart(pad, '0')}`;
}

export const uuid = () => crypto.randomUUID();
export const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const pickN = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

/** Arrondi monétaire XOF (pas de centimes) ou numérique (2 décimales). */
export const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};
export const money = (n) => Math.round(Number(n) || 0);

export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));

/** Slugify accent-insensible (noms d'écoles, matières…). */
export function slugify(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Masque un numéro de téléphone dans les exports publics : 77 123 ** **. */
export function maskPhone(p) {
  const s = String(p || '').replace(/\D/g, '');
  if (s.length < 6) return p || '';
  return `${s.slice(0, s.length - 4)}${'*'.repeat(4)}`;
}

/** Normalise un numéro sénégalais / international pour les passerelles SMS & Mobile Money. */
export function normalizePhone(input, defaultCountryCode = '221') {
  let s = String(input || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (s.startsWith('+')) return s;
  s = s.replace(/\D/g, '');
  if (s.length === 9 && /^[67]/.test(s)) return `+${defaultCountryCode}${s}`;
  if (s.startsWith(defaultCountryCode)) return `+${s}`;
  return `+${defaultCountryCode}${s}`;
}

export const isValidPhone = (p) => /^\+?\d{8,15}$/.test(String(p || '').replace(/[\s().-]/g, ''));
export const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(e || '').trim());

/** Validation déclarative et légère des payloads (sans dépendance externe). */
export class ValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
    this.fields = fields;
  }
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    Object.assign(this, extra);
  }
}

/** Construit dynamiquement un fragment WHERE + params à partir d'un objet. */
export function whereFrom(obj, allowedFields, alias = '') {
  const clauses = [];
  const params = [];
  for (const [k, v] of Object.entries(obj || {})) {
    if (!allowedFields.includes(k) || v === undefined || v === '' || v === null) continue;
    clauses.push(`${alias ? `${alias}.` : ''}${k} = ?`);
    params.push(normalizeSqlValue(v));
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

export function normalizeSqlValue(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v && typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** Pagination sûre. */
export function pageParams(query, defaultSize = 25, maxSize = 200) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const size = clamp(Number.parseInt(query.limit ?? query.size, 10) || defaultSize, 1, maxSize);
  return { page, size, offset: (page - 1) * size };
}

/** Découpe un texte SMS en segments de 160 caractères (facturation). */
export function smsSegments(body, per = 160) {
  const t = String(body || '');
  return Math.max(1, Math.ceil(t.length / per));
}

/** Formate un montant en FCFA lisible côté serveur (logs, exports CSV). */
export function formatXOF(n) {
  return `${new Intl.NumberFormat('fr-FR').format(money(n))} FCFA`;
}

/** Mention selon le barème de l'école. */
export function mentionFor(avg, scale) {
  const found = (scale || []).find((s) => avg >= s.min);
  return found ? found.mention : 'Insuffisant';
}

/** Couleur déterministe pour les avatars (évite de charger des images). */
const AVATAR_COLORS = [
  '#0e7c66', '#1d4ed8', '#b45309', '#be123c', '#4d7c0f',
  '#7c3aed', '#0f766e', '#c2410c', '#155e75', '#a21caf',
];
export function avatarColor(seed) {
  const h = crypto.createHash('sha1').update(String(seed)).digest();
  return AVATAR_COLORS[h[0] % AVATAR_COLORS.length];
}

/** Initiales pour les avatars sans photo. */
export function initials(first = '', last = '') {
  return `${String(first)[0] || ''}${String(last)[0] || ''}`.toUpperCase();
}

/** Nettoie un objet reçu du client : retire undefined et clés vides. */
export function sanitizeInput(obj, allowed) {
  const out = {};
  for (const key of allowed) {
    if (obj && obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

/** Recherche floue tolérante aux accents et à la casse (LIKE + COLLATE NOCASE). */
export function likeParam(q) {
  return `%${String(q || '').trim().replace(/[%_]/g, '')}%`;
}

/** Retire les accents pour une comparaison insensible. */
export const unaccent = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
