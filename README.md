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
npm run check            # vérif syntaxe (node --check) sur tous les fichiers serveur
npm run lint             # ESLint (variables non définies, code mort...)
npm run format:check     # Prettier en mode vérification (rien n'est réécrit)
npm run format           # Prettier en mode écriture (reformate les fichiers sur place)
npm run verify           # enchaîne check + lint + format:check + test — à lancer avant tout déploiement
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

## Fonctionnalités produit (Lot 8)

- **Macros & coût par portion** : calories, protéines/glucides/lipides/fibres, coût (€) —
  tous optionnels, saisis à la création/édition, affichés sur la page détail s'ils sont
  renseignés. Ce sont des valeurs **par portion**, elles ne changent pas quand on ajuste le
  nombre de portions préparées (une portion reste une portion).
- **Ingrédients structurés** : chaque ingrédient est `{ qty, unit, label }` (ex. 200 g de
  farine) au lieu d'une ligne de texte libre. Les recettes créées avant ce lot gardent leurs
  ingrédients en texte libre (affichés tels quels, non ajustables) — les deux formats
  cohabitent dans une même recette sans problème.
- **Portions ajustables** : un ajusteur (-/+) sur la page détail recalcule en direct les
  quantités des ingrédients structurés (aucun appel serveur).
- **Liste de courses** : depuis « Mon carnet de recettes », bouton qui agrège les ingrédients
  de toutes les recettes enregistrées en une liste cochable groupée par recette. Purement
  côté client (les ingrédients sont déjà chargés), coché/décoché conservé en `localStorage`.
- **Brouillons** : une recette peut être enregistrée en brouillon (visible par son auteur
  uniquement) puis publiée plus tard. Les points de publication (+25) et la validation des
  défis ne se déclenchent qu'à la publication effective, jamais deux fois pour la même recette.
- **Filtres** : temps de préparation max, difficulté, budget max par portion — sur la page
  Découvrir, en plus de la recherche déjà existante (qui continue de fonctionner sur le
  nouveau format d'ingrédients sans changement).
- **Non fait dans ce lot** (comme convenu) : collections nommées (au-delà du carnet de
  favoris existant), import de recette depuis une URL, filtre dédié régime/allergènes
  (couvert pour l'instant par les tags libres type "végétarien").

## Qualité & CI (Lot 10)

- **ESLint** (`eslint.config.js`, format flat config ESLint 9+) : règles cœur uniquement (pas
  de plugin externe), centrées sur les vraies fautes — variable non définie, redéclaration,
  code mort — plutôt que sur le style, qui est du ressort de Prettier. Trois profils de
  globals séparés : fichiers serveur (Node/CommonJS), `app.js` (navigateur), `sw.js` (service
  worker).
- **Prettier** (`.prettierrc.json`) : guillemets simples, point-virgules, indentation 2
  espaces, largeur de ligne 100 — réglages choisis pour coller au style déjà utilisé dans le
  code existant et minimiser le diff si `npm run format` est lancé un jour.
- **EditorConfig** (`.editorconfig`) : indentation/fin de ligne/encodage cohérents entre
  éditeurs, indépendamment d'ESLint/Prettier.
- **GitHub Actions** (`.github/workflows/ci.yml`) : à chaque push/PR sur `main`, installe les
  dépendances puis enchaîne lint → format:check → vérif syntaxe → tests. Aucun compte externe
  requis (tourne sur le repo GitHub existant).
- **Dependabot** (`.github/dependabot.yml`) : ouvre automatiquement des PR hebdomadaires pour
  les mises à jour de dépendances npm et d'actions GitHub.
- **Tests étendus** (`test/api.test.js`) : abonnement/désabonnement (points + notification),
  lecture des notifications, validation automatique d'un défi à la publication (une seule
  fois même en republiant sur le même tag), boutique de récompenses (points insuffisants,
  échange réussi, stock épuisé refusé ensuite), limite de débit réellement déclenchée
  (création de recette), déconnexion (session locale redevient anonyme).
- **Non fait dans ce lot** : Playwright/tests end-to-end navigateur (nécessite un environnement
  Node + navigateurs installés pour s'exécuter, indisponible ici — les tests d'intégration
  `node:test` couvrent déjà l'essentiel du parcours API), environnement de *staging* dédié
  (nécessiterait un second service Render).
- **Point d'attention pour le premier passage en CI** : aucun de ces outils n'a pu être
  exécuté dans cet environnement (pas de Node.js disponible ici). Il est possible que
  `npm run lint` ou `npm run format:check` remontent des signalements sur du code jamais
  passé à travers ces outils. C'est normal et attendu à l'adoption — corrige au fil de l'eau,
  ou lance `npm run format` une fois pour tout reformater d'un coup (à committer séparément
  pour garder un historique lisible).

## Architecture (Lot 5)

`server.js` faisait ~1000 lignes (toutes les routes, tous les schémas, toute la logique
métier dans un seul fichier). Découpage par responsabilité, sans changer aucun comportement :

```
config.js         lecture de l'environnement (JWT_SECRET, IS_PROD, PORT, COOKIE_OPTS) — une fois
bootstrap.js       seed initial + promotion admin, exécutés une fois au démarrage
middleware/
  errors.js         apiError, validate() (Zod), idParam
  csrf.js           ensureCsrfCookie, csrfProtect
  rateLimit.js       fabrique de limiteur + les 6 limiteurs utilisés par les routes
  auth.js           sign(), auth(), requireAdmin
  security.js        Helmet/CSP, Permissions-Policy
  staticGuard.js      ne jamais exposer server.js/db.js/.env/*.db
services/
  recipes.js         shapeRecipe, decorateRecipe(s), sanitizeDishIcon/Photo, awardPublishRecipe
  users.js           publicUser, sanitizeAvatar/Color, listes d'icônes/couleurs d'avatar
  notifications.js    notify()
  email.js           sendPasswordResetEmail (journalisée, voir Lot 3)
schemas/            un fichier par domaine (auth, recipes, moderation) — validation Zod
routes/             un routeur Express par domaine (health, auth, recipes, social,
                    moderation, rewards, challenges, misc) — monté dans server.js
server.js           composition root : assemble middlewares globaux + routers, ~70 lignes
```

**Pas de couche "repository"** séparée au-dessus de `db.js` (au-delà de ce que le brief
appelle repositories) : better-sqlite3 est déjà une API synchrone simple (prepared
statements), directement lisible dans chaque route/service. Ajouter une abstraction
supplémentaire aurait multiplié le risque de bug dans cet environnement où rien ne peut être
exécuté pour vérifier, sans bénéfice clair vu la taille du projet.

**Vérification faite pour cette refonte** (à défaut de pouvoir exécuter quoi que ce soit) :
inventaire complet des 35 routes de l'ancien `server.js` comparé une à une aux routeurs
déplacés (aucune route oubliée, aucun chemin changé), relecture de chaque `require()` pour
vérifier que les chemins relatifs et les exports correspondent, et vérification que l'ordre
d'enregistrement des middlewares globaux (CSP, CSRF, garde-fou fichiers statiques,
`express.static`) est resté strictement identique à l'original — cet ordre est significatif
en Express (traité dans l'ordre d'enregistrement) et une inversion aurait pu ouvrir une faille
silencieusement. Les tests existants (`test/api.test.js`, `test/gamification.test.js`) ne
requièrent que `../server` et `../db`, tous deux inchangés dans leur contrat public — aucune
modification de test nécessaire pour cette refonte.

## Design / UX produit (Lot 6)

- **Création guidée en étapes** : la page « Nouvelle recette » est maintenant un parcours en
  4 étapes (L'essentiel → Ingrédients → Préparation → Nutrition/coût), avec indicateur de
  progression et navigation Précédent/Suivant, au lieu d'un unique long formulaire. La
  **modification** d'une recette existante garde le formulaire complet sur une seule page
  (pas de parcours pas-à-pas pour une correction rapide). Implémentation à risque volontairement
  limité : les champs, leurs `name`, et toute la logique de collecte/soumission restent
  strictement identiques entre les deux modes — seul l'attribut `hidden` change sur les blocs
  d'étape, ce qui ne retire rien de `FormData`.
- **Onboarding léger** : 4 écrans montrés une seule fois, immédiatement après l'inscription
  (jamais à la reconnexion, donc pas besoin de drapeau `localStorage`), avec un bouton
  « Passer » toujours visible. Présente le parcours de création guidée, la découverte/le
  filtrage, et le système de points.
- **Page recette** : icônes ajoutées aux titres des sections (Ingrédients, Préparation,
  Nutrition, Conservation) pour la cohérence visuelle avec la section Commentaires qui les
  avait déjà.
- **Non fait dans ce lot** : refonte plus large du design system (tokens de couleur/typo déjà
  posés dès le début du projet, pas de dette majeure identifiée), tutoriel interactif avec
  overlays pointant des éléments réels de l'interface (plus complexe, risque plus élevé sans
  pouvoir tester dans un navigateur ici).

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
- [x] **Lot 8 — Fonctionnalités produit** : macros/coût, ingrédients structurés, portions
  ajustables, liste de courses, brouillons, filtres. Reste : collections nommées.
- [x] **Lot 9 — Gamification saine** : voir détail ci-dessus.
- [x] **Lot 10 — Qualité/CI** : ESLint, Prettier, EditorConfig, GitHub Actions, Dependabot,
  tests étendus (voir détail ci-dessus). Reste : Playwright/E2E, staging dédié.
- [x] **Lot 5 — Refonte architecture** : `server.js` découpé en `config/middleware/services/
  schemas/routes` (voir détail ci-dessus), aucun changement de comportement.
- [x] **Lot 6 — Design/UX produit** : voir détail ci-dessous.
- [ ] **Lots 7, 11** : PWA hors-ligne, SEO/analytics.

Chaque lot suivant sera livré avec son code, sa migration, ses tests et une note de
déploiement dédiée — voir le brief pour le détail complet de chaque lot.
