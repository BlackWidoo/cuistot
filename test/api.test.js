// Tests d'intégration : démarre l'app Express sur un port éphémère contre une base PostgreSQL
// jetable (fournie par CI — voir .github/workflows/ci.yml — ou une instance locale), et tape
// dedans avec fetch.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cuistot_test';
process.env.JWT_SECRET = 'test-secret-not-for-prod';
process.env.NODE_ENV = 'test'; // ni 'production' (pas de check JWT_SECRET) : devToken renvoyé par /forgot-password
// Le bootstrap admin promeut ce compte au démarrage — c'est un compte du seed de démo
// (seed-core.js), donc il existe déjà en base au moment où le bootstrap s'exécute.
process.env.ADMIN_EMAIL = 'demo@cuistot.fr';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');
const db = require('../db');

let server, base;

test.before(
  () =>
    new Promise((resolve) => {
      app.ready.then(() => {
        server = app.listen(0, () => {
          base = `http://127.0.0.1:${server.address().port}`;
          resolve();
        });
      });
    })
);

test.after(
  () =>
    new Promise((resolve) => {
      server.close(() => db.pool.end().then(resolve));
    })
);

// Mini "session" HTTP : garde les cookies (dont le jeton anti-CSRF) d'un appel à l'autre,
// comme le ferait un vrai navigateur, et le renvoie dans le header attendu par le serveur
// — reproduit ce que fait app.js.
function makeSession() {
  const jar = new Map();
  async function raw(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (jar.has('csrf_token')) headers['x-csrf-token'] = jar.get('csrf_token');
    const res = await fetch(base + '/api' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const setCookie of res.headers.getSetCookie()) {
      const pair = setCookie.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > -1) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  async function call(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    if (method !== 'GET' && !jar.has('csrf_token')) {
      // Dans un vrai navigateur, le tout premier chargement de page pose déjà le cookie CSRF
      // avant que l'utilisateur ne soumette quoi que ce soit (voir ensureCsrfCookie côté
      // serveur, appliqué à toutes les requêtes). On reproduit ça avec un GET anodin.
      await raw('/categories');
    }
    return raw(path, opts);
  }
  return { call };
}

test('GET /health répond ok sans authentification', async () => {
  const res = await fetch(base + '/health');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.service, 'cuistot');
  assert.ok(data.timestamp);
});

test('GET /health/ready confirme la connectivité DB (hors production, sans clé)', async () => {
  // NODE_ENV='test' dans ce fichier : la clé HEALTH_CHECK_KEY n'est exigée qu'en production.
  const res = await fetch(base + '/health/ready');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.checks.database, 'ok');
});

test("une requête d'écriture sans jeton CSRF est refusée", async () => {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }, // pas de X-CSRF-Token
    body: JSON.stringify({ email: 'x@test.fr', password: 'whatever123' }),
  });
  const data = await res.json();
  assert.equal(res.status, 403);
  assert.equal(data.code, 'CSRF_INVALID');
});

test('inscription (mdp < 10 caractères refusé), doublon refusé, mauvais mot de passe refusé, connexion ok', async () => {
  const s = makeSession();
  const email = `alice_${Date.now()}@test.fr`;

  const tooShort = await s.call('/register', {
    method: 'POST',
    body: { username: 'alice_test', email, password: 'short1' },
  });
  assert.equal(tooShort.status, 400);
  assert.equal(tooShort.data.code, 'VALIDATION_ERROR');
  assert.ok(tooShort.data.fields.password);

  const reg = await s.call('/register', {
    method: 'POST',
    body: { username: 'alice_test', email, password: 'secret12345' },
  });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.user.username, 'alice_test');

  const dup = await s.call('/register', {
    method: 'POST',
    body: { username: 'alice_test2', email, password: 'secret12345' },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.code, 'CONFLICT');

  const badLogin = await s.call('/login', {
    method: 'POST',
    body: { email, password: 'wrongpassword' },
  });
  assert.equal(badLogin.status, 401);

  const login = await s.call('/login', {
    method: 'POST',
    body: { email, password: 'secret12345' },
  });
  assert.equal(login.status, 200);
});

test('création de recette : le champ image est filtré (corrige une ancienne faille XSS), rate limit like', async () => {
  const s = makeSession();
  const email = `bob_${Date.now()}@test.fr`;
  await s.call('/register', {
    method: 'POST',
    body: { username: 'bob_test', email, password: 'secret12345' },
  });

  const created = await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Tarte', image: '<img src=x onerror=alert(1)>', tags: [] },
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.recipe.image, 'plate'); // valeur inconnue -> repli sur le défaut

  const id = created.data.recipe.id;
  const like1 = await s.call(`/recipes/${id}/like`, { method: 'POST' });
  assert.equal(like1.data.liked, true);
  assert.equal(like1.data.likes, 1);

  const like2 = await s.call(`/recipes/${id}/like`, { method: 'POST' }); // toggle off
  assert.equal(like2.data.liked, false);
  assert.equal(like2.data.likes, 0);
});

test('validation stricte : titre vide et description trop longue refusés', async () => {
  const s = makeSession();
  const email = `gina_${Date.now()}@test.fr`;
  await s.call('/register', {
    method: 'POST',
    body: { username: 'gina_test', email, password: 'secret12345' },
  });

  const noTitle = await s.call('/recipes', { method: 'POST', body: { title: '  ', tags: [] } });
  assert.equal(noTitle.status, 400);
  assert.equal(noTitle.data.code, 'VALIDATION_ERROR');
  assert.ok(noTitle.data.fields.title);

  const tooLong = await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Titre ok', description: 'x'.repeat(2001), tags: [] },
  });
  assert.equal(tooLong.status, 400);
  assert.ok(tooLong.data.fields.description);
});

test("un champ numérique vidé (temps de préparation) retombe sur la valeur par défaut au lieu d'échouer", async () => {
  const s = makeSession();
  const email = `henri_${Date.now()}@test.fr`;
  await s.call('/register', {
    method: 'POST',
    body: { username: 'henri_test', email, password: 'secret12345' },
  });

  const created = await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Soupe', prep_minutes: '', tags: [] },
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.recipe.prep_minutes, 15);
});

test('mot de passe oublié -> réinitialisation -> connexion avec le nouveau mot de passe', async () => {
  const s = makeSession();
  const email = `carol_${Date.now()}@test.fr`;
  await s.call('/register', {
    method: 'POST',
    body: { username: 'carol_test', email, password: 'oldpassword1' },
  });
  await s.call('/logout', { method: 'POST' });

  const forgot = await s.call('/forgot-password', { method: 'POST', body: { email } });
  assert.equal(forgot.status, 200);
  assert.ok(
    forgot.data.devToken,
    'devToken doit être renvoyé hors production, pour pouvoir tester le flux'
  );

  const reset = await s.call('/reset-password', {
    method: 'POST',
    body: { token: forgot.data.devToken, password: 'newpassword1' },
  });
  assert.equal(reset.status, 200);

  const oldLogin = await s.call('/login', {
    method: 'POST',
    body: { email, password: 'oldpassword1' },
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await s.call('/login', {
    method: 'POST',
    body: { email, password: 'newpassword1' },
  });
  assert.equal(newLogin.status, 200);

  // le jeton est à usage unique : une seconde utilisation doit échouer
  const reuse = await s.call('/reset-password', {
    method: 'POST',
    body: { token: forgot.data.devToken, password: 'again12345' },
  });
  assert.equal(reuse.status, 400);
});

test("email inconnu sur /forgot-password : même réponse générique (pas d'énumération de comptes)", async () => {
  const s = makeSession();
  const res = await s.call('/forgot-password', {
    method: 'POST',
    body: { email: `inconnu_${Date.now()}@test.fr` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.devToken, undefined);
});

test('avatar : icône libre acceptée, clé inconnue retombe sur "user", couleur invalide sur "cream"', async () => {
  const s = makeSession();
  const email = `dave_${Date.now()}@test.fr`;
  await s.call('/register', {
    method: 'POST',
    body: { username: 'dave_test', email, password: 'secret12345' },
  });

  const ok = await s.call('/me', { method: 'PATCH', body: { avatar: 'leaf' } });
  assert.equal(ok.data.user.avatar, 'leaf');

  const bad = await s.call('/me', {
    method: 'PATCH',
    body: { avatar: '<script>alert(1)</script>' },
  });
  assert.equal(bad.data.user.avatar, 'user');

  const color = await s.call('/me', { method: 'PATCH', body: { avatar_color: 'teal' } });
  assert.equal(color.data.user.avatar_color, 'teal');

  const badColor = await s.call('/me', { method: 'PATCH', body: { avatar_color: 'neon-pink' } });
  assert.equal(badColor.data.user.avatar_color, 'cream');
});

test("avatar à débloquer : refusé tant que le badge requis n'est pas obtenu", async () => {
  const s = makeSession();
  const email = `frank_${Date.now()}@test.fr`;
  await s.call('/register', {
    method: 'POST',
    body: { username: 'frank_test', email, password: 'secret12345' },
  });

  // 'crown' exige le badge "legend" (3000 pts) : un compte tout neuf ne l'a pas
  const locked = await s.call('/me', { method: 'PATCH', body: { avatar: 'crown' } });
  assert.equal(locked.status, 403);

  const me = await s.call('/me');
  assert.equal(me.data.user.avatar, 'pan'); // inchangé
});

test('pagination du fil de recettes', async () => {
  const s = makeSession();
  const email = `eve_${Date.now()}@test.fr`;
  const reg = await s.call('/register', {
    method: 'POST',
    body: { username: 'eve_test', email, password: 'secret12345' },
  });
  const authorId = reg.data.user.id;

  for (let i = 0; i < 5; i++) {
    await s.call('/recipes', { method: 'POST', body: { title: `Recette ${i}`, tags: [] } });
  }

  const page1 = await s.call(`/recipes?author=${authorId}&limit=2&offset=0`);
  assert.equal(page1.data.recipes.length, 2);
  assert.equal(page1.data.total, 5);
  assert.equal(page1.data.hasMore, true);

  const page3 = await s.call(`/recipes?author=${authorId}&limit=2&offset=4`);
  assert.equal(page3.data.recipes.length, 1);
  assert.equal(page3.data.hasMore, false);
});

test("un utilisateur ne peut ni modifier ni supprimer la recette d'un autre", async () => {
  const owner = makeSession();
  const intruder = makeSession();
  const ownerEmail = `owner_${Date.now()}@test.fr`;
  const intruderEmail = `intruder_${Date.now()}@test.fr`;
  await owner.call('/register', {
    method: 'POST',
    body: { username: 'owner_test', email: ownerEmail, password: 'secret12345' },
  });
  await intruder.call('/register', {
    method: 'POST',
    body: { username: 'intruder_test', email: intruderEmail, password: 'secret12345' },
  });

  const created = await owner.call('/recipes', {
    method: 'POST',
    body: { title: 'Recette privée', tags: [] },
  });
  const id = created.data.recipe.id;

  const putAttempt = await intruder.call(`/recipes/${id}`, {
    method: 'PUT',
    body: { title: 'Piraté', tags: [] },
  });
  assert.equal(putAttempt.status, 403);

  const delAttempt = await intruder.call(`/recipes/${id}`, { method: 'DELETE' });
  assert.equal(delAttempt.status, 403);

  const stillThere = await owner.call(`/recipes/${id}`);
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.data.recipe.title, 'Recette privée');
});

test("un identifiant non numérique dans l'URL est rejeté proprement (pas une erreur 500)", async () => {
  const s = makeSession();
  const res = await s.call('/recipes/not-a-number');
  assert.equal(res.status, 400);
  assert.equal(res.data.code, 'VALIDATION_ERROR');
});

test('un commentaire trop court est publié mais ne rapporte pas de points (Lot 9)', async () => {
  const author = makeSession();
  const commenter = makeSession();
  await author.call('/register', {
    method: 'POST',
    body: {
      username: 'author_test2',
      email: `author2_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const commenterReg = await commenter.call('/register', {
    method: 'POST',
    body: {
      username: 'commenter_test',
      email: `commenter_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const pointsBefore = commenterReg.data.user.points;

  const recipe = await author.call('/recipes', {
    method: 'POST',
    body: { title: 'Recette à commenter', tags: [] },
  });
  const id = recipe.data.recipe.id;

  const shortComment = await commenter.call(`/recipes/${id}/comments`, {
    method: 'POST',
    body: { body: 'ok' },
  });
  assert.equal(shortComment.status, 200); // publié quand même

  const me = await commenter.call('/me');
  assert.equal(me.data.user.points, pointsBefore); // pas de points gagnés
});

test("signalement : créé par un utilisateur, visible et traitable par l'admin, refusé pour un non-admin", async () => {
  const reporter = makeSession();
  const other = makeSession();
  await reporter.call('/register', {
    method: 'POST',
    body: {
      username: 'reporter_test',
      email: `reporter_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  await other.call('/register', {
    method: 'POST',
    body: { username: 'other_test', email: `other_${Date.now()}@test.fr`, password: 'secret12345' },
  });

  const recipe = await other.call('/recipes', {
    method: 'POST',
    body: { title: 'Recette à signaler', tags: [] },
  });
  const recipeId = recipe.data.recipe.id;

  const report = await reporter.call('/reports', {
    method: 'POST',
    body: { target_type: 'recipe', target_id: recipeId, reason: 'Contenu inapproprié' },
  });
  assert.equal(report.status, 200);

  // Un non-admin n'a pas accès au panel de modération
  const forbidden = await reporter.call('/admin/reports');
  assert.equal(forbidden.status, 403);

  // L'admin (compte de seed promu via ADMIN_EMAIL) voit le signalement et peut le résoudre
  const admin = makeSession();
  const login = await admin.call('/login', {
    method: 'POST',
    body: { email: 'demo@cuistot.fr', password: 'demo123' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.is_admin, true);

  const list = await admin.call('/admin/reports');
  assert.equal(list.status, 200);
  const found = list.data.reports.find((r) => r.target_id === recipeId);
  assert.ok(found, 'le signalement doit apparaître dans la liste admin');

  const resolve = await admin.call(`/admin/reports/${found.id}/resolve`, {
    method: 'POST',
    body: { action: 'hide' },
  });
  assert.equal(resolve.status, 200);

  // La recette masquée n'apparaît plus pour un tiers...
  const viewer = makeSession();
  const hiddenView = await viewer.call(`/recipes/${recipeId}`);
  assert.equal(hiddenView.status, 404);
  // ...mais reste visible pour son auteur
  const ownerView = await other.call(`/recipes/${recipeId}`);
  assert.equal(ownerView.status, 200);
});

test("blocage : le contenu de l'utilisateur bloqué disparaît du fil du bloqueur", async () => {
  const blocker = makeSession();
  const blocked = makeSession();
  await blocker.call('/register', {
    method: 'POST',
    body: {
      username: 'blocker_test',
      email: `blocker_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const blockedReg = await blocked.call('/register', {
    method: 'POST',
    body: {
      username: 'blocked_test',
      email: `blocked_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const blockedId = blockedReg.data.user.id;

  await blocked.call('/recipes', {
    method: 'POST',
    body: { title: 'Recette du bloqué', tags: [] },
  });

  const before = await blocker.call(`/recipes?author=${blockedId}`);
  assert.equal(before.data.recipes.length, 1);

  const block = await blocker.call(`/users/${blockedId}/block`, { method: 'POST' });
  assert.equal(block.data.blocked, true);

  const after = await blocker.call(`/recipes?author=${blockedId}`);
  assert.equal(after.data.recipes.length, 0);
});

test('suppression de compte : mot de passe vérifié, compte et contenu supprimés (cascade)', async () => {
  const s = makeSession();
  const email = `delete_${Date.now()}@test.fr`;
  await s.call('/register', {
    method: 'POST',
    body: { username: 'delete_test', email, password: 'secret12345' },
  });
  await s.call('/recipes', { method: 'POST', body: { title: 'Recette à effacer', tags: [] } });

  const badPassword = await s.call('/me', {
    method: 'DELETE',
    body: { password: 'wrongpassword' },
  });
  assert.equal(badPassword.status, 401);

  const del = await s.call('/me', { method: 'DELETE', body: { password: 'secret12345' } });
  assert.equal(del.status, 200);

  const loginAfter = await s.call('/login', {
    method: 'POST',
    body: { email, password: 'secret12345' },
  });
  assert.equal(loginAfter.status, 401);
});

test("export de données : ne contient que le profil et les recettes de l'utilisateur authentifié", async () => {
  const s = makeSession();
  await s.call('/register', {
    method: 'POST',
    body: {
      username: 'export_test',
      email: `export_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  await s.call('/recipes', { method: 'POST', body: { title: 'Ma recette export', tags: [] } });

  const exp = await s.call('/me/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.data.user.username, 'export_test');
  assert.equal(exp.data.recipes.length, 1);
  assert.equal(exp.data.recipes[0].title, 'Ma recette export');
});

// ---------- Lot 8 : fonctionnalités produit ----------

test('un ingrédient structuré et un ingrédient legacy (chaîne) sont tous deux acceptés', async () => {
  const s = makeSession();
  await s.call('/register', {
    method: 'POST',
    body: {
      username: 'ingred_test',
      email: `ingred_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });

  const created = await s.call('/recipes', {
    method: 'POST',
    body: {
      title: 'Salade mixte',
      tags: [],
      ingredients: [{ qty: 200, unit: 'g', label: 'tomates' }, '1 pincée de sel'],
    },
  });
  assert.equal(created.status, 200);
  assert.deepEqual(created.data.recipe.ingredients[0], { qty: 200, unit: 'g', label: 'tomates' });
  assert.equal(created.data.recipe.ingredients[1], '1 pincée de sel');
});

test('brouillon : invisible publiquement, visible par son auteur, pas de points à la création', async () => {
  const author = makeSession();
  const authorReg = await author.call('/register', {
    method: 'POST',
    body: { username: 'draft_test', email: `draft_${Date.now()}@test.fr`, password: 'secret12345' },
  });
  const pointsBefore = authorReg.data.user.points;

  const created = await author.call('/recipes', {
    method: 'POST',
    body: { title: 'Recette en cours', tags: [], status: 'draft' },
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.recipe.status, 'draft');
  const id = created.data.recipe.id;

  const me = await author.call('/me');
  assert.equal(me.data.user.points, pointsBefore); // pas de points pour un brouillon

  const viewer = makeSession();
  const hiddenFromViewer = await viewer.call(`/recipes/${id}`);
  assert.equal(hiddenFromViewer.status, 404);

  const visibleToAuthor = await author.call(`/recipes/${id}`);
  assert.equal(visibleToAuthor.status, 200);

  const inFeed = await viewer.call(`/recipes?author=${authorReg.data.user.id}`);
  assert.equal(inFeed.data.recipes.length, 0);
});

test('publier un brouillon accorde les points une seule fois (pas de doublon en republiant)', async () => {
  const author = makeSession();
  const authorReg = await author.call('/register', {
    method: 'POST',
    body: {
      username: 'publish_test',
      email: `publish_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });

  const created = await author.call('/recipes', {
    method: 'POST',
    body: { title: 'Brouillon à publier', tags: [], status: 'draft' },
  });
  const id = created.data.recipe.id;
  const pointsAfterDraft = (await author.call('/me')).data.user.points;

  const published = await author.call(`/recipes/${id}`, {
    method: 'PUT',
    body: { title: 'Brouillon à publier', tags: [], status: 'published' },
  });
  assert.equal(published.status, 200);
  assert.equal(published.data.recipe.status, 'published');
  const pointsAfterPublish = (await author.call('/me')).data.user.points;
  assert.equal(pointsAfterPublish, pointsAfterDraft + 25); // POINTS.PUBLISH_RECIPE

  // Republier (déjà publié) ne doit pas donner de points une deuxième fois
  await author.call(`/recipes/${id}`, {
    method: 'PUT',
    body: { title: 'Brouillon à publier', tags: [], status: 'published' },
  });
  const pointsAfterRepublish = (await author.call('/me')).data.user.points;
  assert.equal(pointsAfterRepublish, pointsAfterPublish);
});

test('filtres : max_prep et difficulty réduisent correctement les résultats', async () => {
  const s = makeSession();
  const reg = await s.call('/register', {
    method: 'POST',
    body: {
      username: 'filter_test',
      email: `filter_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const authorId = reg.data.user.id;

  await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Rapide facile', tags: [], prep_minutes: 10, difficulty: 'Facile' },
  });
  await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Longue difficile', tags: [], prep_minutes: 180, difficulty: 'Difficile' },
  });

  const byTime = await s.call(`/recipes?author=${authorId}&max_prep=30`);
  assert.equal(byTime.data.recipes.length, 1);
  assert.equal(byTime.data.recipes[0].title, 'Rapide facile');

  const byDifficulty = await s.call(`/recipes?author=${authorId}&difficulty=Difficile`);
  assert.equal(byDifficulty.data.recipes.length, 1);
  assert.equal(byDifficulty.data.recipes[0].title, 'Longue difficile');
});

// ---------- Lot 10 : tests étendus ----------

test('abonnement : suit/désabonne, crédite des points et notifie la personne suivie', async () => {
  const follower = makeSession();
  const target = makeSession();
  await follower.call('/register', {
    method: 'POST',
    body: {
      username: 'follower_test',
      email: `follower_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const targetReg = await target.call('/register', {
    method: 'POST',
    body: {
      username: 'target_test',
      email: `target_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const targetId = targetReg.data.user.id;
  const pointsBefore = (await db.get('SELECT points FROM users WHERE id=$1', [targetId])).points;

  const unknownTarget = await follower.call(`/users/${targetId + 999999}/follow`, {
    method: 'POST',
  });
  assert.equal(unknownTarget.status, 404); // cible inexistante

  const follow = await follower.call(`/users/${targetId}/follow`, { method: 'POST' });
  assert.equal(follow.status, 200);
  assert.equal(follow.data.following, true);
  assert.equal(follow.data.followers, 1);

  const pointsAfter = (await db.get('SELECT points FROM users WHERE id=$1', [targetId])).points;
  assert.equal(pointsAfter, pointsBefore + 10); // POINTS.RECEIVE_FOLLOW

  const notifs = await target.call('/notifications');
  assert.ok(notifs.data.notifications.some((n) => n.type === 'follow'));
  assert.ok(notifs.data.unread >= 1);

  const markRead = await target.call('/notifications/read', { method: 'POST' });
  assert.equal(markRead.status, 200);
  const notifsAfter = await target.call('/notifications');
  assert.equal(notifsAfter.data.unread, 0);

  const unfollow = await follower.call(`/users/${targetId}/follow`, { method: 'POST' }); // toggle off
  assert.equal(unfollow.data.following, false);
  assert.equal(unfollow.data.followers, 0);
});

test("défis : publier une recette avec le tag d'un défi ouvert le valide automatiquement (une fois)", async () => {
  const s = makeSession();
  await s.call('/register', {
    method: 'POST',
    body: {
      username: 'challenger_test',
      email: `challenger_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });

  const before = await s.call('/challenges');
  const chocoBefore = before.data.challenges.find((c) => c.tag === 'chocolat');
  assert.ok(chocoBefore, 'le défi de seed "chocolat" doit exister');
  assert.equal(chocoBefore.joined, false);

  const created = await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Fondant', tags: ['chocolat'], status: 'published' },
  });
  assert.equal(created.status, 200);

  const after = await s.call('/challenges');
  const chocoAfter = after.data.challenges.find((c) => c.tag === 'chocolat');
  assert.equal(chocoAfter.joined, true);
  assert.equal(chocoAfter.participants, chocoBefore.participants + 1);

  const history = await s.call('/points/history');
  const reasons = history.data.events.map((e) => e.reason);
  assert.ok(reasons.includes("Publication d'une recette"));
  assert.ok(reasons.includes('Défi validé : Défi chocolat'));

  // Publier une deuxième recette avec le même tag ne doit pas revalider le défi.
  await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Mousse', tags: ['chocolat'], status: 'published' },
  });
  const finalChallenges = await s.call('/challenges');
  const chocoFinal = finalChallenges.data.challenges.find((c) => c.tag === 'chocolat');
  assert.equal(chocoFinal.participants, chocoBefore.participants + 1); // pas +2
});

test('récompenses : points insuffisants refusés, échange ok, stock épuisé refusé à la tentative suivante', async () => {
  const s = makeSession();
  const reg = await s.call('/register', {
    method: 'POST',
    body: {
      username: 'reward_test',
      email: `reward_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const userId = reg.data.user.id;

  const rewardsList = await s.call('/rewards');
  const reward = rewardsList.data.rewards.find((r) => r.title.includes('Gourmet'));
  assert.ok(reward);

  const poor = await s.call(`/rewards/${reward.id}/redeem`, { method: 'POST' });
  assert.equal(poor.status, 400);
  assert.equal(poor.data.code, 'INSUFFICIENT_POINTS');

  // On force un stock=1 et assez de points pour un échange déterministe (pas d'accès direct
  // à un mécanisme d'attribution de points aussi rapide dans les tests).
  await db.run('UPDATE rewards SET stock=1 WHERE id=$1', [reward.id]);
  await db.run('UPDATE users SET points=$1 WHERE id=$2', [reward.cost, userId]);

  const ok = await s.call(`/rewards/${reward.id}/redeem`, { method: 'POST' });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.code.startsWith('CUI-'));
  assert.equal(ok.data.points, 0);

  await db.run('UPDATE users SET points=$1 WHERE id=$2', [reward.cost, userId]); // re-crédite pour isoler le test du stock
  const outOfStock = await s.call(`/rewards/${reward.id}/redeem`, { method: 'POST' });
  assert.equal(outOfStock.status, 400);
  assert.equal(outOfStock.data.code, 'OUT_OF_STOCK');
});

test('rate limit : la création de recette est bloquée au-delà de la limite horaire', async () => {
  const s = makeSession();
  await s.call('/register', {
    method: 'POST',
    body: {
      username: 'ratelimit_test',
      email: `ratelimit_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });

  let last;
  for (let i = 0; i < 21; i++) {
    last = await s.call('/recipes', { method: 'POST', body: { title: `Recette ${i}`, tags: [] } });
  }
  assert.equal(last.status, 429);
  assert.equal(last.data.code, 'RATE_LIMITED');
});

test('déconnexion : la session locale devient anonyme (invalidation totale du jeton = Lot 3, pas encore fait)', async () => {
  const s = makeSession();
  await s.call('/register', {
    method: 'POST',
    body: {
      username: 'logout_test',
      email: `logout_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });

  const before = await s.call('/me');
  assert.ok(before.data.user);

  const logout = await s.call('/logout', { method: 'POST' });
  assert.equal(logout.status, 200);

  const after = await s.call('/me');
  assert.equal(after.data.user, null);
});

// ---------- Lot 11 : SEO (méta-tags par recette, sitemap, robots.txt) ----------

test("GET /recette/:id d'une recette publiée renvoie le HTML avec le titre injecté dans les méta-tags", async () => {
  const s = makeSession();
  await s.call('/register', {
    method: 'POST',
    body: { username: 'seo_test', email: `seo_${Date.now()}@test.fr`, password: 'secret12345' },
  });
  const created = await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Gratin dauphinois de mamie', description: 'Fondant et gratiné.', tags: [] },
  });
  const id = created.data.recipe.id;

  const res = await fetch(`${base}/recette/${id}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('<title>Gratin dauphinois de mamie — Cuistot</title>'));
  assert.ok(html.includes('content="Fondant et gratiné."'));
  assert.ok(html.includes('<div id="app"></div>')); // toujours la coquille SPA, pas une page à part
});

test("GET /recette/:id d'un brouillon ou d'un id inconnu retombe sur la page générique (pas d'erreur, pas de fuite)", async () => {
  const s = makeSession();
  await s.call('/register', {
    method: 'POST',
    body: {
      username: 'seo_draft_test',
      email: `seodraft_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const draft = await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Brouillon secret', tags: [], status: 'draft' },
  });

  const resDraft = await fetch(`${base}/recette/${draft.data.recipe.id}`);
  assert.equal(resDraft.status, 200);
  const htmlDraft = await resDraft.text();
  assert.ok(!htmlDraft.includes('Brouillon secret')); // le titre du brouillon ne doit pas fuiter dans les méta publiques

  const resUnknown = await fetch(`${base}/recette/999999`);
  assert.equal(resUnknown.status, 200); // fallback SPA générique, pas une 500
});

test('GET /sitemap.xml liste les recettes publiées avec leur URL', async () => {
  const s = makeSession();
  await s.call('/register', {
    method: 'POST',
    body: {
      username: 'sitemap_test',
      email: `sitemap_${Date.now()}@test.fr`,
      password: 'secret12345',
    },
  });
  const created = await s.call('/recipes', {
    method: 'POST',
    body: { title: 'Recette pour sitemap', tags: [] },
  });

  const res = await fetch(`${base}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /xml/);
  const xml = await res.text();
  assert.ok(xml.includes(`/recette/${created.data.recipe.id}`));
});

test('GET /robots.txt autorise le crawl public mais interdit /api/', async () => {
  const res = await fetch(`${base}/robots.txt`);
  assert.equal(res.status, 200);
  const txt = await res.text();
  assert.ok(txt.includes('Disallow: /api/'));
  assert.ok(txt.includes('Sitemap:'));
});
