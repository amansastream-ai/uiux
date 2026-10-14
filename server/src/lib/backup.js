#!/usr/bin/env node
/**
 * SunuÉcole — Sauvegarde manuelle en ligne de commande.
 *
 * Usage : npm run backup
 * Copie cohérente de la base SQLite (API backup de node:sqlite) vers
 * server/data/backups/, horodatée. Utilisée aussi par POST /api/settings/backups.
 */
import path from 'node:path';
import fs from 'node:fs';
import db from '../db/index.js';
import { config } from '../config.js';
import { today } from './utils.js';

const dest = path.join(config.paths.backups, `sunuecole-${today()}-${Date.now()}.sqlite`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
const r = db.backup(dest);
console.log(`✔ Sauvegarde créée : ${r.file} (${Math.round(r.size / 1024)} Ko)`);
db.close();
