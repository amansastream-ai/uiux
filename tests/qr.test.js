'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');

const PAYLOAD = 'CHRONORH|QR-A1B2C3D4E5F6';
const OPTS = {
  type: 'png', width: 640, margin: 2, errorCorrectionLevel: 'Q',
  color: { dark: '#0B1F33', light: '#FFFFFF' }
};

function decode(buf) {
  const png = PNG.sync.read(buf);
  return jsQR(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: 'attemptBoth' });
}

test('le badge PNG généré est réellement scannable (décode vers le bon jeton)', async () => {
  const buf = await QRCode.toBuffer(PAYLOAD, OPTS);
  const code = decode(buf);
  assert.ok(code, 'le QR doit être détectable');
  assert.equal(code.data, PAYLOAD);
});

test('un badge partiellement abîmé reste lisible (correction d’erreur Q)', async () => {
  const buf = await QRCode.toBuffer(PAYLOAD, OPTS);
  const png = PNG.sync.read(buf);
  // On efface le centre (zone du logo) : la correction Q doit permettre la lecture
  const w = Math.floor(png.width * 0.22);
  const x0 = Math.floor((png.width - w) / 2);
  const y0 = Math.floor((png.height - w) / 2);
  for (let y = y0; y < y0 + w; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
    }
  }
  const code = decode(PNG.sync.write(png));
  assert.ok(code, 'QR avec centre masqué doit rester lisible');
  assert.equal(code.data, PAYLOAD);
});

test('le jeton du badge correspond au format de la borne (CHRONORH|QR-…)', async () => {
  const buf = await QRCode.toBuffer(PAYLOAD, OPTS);
  const code = decode(buf);
  const match = code.data.match(/QR-[A-Za-z0-9]+/);
  assert.ok(match, 'la borne doit pouvoir extraire le jeton');
  assert.equal(match[0], 'QR-A1B2C3D4E5F6');
});
