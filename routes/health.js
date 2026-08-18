// routes/health.js — Santé / infra (Lot 0). Monté à la racine (pas sous /api).
const express = require('express');
const db = require('../db');
const { IS_PROD } = require('../config');

const router = express.Router();
const START_TIME = Date.now();

// Sonde publique et légère : uptime monitors, load balancer, etc. Ne touche pas la base.
router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'cuistot', timestamp: new Date().toISOString() });
});

// Sonde "readiness" : vérifie réellement la connectivité DB (et médias, une fois le
// stockage externe branché au Lot 2). Réservée en interne via une clé partagée pour ne
// pas exposer de détails d'infra publiquement ; en dev, accessible sans clé pour tester vite.
router.get('/health/ready', (req, res) => {
  if (IS_PROD) {
    const key = req.headers['x-health-key'];
    if (!process.env.HEALTH_CHECK_KEY || key !== process.env.HEALTH_CHECK_KEY) {
      return res.status(404).json({ error: 'Not found' });
    }
  }
  const checks = { database: 'unknown', media: 'local (base64 en base — migration prévue au Lot 2)' };
  try {
    db.prepare('SELECT 1').get();
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }
  const ok = checks.database === 'ok';
  res.status(ok ? 200 : 503).json({ ok, uptime_s: Math.round((Date.now() - START_TIME) / 1000), checks });
});

module.exports = router;
