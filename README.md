# Cuistot — le réseau social des gourmands

App Node.js / Express / SQLite (front-end vanilla JS, sans build step). Ce README suit le
brief technique de mise en production, livré lot par lot.

## Démarrage local

```bash
npm install
cp .env.example .env   # renseigne au moins JWT_SECRET pour du dev sérieux
npm start               # http://localhost:3000
```

## Tests

```bash
npm test                # tests d'intégration (node:test), base SQLite en mémoire
npm run verify           # vérif syntaxe (node --check) + tests, à lancer avant tout déploiement
```

## Variables d'environnement

Voir [`.env.example`](./.env.example) pour la liste complète et le rôle de chaque variable.
Résumé de ce qui est **actif aujourd'hui** vs **réservé pour un lot à venir** :

| Variable | Statut |
|---|---|
| `NODE_ENV`, `PORT`, `JWT_SECRET` | Actif |
| `DB_PATH` | Actif (SQLite) |
| `HEALTH_CHECK_KEY` | Actif (protège `/health/ready`) |
| `DATABASE_URL` | Réservée — Lot 1 (migration PostgreSQL), pas encore lue par le code |
| `RESEND_API_KEY`, `EMAIL_*` | Réservées — Lot 3 (email réel). En attendant, le lien de reset de mot de passe est journalisé côté serveur (`console.log`), jamais envoyé par email |
| `CLOUDINARY_*`, `MEDIA_PROVIDER` | Réservées — Lot 2 (upload photos externe). En attendant, les photos restent en base64 dans SQLite |
| `SENTRY_DSN` | Réservée — Lot 5 |
| `REDIS_URL` | Réservée — Lot 4 (rate limiting distribué). En attendant, le rate limiting est en mémoire process (ne tient pas la route avec plusieurs instances) |

**Règle du projet : aucun secret n'est commité.** `.env` est ignoré par git ; seul
`.env.example` (sans valeurs) est versionné.

## Santé du service

- `GET /health` — sonde publique légère (uptime monitors), ne touche pas la base.
- `GET /health/ready` — vérifie la connectivité base de données (et médias, une fois le
  Lot 2 fait). Publique en dev, protégée en production par le header `X-Health-Key` (valeur
  = `HEALTH_CHECK_KEY`) pour ne pas exposer de détails d'infra.

## Déploiement (Render)

Deux façons de déployer :

- **Blueprint** (recommandé) : "New +" → "Blueprint", pointe sur ce repo. Render lit
  `render.yaml` et génère automatiquement `JWT_SECRET` et `HEALTH_CHECK_KEY`.
- **Manuel** : "New +" → "Web Service". Build = `npm install`, Start = `npm start`, puis
  ajoute toi-même les variables d'environnement dans l'onglet *Environment* (au minimum
  `JWT_SECRET`, sinon le serveur refuse de démarrer en production).

`buildCommand` utilise `npm install` (pas `npm ci`) car il n'y a pas de `package-lock.json`
commité pour l'instant (pas de Node.js disponible en local pour le générer). Si ce fichier
est généré et commité un jour, repasser `render.yaml` sur `npm ci` est recommandé (build plus
rapide et strictement reproductible).

Avant tout déploiement, si tu as un environnement Node quelque part : `npm run verify` doit
passer (syntaxe + tests). Sinon, teste directement sur Render après déploiement.

## Sécurité applicative (Lot 4)

- **En-têtes** : Helmet (CSP, nosniff, HSTS...) + `Permissions-Policy` restrictive. CSP sans
  script inline (`script-src 'self'` uniquement — les `onclick=""` et `onerror=""` du HTML
  généré ont été remplacés par de vrais écouteurs JS pour que ça tienne). Les styles inline
  (`style=""`, très utilisés dans l'app actuelle) restent autorisés via `'unsafe-inline'` sur
  `style-src` seulement — les basculer en classes CSS est un chantier du Lot 6 (design
  system), pas de ce lot-ci.
- **CSRF** : protection "double submit cookie" sur toutes les routes `/api` en écriture
  (POST/PUT/PATCH/DELETE). Le cookie `csrf_token` (non httpOnly) est posé automatiquement dès
  la première visite ; le front le renvoie dans le header `X-CSRF-Token` sur chaque requête.
- **Validation** : toutes les routes qui acceptent un corps de requête sont validées par un
  schéma Zod (`validate()` middleware). Les erreurs suivent la forme `{ error, code, fields }`
  partout dans l'API. Les `:id` d'URL sont vérifiés (entier positif) avant de toucher la base.
- **Mot de passe** : longueur minimale relevée à 10 caractères (repris du Lot 3, appliqué dès
  maintenant puisque c'est de la validation).
- **Anti-abus** : limites dédiées pour la création de recette, les commentaires et les likes
  (en plus de inscription/connexion/reset déjà en place), par utilisateur plutôt que par IP
  quand c'est pertinent.
- **Non fait dans ce lot** : CAPTCHA (nécessite un compte hCaptcha/Turnstile externe),
  détection de réseaux d'échange de likes (nécessite de vraies données d'usage), Redis pour le
  rate limiting (nécessite une instance Redis/Upstash — voir `REDIS_URL`).

## Modération & confidentialité (reste du Lot 4)

- **Admin** : promu via la variable d'env `ADMIN_EMAIL` (voir `.env.example`), aucun compte
  externe requis. Accès au panel de modération depuis le profil (bouton visible uniquement
  pour un compte admin).
- **Signalement** : recette, commentaire ou profil — bouton « Signaler » présent à chaque
  endroit concerné. Stocké dans `reports`, statut `open` → `resolved`/`dismissed`.
- **Blocage** : depuis le profil d'un autre utilisateur. Coupe les abonnements dans les deux
  sens et masque le contenu du bloqué dans le fil/recherche du bloqueur.
- **Panel admin minimal** : liste des signalements ouverts avec un aperçu du contenu ciblé,
  trois actions (masquer le contenu / suspendre le compte / rejeter le signalement), journal
  d'audit dans `admin_actions` (pas encore d'interface dédiée pour le consulter).
- **Compte suspendu** : connexion refusée (403), contenu masqué du fil/classement public.
- **Suppression de compte** : confirmation par mot de passe, suppression définitive (cascade
  via les contraintes `ON DELETE CASCADE` déjà en place sur toutes les tables liées).
- **Export de données** : JSON téléchargeable (profil, recettes, commentaires, likes donnés,
  abonnements, historique de points) depuis « Confidentialité de mon compte ».
- **Pages légales** : confidentialité, CGU, règles communautaires, cookies — contenu de
  départ rédigé, **à faire valider par un juriste avant tout lancement public** (ce n'est pas
  un conseil juridique). Accessibles depuis la modale de confidentialité du profil.

## Gamification saine (Lot 9)

- Liker ne rapporte plus de points (`POINTS.GIVE_LIKE = 0`) — évite le farming like/unlike.
- Plafond quotidien sur les points gagnés en recevant des likes (100 pts/j) et en commentant
  (30 pts/j), calculé à la volée depuis l'historique `point_events` — l'action elle-même
  n'est jamais bloquée, seul l'octroi de points au-delà du plafond est ignoré.
- Un commentaire de moins de 8 caractères est publié normalement mais ne rapporte pas de
  points (anti farming "ok"/"nice").
- Bonus de connexion quotidien souple (pas de pénalité si la série casse).
- Le solde de points ne descend jamais sous 0 (`award()` plafonne au niveau base de données).

## Statut des lots (brief de mise en production)

- [x] **Lot 0 — Débloquer le déploiement** : `JWT_SECRET` obligatoire en prod, écoute sur
  `process.env.PORT`, `/health` + `/health/ready`, `npm ci` dans `render.yaml`,
  `.env.example`, script `verify`.
- [ ] **Lot 1 — PostgreSQL + migrations versionnées** (reporté à la fin du projet, décision
  produit) : nécessite une base Postgres provisionnée (Render Postgres / Supabase / Neon) et
  son `DATABASE_URL`.
- [ ] **Lot 2 — Upload médias externe** : nécessite un compte Cloudinary (ou équivalent) et
  ses clés API.
- [ ] **Lot 3 — Email réel + sessions invalidables** : nécessite un compte Resend (ou
  équivalent) et sa clé API. (Le relèvement du mot de passe à 10 caractères, prévu dans ce
  lot, a été fait en avance avec la validation Zod du Lot 4.)
- [x] **Lot 4 — Sécurité applicative + modération/confidentialité** : Helmet/CSP, CSRF,
  validation Zod, anti-abus étendu, signalement/blocage/admin/suppression de
  compte/export/pages légales. Restent : CAPTCHA, Redis (voir détail ci-dessus).
- [x] **Lot 9 — Gamification saine** : voir détail ci-dessus.
- [ ] **Lots 5, 6, 7, 8, 10, 11** : refactor routes/services/repositories, design system,
  PWA hors-ligne, fonctionnalités produit (macros, coût, liste de courses...), CI/tooling
  qualité (ESLint/Prettier/GitHub Actions/Playwright), SEO/analytics.

Chaque lot suivant sera livré avec son code, sa migration, ses tests et une note de
déploiement dédiée — voir le brief pour le détail complet de chaque lot.
