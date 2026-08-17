# 📱 Mettre Cuistot en ligne depuis un iPhone (sans ordinateur)

Le but : obtenir un lien public `https://cuistot-xxxx.onrender.com` que tu ouvres
depuis Safari, partout. Tout se fait dans le navigateur de ton iPhone. Compte ~15 min
la première fois. **Tout est gratuit.**

Il y a deux comptes gratuits à créer : **GitHub** (pour héberger le code) et
**Render** (pour faire tourner l'appli). C'est le trajet classique et le plus fiable.

---

## Étape 1 — Décompresser le dossier sur ton iPhone

1. Dans cette conversation, télécharge le fichier **cuistot-deploy.zip**.
2. Ouvre l'app **Fichiers** → va dans **Téléchargements**.
3. Touche le zip : il se décompresse en un dossier **cuistot-deploy** contenant
   une douzaine de fichiers (server.js, app.js, index.html, etc.). Garde-le sous la main.

> Astuce : cette version est « à plat » exprès — aucun sous-dossier à recréer,
> ce qui rend l'envoi sur GitHub beaucoup plus simple depuis un téléphone.

---

## Étape 2 — Créer un compte GitHub et déposer le code

1. Dans Safari, va sur **github.com** → **Sign up**. Crée un compte gratuit.
2. Une fois connecté, touche le **+** (en haut à droite) → **New repository**.
   - Repository name : `cuistot`
   - Coche **Public**
   - Touche **Create repository**.
3. Sur la page du dépôt vide, touche le lien **« uploading an existing file »**
   (ou bouton **Add file → Upload files**).
4. Touche **choose your files** → **Parcourir** → va dans **Fichiers →
   Téléchargements → cuistot-deploy**, et **sélectionne TOUS les fichiers**
   du dossier (index.html, app.js, styles.css, server.js, db.js, seed-core.js,
   gamification.js, sw.js, manifest.json, icon.svg, package.json, render.yaml).
5. En bas, touche **Commit changes**. Les fichiers apparaissent dans ton dépôt. ✅

> Si Safari n'affiche pas bien le bouton d'upload, touche « aA » dans la barre
> d'adresse → **Afficher la version pour ordinateur**.

---

## Étape 3 — Déployer sur Render

1. Dans Safari, va sur **render.com** → **Get Started** → **Sign in with GitHub**
   (le plus simple : ça relie les deux comptes). Autorise Render.
2. Tableau de bord Render → **New +** → **Web Service**.
3. Choisis ton dépôt **cuistot** dans la liste (autorise l'accès si demandé).
4. Render détecte Node automatiquement. Vérifie / renseigne :
   - **Name** : `cuistot` (ça donnera l'adresse `cuistot.onrender.com`, ou un suffixe si pris)
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : **Free**
5. (Recommandé) Section **Environment** → **Add Environment Variable** :
   - Key : `JWT_SECRET` — Value : une longue suite de caractères au hasard
     (par ex. tape n'importe quoi de long et unique). Ça sécurise les connexions.
6. Touche **Create Web Service**. Render installe et démarre l'appli
   (2–4 min la première fois — tu vois les logs défiler).
7. Quand c'est prêt, ton lien s'affiche en haut :
   **https://cuistot-xxxx.onrender.com**. Touche-le : Cuistot s'ouvre ! 🎉

---

## Étape 4 — L'ajouter à l'écran d'accueil (comme une vraie appli)

1. Ouvre ton lien Render dans **Safari**.
2. Touche le bouton **Partager** (le carré avec la flèche).
3. **Sur l'écran d'accueil** → **Ajouter**.
4. L'icône 🍳 Cuistot apparaît sur ton iPhone et s'ouvre en plein écran.

Connecte-toi avec **demo@cuistot.fr** / **demo123**, ou crée ton compte.

---

## Bon à savoir (offre gratuite Render)

- **Mise en veille** : après ~15 min sans visite, le service gratuit s'endort.
  La visite suivante le réveille — le **premier chargement peut prendre ~30–50 s**,
  puis tout est rapide. C'est normal sur le plan gratuit.
- **Données** : sur l'offre gratuite, le stockage peut être remis à zéro lors
  d'un redémarrage. Si ça arrive, la base de démo (recettes, comptes, défis) se
  **recrée automatiquement** — tu ne te retrouves jamais avec une appli vide.
  (Pour des données 100 % permanentes, il faudrait une base externe ou un disque
  payant : je peux te préparer ça si tu veux aller plus loin.)
- **Mettre à jour l'appli** : il suffit de remplacer un fichier dans le dépôt
  GitHub (Add file → Upload files) ; Render redéploie tout seul.

---

## Encore plus simple si tu peux emprunter un ordinateur 5 minutes

Sur n'importe quel Mac/PC avec Node installé, dans le dossier :
`npm install` puis `npm start`, et c'est en ligne localement. Pour un lien public
en une commande, des outils comme le CLI de Render ou `npx localtunnel` font l'affaire.
Dis-le-moi et je te donne la marche à suivre exacte.
