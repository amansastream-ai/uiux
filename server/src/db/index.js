/**
 * SunuÉcole — Couche d'accès aux données.
 *
 * Utilise le moteur SQLite intégré à Node (node:sqlite) : aucune dépendance
 * native à compiler, ce qui garantit une installation fiable même sur un
 * petit serveur local dans un établissement (Windows/Linux/macOS, hors-ligne).
 *
 * L'API expose un confort proche de better-sqlite3 :
 *   db.all(sql, params) / db.get(sql, params) / db.run(sql, params)
 *   db.tx(() => { ... })   → transaction avec rollback automatique
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.db.file), { recursive: true });
fs.mkdirSync(config.paths.uploads, { recursive: true });
fs.mkdirSync(config.paths.backups, { recursive: true });

/** @type {DatabaseSync} */
let raw;
let inTransaction = 0;

function open() {
  raw = new DatabaseSync(config.db.file);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA synchronous = NORMAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA busy_timeout = 5000;');
  raw.exec('PRAGMA cache_size = -16000;'); // ~16 Mo de cache : listes fluides
  raw.exec('PRAGMA temp_store = MEMORY;');
  migrate();
}

/** Ajoute une colonne uniquement si elle est absente (SQLite n'a pas IF NOT EXISTS). */
function ensureColumn(table, column, ddl) {
  const cols = raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    try {
      raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    } catch (err) {
      console.warn(`[migration] ${table}.${column} ignoré : ${err.message}`);
    }
  }
}

/** Le schéma SQL : à côté du module, ou via SUE_SCHEMA_PATH, ou dans
 *  l'arborescence du dépôt (bundles serverless où __dirname = le bundle). */
function schemaPath() {
  const cand = [
    process.env.SUE_SCHEMA_PATH,
    path.join(__dirname, 'schema.sql'),
    path.join(process.cwd(), 'server', 'src', 'db', 'schema.sql'),
    '/var/task/server/src/db/schema.sql',
  ].filter(Boolean);
  for (const c of cand) { try { if (fs.existsSync(c)) return c; } catch { /* ignoré */ } }
  return cand[1] || cand[0];
}

function migrate() {
  const schema = fs.readFileSync(schemaPath(), 'utf8');
  raw.exec(schema);
  // Migrations légères et idempotentes pour les bases déjà existantes.
  ensureColumn('schools', 'demo', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('students', 'avg_cache', 'REAL');
  const v = raw.prepare('PRAGMA user_version').get();
  if (!v || Number(v.user_version) < 1) raw.exec('PRAGMA user_version = 1');
}

open();

/* ------------------------------------------------------------------ */
/* Normalisation : node:sqlite renvoie des objets à prototype null.    */
/* ------------------------------------------------------------------ */
const plain = (row) => (row === undefined || row === null ? undefined : { ...row });

/** Cache des statements préparés (clé = SQL). Gros gain sur les listes. */
const stmtCache = new Map();
function stmt(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = raw.prepare(sql);
    if (stmtCache.size > 400) stmtCache.clear();
    stmtCache.set(sql, s);
  }
  return s;
}

/**
 * Convertit { a, b } en { $a, $b } pour les paramètres nommés node:sqlite.
 * Les tableaux sont passés tels quels (paramètres positionnels ?).
 */
function bind(params) {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params.map(normalizeValue);
  if (typeof params === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
      const key = k.startsWith('$') || k.startsWith(':') ? k : `$${k}`;
      out[key] = normalizeValue(v);
    }
    return [out];
  }
  return [normalizeValue(params)];
}

/** SQLite n'accepte ni undefined ni les objets : on assainit à la volée. */
function normalizeValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number(v);
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export const db = {
  all(sql, params) {
    const rows = stmt(sql).all(...bind(params));
    return rows.map((r) => ({ ...r }));
  },
  get(sql, params) {
    return plain(stmt(sql).get(...bind(params)));
  },
  run(sql, params) {
    const r = stmt(sql).run(...bind(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  },
  /** INSERT puis renvoie directement l'id créé. */
  insert(sql, params) {
    return this.run(sql, params).lastInsertRowid;
  },
  exec(sql) {
    raw.exec(sql);
  },
  pluck(sql, params) {
    const row = this.get(sql, params);
    if (!row) return undefined;
    return Object.values(row)[0];
  },
  /** Transaction imbriquable (les niveaux internes deviennent des savepoints). */
  tx(fn) {
    if (inTransaction > 0) {
      const sp = `sp_${inTransaction}`;
      raw.exec(`SAVEPOINT ${sp}`);
      inTransaction += 1;
      try {
        const result = fn(this);
        raw.exec(`RELEASE ${sp}`);
        return result;
      } catch (err) {
        try {
          raw.exec(`ROLLBACK TO ${sp}`);
          raw.exec(`RELEASE ${sp}`);
        } catch {
          /* ignore */
        }
        inTransaction -= 1;
        throw err;
      }
    }
    raw.exec('BEGIN IMMEDIATE');
    inTransaction = 1;
    try {
      const result = fn(this);
      raw.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        raw.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      inTransaction = 0;
    }
  },
  /** Copie physique de la base (sauvegarde à chaud, sans bloquer l'écriture). */
  backup(destFile) {
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    if (fs.existsSync(destFile)) fs.rmSync(destFile);
    const target = new DatabaseSync(destFile);
    try {
      raw.exec('PRAGMA wal_checkpoint(FULL);');
      // sqlite_sequence & co sont réservés : les recopier faisait échouer
      // TOUTES les sauvegardes (npm run backup comme POST /api/settings/backups).
      // foreign_keys=OFF : les tables peuvent être copiées dans n'importe quel
      // ordre (sinon un INSERT vers une table référencée non encore créée échoue).
      target.exec('PRAGMA foreign_keys=OFF;');
      target.exec('BEGIN IMMEDIATE;');
      const tables = db.all(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
      );
      for (const t of tables) {
        target.exec(t.sql);
        const cols = db.all(`PRAGMA table_info(${t.name})`).map((c) => c.name);
        const rows = db.all(`SELECT * FROM ${t.name}`);
        const ins = target.prepare(
          `INSERT INTO ${t.name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        );
        for (const r of rows) ins.run(...cols.map((c) => normalizeValue(r[c])));
      }
      for (const ix of db.all("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")) {
        try { target.exec(ix.sql); } catch { /* index implicite déjà présent */ }
      }
      target.exec('COMMIT;');
      return { file: destFile, size: fs.statSync(destFile).size };
    } finally {
      target.close();
    }
  },
  close() {
    try {
      raw.close();
    } catch {
      /* ignore */
    }
  },
  get raw() {
    return raw;
  },
};

export default db;
