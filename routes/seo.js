// routes/seo.js — méta-tags dynamiques par recette (aperçu de partage), sitemap, robots.txt.
// Monté à la racine (pas sous /api), comme routes/health.js.
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const router = express.Router();

const TEMPLATE_PATH = path.join(__dirname, '..', 'index.html');
const DEFAULT_TITLE = 'Cuistot — le réseau des gourmands';
const DEFAULT_DESC = 'Partage tes recettes, découvre celles de la communauté, gagne des points en cuisinant.';

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const TITLE_CONTENT_RE = new RegExp(`content="${escRegex(DEFAULT_TITLE)}"`, 'g');
const DESC_CONTENT_RE = new RegExp(`content="${escRegex(DEFAULT_DESC)}"`, 'g');

// Injecte <title> + description/OG/Twitter spécifiques à une recette dans le gabarit HTML de
// la SPA, pour que les aperçus de partage (WhatsApp, réseaux sociaux, moteurs de recherche...)
// affichent le vrai titre/la vraie image de la recette plutôt que le texte générique. Le reste
// de la page (script app.js, structure) est identique à toute autre page : une fois chargée,
// la SPA prend le relais normalement et affiche la recette via son routeur habituel.
router.get('/recette/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next();
  const r = db.prepare('SELECT title, description, photo, is_hidden, status FROM recipes WHERE id=?').get(id);
  if (!r || r.is_hidden || r.status !== 'published') return next(); // laisse la SPA gérer le 404 côté client
  let html;
  try { html = fs.readFileSync(TEMPLATE_PATH, 'utf8'); } catch { return next(); }
  const title = `${r.title} — Cuistot`;
  const desc = (r.description || DEFAULT_DESC).slice(0, 200) || DEFAULT_DESC;
  // Une photo uploadée par un utilisateur est stockée en data URI (base64) — inutilisable comme
  // og:image, les robots de partage (WhatsApp, réseaux sociaux) ont besoin d'une vraie URL
  // qu'ils peuvent aller chercher eux-mêmes. Seules les photos de démo (URLs http(s)) marchent
  // ici ; le jour où le Lot 2 (upload externe) sera fait, toutes les photos auront une vraie URL.
  const image = r.photo && !r.photo.startsWith('data:') ? r.photo : '/icon.svg';
  html = html
    .replace(`<title>${DEFAULT_TITLE}</title>`, `<title>${escHtml(title)}</title>`)
    .replace(TITLE_CONTENT_RE, `content="${escHtml(title)}"`)
    .replace(DESC_CONTENT_RE, `content="${escHtml(desc)}"`)
    .replace('content="/icon.svg"', `content="${escHtml(image)}"`);
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

// Sitemap minimal : uniquement les recettes publiées et visibles. Le reste de l'app (fil,
// création, profils...) est derrière un compte et n'a pas vocation à être indexé.
router.get('/sitemap.xml', (req, res) => {
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const rows = db.prepare("SELECT id, created_at FROM recipes WHERE is_hidden=0 AND status='published' ORDER BY created_at DESC LIMIT 5000").all();
  const urls = [
    `<url><loc>${base}/</loc><changefreq>daily</changefreq></url>`,
    ...rows.map((r) => `<url><loc>${base}/recette/${r.id}</loc><lastmod>${r.created_at.slice(0, 10)}</lastmod></url>`),
  ].join('\n');
  res.set('Content-Type', 'application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
});

router.get('/robots.txt', (req, res) => {
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`);
});

module.exports = router;
