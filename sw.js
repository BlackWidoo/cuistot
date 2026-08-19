// Service worker minimal — met en cache la coquille de l'app pour un lancement rapide
// et un accès hors-ligne basique. Les appels API passent toujours par le réseau.
// IMPORTANT : incrémenter CACHE à CHAQUE déploiement qui change les en-têtes de réponse
// (CSP dans middleware/security.js notamment), même si sw.js/SHELL lui-même ne change pas —
// sinon la coquille mise en cache (avec ses en-têtes d'origine) continue d'être servie sans
// jamais repasser par le réseau, et le changement reste invisible pour les clients existants
// (vécu deux fois : v20 pour blob:, oublié pour upload.wikimedia.org — d'où v21).
const CACHE = 'cuistot-v21';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (e) => {
  // Pas de self.skipWaiting() automatique ici (Lot 7) : une nouvelle version installée reste
  // "en attente" jusqu'à ce que l'utilisateur confirme via la bannière de mise à jour (voir
  // app.js), qui envoie le message SKIP_WAITING ci-dessous. C'est la cause du bug déjà vécu en
  // prod (jeton CSRF "invalide") : l'ancien service worker continuait de servir un app.js
  // périmé sans jamais prévenir personne. Rendre la mise à jour explicite règle ça à la racine.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // On ne met jamais en cache l'API : toujours des données fraîches
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(
      (cached) =>
        cached ||
        fetch(e.request)
          .then((res) => {
            const copy = res.clone();
            caches
              .open(CACHE)
              .then((c) => c.put(e.request, copy))
              .catch(() => {});
            return res;
          })
          .catch(() => caches.match('/index.html'))
    )
  );
});
