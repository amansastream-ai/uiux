/**
 * SunuÉcole — Helpers de réponse HTTP normalisés.
 * Toutes les listes renvoient { data, meta:{ page, size, total, pages } }
 * ce qui simplifie énormément le code du front (pagination, recherche, filtres).
 */
import db from '../db/index.js';
import { pageParams, likeParam } from './utils.js';

export function list(res, { rows, total, query }) {
  const { page, size } = pageParams(query);
  res.json({
    data: rows,
    meta: { page, size, total, pages: Math.max(1, Math.ceil(total / size)) },
  });
}

/**
 * Construit une requête paginée sécurisée.
 * @param {object} opts
 * @param {string} opts.from     FROM + JOIN
 * @param {string} opts.select   liste des colonnes
 * @param {string[]} opts.where  conditions déjà préfixées par " AND "
 * @param {any[]} opts.params    valeurs correspondantes
 * @param {string} opts.orderBy
 * @param {string} opts.countFrom FROM utilisé pour le COUNT (défaut = opts.from)
 */
export function paginate(query, { from, select, where = [], params = [], orderBy, countFrom }) {
  const { size, offset } = pageParams(query);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.pluck(`SELECT COUNT(*) FROM ${countFrom || from} ${whereSql}`, params) ?? 0;
  const rows = db.all(
    `SELECT ${select} FROM ${from} ${whereSql} ${orderBy ? `ORDER BY ${orderBy}` : ''} LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  return { rows, total, size, offset };
}

/** Recherche floue insensible à la casse et aux accents sur plusieurs colonnes. */
export function searchClause(q, columns, params) {
  const term = String(q || '').trim();
  if (!term) return '';
  const or = columns.map((c) => `${c} LIKE ?`).join(' OR ');
  columns.forEach(() => params.push(likeParam(term)));
  return ` AND (${or})`;
}

/** Renvoie un 201 avec l'objet créé. */
export function created(res, data) {
  res.status(201).json({ data });
}

/** Renvoie une réponse simple { data }. */
export function ok(res, data) {
  res.json({ data });
}

/** Conversion automatique des colonnes *_json en objets JS. */
export function parseJsonFields(row, fields) {
  if (!row) return row;
  for (const f of fields) {
    if (typeof row[f] === 'string') {
      try { row[f.replace(/_json$/, '')] = JSON.parse(row[f]); } catch { row[f.replace(/_json$/, '')] = null; }
      delete row[f];
    }
  }
  return row;
}
