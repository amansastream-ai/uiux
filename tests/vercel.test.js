'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { open, schema, seed, resolveDbPath } = require('../server/db');
const appModule = require('../server/index');
const vercelHandler = require('../api/index');

function createTempDb(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `chronorh-test-${tag}-`));
  const dbPath = path.join(dir, 'chronorh.db');
  const db = open(dbPath);
  schema(db);
  seed(db);
  return { db, dbPath, dir };
}

function requestHandler(handler, { method = 'GET', url = '/', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (cookie) headers['Cookie'] = cookie;
        const res = await fetch(`http://127.0.0.1:${port}${url}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const setCookie = res.headers.get('set-cookie') || '';
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* HTML or plain */ }
        resolve({ status: res.status, json, text, setCookie });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

test('Vercel : resolveDbPath bascule vers /tmp lorsque VERCEL=1', () => {
  const prevVercel = process.env.VERCEL;
  const prevDir = process.env.CHRONORH_DATA_DIR;
  const prevPath = process.env.CHRONORH_DB_PATH;
  try {
    delete process.env.CHRONORH_DATA_DIR;
    delete process.env.CHRONORH_DB_PATH;
    process.env.VERCEL = '1';
    const resolved = resolveDbPath();
    assert.ok(resolved.startsWith(os.tmpdir()), `Attendu un chemin dans ${os.tmpdir()}, obtenu : ${resolved}`);
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = prevVercel;
    if (prevDir === undefined) delete process.env.CHRONORH_DATA_DIR; else process.env.CHRONORH_DATA_DIR = prevDir;
    if (prevPath === undefined) delete process.env.CHRONORH_DB_PATH; else process.env.CHRONORH_DB_PATH = prevPath;
  }
});

test('Vercel : api/index.js répond sur /api/health et sur /health (préfixe normalisé)', async () => {
  const r1 = await requestHandler(vercelHandler, { url: '/api/health' });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.status, 'ok');
  assert.ok(r1.json.employees >= 12);

  const r2 = await requestHandler(vercelHandler, { url: '/health' });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.status, 'ok');
});

test('Vercel : la session survit à un démarrage à froid / changement d’instance serverless', async () => {
  const instA = createTempDb('instA');
  const instB = createTempDb('instB');
  const appA = appModule.createApp(instA.db);
  const appB = appModule.createApp(instB.db);

  // 1. Connexion sur l'instance A
  const login = await requestHandler(appA, {
    method: 'POST',
    url: '/api/auth/login',
    body: { email: 'drh@sahelservices.sn', password: 'demo2026' }
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.role, 'drh');
  const cookie = login.setCookie.split(';')[0];
  assert.ok(cookie.startsWith('chronorh_session='));

  // 2. Requête authentifiée sur l'instance B (base SQLite distincte en /tmp)
  const meOnB = await requestHandler(appB, {
    method: 'GET',
    url: '/api/auth/me',
    cookie
  });
  assert.equal(meOnB.status, 200, 'La session signée doit être reconnue par une nouvelle instance');
  assert.equal(meOnB.json.user.email, 'drh@sahelservices.sn');

  // 3. Les jetons QR de démo sont déterministes d'une instance à l'autre
  const empA = instA.db.prepare("SELECT qr_token, fingerprint_id FROM employees WHERE matricule = 'EMP-001'").get();
  const empB = instB.db.prepare("SELECT qr_token, fingerprint_id FROM employees WHERE matricule = 'EMP-001'").get();
  assert.equal(empA.qr_token, empB.qr_token);
  assert.equal(empA.fingerprint_id, empB.fingerprint_id);
});
