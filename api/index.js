'use strict';
/**
 * ChronoRH — Point d'entrée Serverless Function pour Vercel.
 * Délègue toutes les requêtes API (/api/*) et le repli SPA à l'application Express.
 */
const app = require('../server/index');

const API_SEGMENTS = new Set([
  'health',
  'auth',
  'dashboard',
  'employees',
  'departments',
  'attendance',
  'kiosk',
  'holidays',
  'rules',
  'settings',
  'users',
  'audit',
  'payroll',
  'reports',
  'export'
]);

module.exports = (req, res) => {
  if (req.url && !req.url.startsWith('/api')) {
    const firstSeg = req.url.split('?')[0].replace(/^\/+/, '').split('/')[0];
    if (API_SEGMENTS.has(firstSeg)) {
      req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }
  }
  return app(req, res);
};
