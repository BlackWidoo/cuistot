/* Cuistot — SPA front-end (vanilla JS) */
'use strict';

const App = {
  el: document.getElementById('app'),
  state: { user: null, badges: [], view: 'feed', token: null },
};

/* ---------- API helper ---------- */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (App.state.token) headers.Authorization = 'Bearer ' + App.state.token;
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

/* ---------- Utils ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function timeAgo(iso) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  if (s < 604800) return Math.floor(s / 86400) + ' j';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function toast(msg, win = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (win ? ' win' : '');
  clearTimeout(App._tt);
  App._tt = setTimeout(() => (t.className = 'toast'), 2600);
}

function closeModal() { const m = document.getElementById('modal'); m.hidden = true; m.innerHTML = ''; }
function showModal(html) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="modal">${html}</div>`;
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
}

const CATEGORIES = ['Tout', 'Entrée', 'Plat', 'Dessert', 'Petit-déj', 'Végétarien', 'Healthy', 'Boisson', 'Autre'];
const FOOD_EMOJIS = ['🍽️','🍲','🍝','🍜','🥗','🍛','🍕','🌮','🍔','🥘','🍰','🍫','🧁','🥞','🍳','🥐','🍤','🍚','🥙','🫕','🍩','🎂','🥧','🍦'];

/* ---------- Ambiance visuelle par catégorie (covers premium) ---------- */
const CAT_GRAD = {
  'Entrée':     'linear-gradient(135deg,#f0d3ac,#e2b98c)',
  'Plat':       'linear-gradient(135deg,#e8c6a8,#d99e7c)',
  'Dessert':    'linear-gradient(135deg,#e8cdd3,#d6a9b8)',
  'Petit-déj':  'linear-gradient(135deg,#ecdfb8,#ddc386)',
  'Végétarien': 'linear-gradient(135deg,#d6dfc4,#b3c99a)',
  'Healthy':    'linear-gradient(135deg,#cbdfd2,#a4c7b2)',
  'Boisson':    'linear-gradient(135deg,#cddae6,#aec2d6)',
  'Autre':      'linear-gradient(135deg,#e8dccb,#d9c3a8)',
};
const coverStyle = (cat) => `background:${CAT_GRAD[cat] || CAT_GRAD['Autre']}`;

/* ---------- Icônes (SVG traits fins, pas d'emoji pour les boutons/nav) ---------- */
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9"/><path d="M9.5 20v-6h5v6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4a3 3 0 0 0 3 5"/><path d="M17 5h3a3 3 0 0 1-3 5"/><path d="M12 13v3"/><path d="M9 20h6"/><path d="M10 16.5h4l.5 3.5h-5l.5-3.5Z"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.4-4 4.2-6 7.5-6s6.1 2 7.5 6"/>',
  userplus: '<circle cx="10" cy="8" r="3.4"/><path d="M3.5 20c1.2-3.6 3.7-5.4 6.5-5.4s5.3 1.8 6.5 5.4"/><path d="M18 8v5M15.5 10.5h5"/>',
  bell: '<path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.8-9.4C.7 7.7 2 4.4 5.3 3.6c2.1-.5 4.1.4 5.2 2.2h2.9c1.1-1.8 3.1-2.7 5.2-2.2 3.3.8 4.6 4.1 3.1 7.5-2.3 4.8-9.7 9.4-9.7 9.4Z"/>',
  comment: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4.5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
  bookmark: '<path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z"/>',
};
function icon(name, opts = {}) {
  const inner = ICONS[name] || '';
  const filled = !!opts.filled;
  return `<svg class="svgic" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/* ---------- Retour haptique (mobile) ---------- */
function haptic(ms = 12) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch {} }

/* ---------- Redimensionne + compresse une photo côté client (léger & rapide) ---------- */
function resizeImage(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height >= width && height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}

/* ---------- Petites cartes « shimmer » pendant le chargement ---------- */
function skeletonCards(n = 3) {
  let s = '<div class="skeleton">';
  for (let i = 0; i < n; i++) s += `
    <div class="sk-card">
      <div class="sk-head"><div class="sk-dot shine"></div><div class="sk-line md shine" style="margin:0"></div></div>
      <div class="sk-cover shine"></div>
      <div class="sk-line lg shine"></div><div class="sk-line md shine"></div><div class="sk-line sm shine"></div>
    </div>`;
  return s + '</div>';
}


/* ============================================================
   AUTH SCREEN
   ============================================================ */
function renderAuth(tab = 'login') {
  App.el.innerHTML = `
    <div class="auth">
      <div class="auth-hero">
        <div class="big">🍳</div>
        <h1>Cuistot</h1>
        <p>Le réseau social des gourmands. Partage tes recettes, gagne des points, échange avec la communauté.</p>
      </div>
      <div class="auth-card">
        <div class="tabs">
          <button data-tab="login" class="${tab==='login'?'active':''}">Connexion</button>
          <button data-tab="register" class="${tab==='register'?'active':''}">Inscription</button>
        </div>
        <form id="authForm">
          ${tab==='register' ? `
            <div class="field"><label>Pseudo</label><input name="username" required placeholder="chef_du_dimanche" autocomplete="username"></div>` : ''}
          <div class="field"><label>Email ${tab==='login'?'ou pseudo':''}</label><input name="email" required placeholder="toi@exemple.fr" autocomplete="email"></div>
          <div class="field"><label>Mot de passe</label><input name="password" type="password" required placeholder="••••••" autocomplete="current-password"></div>
          <button class="btn" type="submit">${tab==='login'?'Se connecter':'Créer mon compte'}</button>
        </form>
        <div class="demo-hint">Essai rapide : <b>demo@cuistot.fr</b> / <b>demo123</b></div>
      </div>
    </div>`;

  App.el.querySelectorAll('[data-tab]').forEach((b) =>
    b.onclick = () => renderAuth(b.dataset.tab));

  document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = '…';
    try {
      const data = await api(tab === 'login' ? '/login' : '/register', { method: 'POST', body: f });
      App.state.token = data.token;
      App.state.user = data.user;
      localStorage.setItem('cuistot_token', data.token);
      await refreshMe();
      toast('Bienvenue ' + data.user.username, true);
      go('feed');
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = tab === 'login' ? 'Se connecter' : 'Créer mon compte';
    }
  };
}

/* ============================================================
   SHELL (topbar + nav)
   ============================================================ */
function shell(content) {
  const u = App.state.user;
  const nav = [
    ['feed', icon('home'), 'Fil'],
    ['discover', icon('search'), 'Découvrir'],
    ['create', icon('plus'), 'Publier'],
    ['challenges', icon('trophy'), 'Défis'],
    ['profile', icon('user'), 'Profil'],
  ];
  App.el.innerHTML = `
    <header class="topbar"><div class="topbar-inner">
      <div class="logo"><span class="dot">🍳</span>Cuistot</div>
      <div class="spacer"></div>
      <button class="points-pill" data-go="rewards">${u.points} pts</button>
      <button class="bell-btn" data-go="notifications">${icon('bell')}<span class="bell-badge" id="bellBadge" hidden>0</span></button>
      <button class="avatar-btn" data-go="profile">${u.avatar}</button>
    </div></header>
    <main class="container fade-in" id="viewRoot">${content}</main>
    <nav class="bottomnav"><div class="bottomnav-inner">
      ${nav.map(([v, ic, label]) => `
        <button class="nav-item ${v==='create'?'add':''} ${App.state.view===v?'active':''}" data-go="${v}" title="${label||v}" aria-label="${label||v}">
          <span class="ic">${ic}</span>
        </button>`).join('')}
    </div></nav>`;
  App.el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
  updateBell();
}

// Met à jour la pastille de notifications non lues
async function updateBell() {
  try {
    const { unread } = await api('/notifications');
    const badge = document.getElementById('bellBadge');
    if (!badge) return;
    if (unread > 0) { badge.textContent = unread > 9 ? '9+' : unread; badge.hidden = false; }
    else badge.hidden = true;
  } catch {}
}

/* ============================================================
   NAVIGATION
   ============================================================ */
async function go(view, arg) {
  App.state.view = view;
  window.scrollTo(0, 0);
  const R = {
    feed: viewFeed, discover: viewDiscover, create: viewCreate,
    challenges: viewChallenges, rewards: viewRewards, profile: viewProfile,
    recipe: viewRecipe, user: viewUser, leaderboard: viewLeaderboard,
    notifications: viewNotifications, bookmarks: viewBookmarks,
  };
  await (R[view] || viewFeed)(arg);
}

async function refreshMe() {
  const me = await api('/me');
  App.state.user = me.user;
  App.state.badges = me.badges || [];
}

/* ============================================================
   RECIPE CARD
   ============================================================ */
function recipeCard(r) {
  return `
  <article class="recipe" data-recipe="${r.id}">
    <div class="recipe-head">
      <div class="mini-avatar" data-user="${r.author.id}">${r.author.avatar}</div>
      <div class="who" data-user="${r.author.id}">${esc(r.author.username)}</div>
      <span class="cat-tag">${esc(r.category)}</span>
    </div>
    <div class="recipe-cover ${r.photo?'has-photo':''}" data-open="${r.id}" style="${coverStyle(r.category)}">
      ${r.photo ? `<img class="cover-img" src="${esc(r.photo)}" alt="${esc(r.title)}" loading="lazy" onerror="this.closest('.recipe-cover').classList.remove('has-photo');this.remove()">` : r.image}
    </div>
    <div class="recipe-actions">
      <button class="act like ${r.liked?'liked':''}" data-like="${r.id}"><span class="ic">${icon('heart',{filled:r.liked})}</span></button>
      <button class="act" data-open="${r.id}"><span class="ic">${icon('comment')}</span></button>
      <button class="act bm ${r.bookmarked?'saved':''}" data-bm="${r.id}"><span class="ic">${icon('bookmark',{filled:r.bookmarked})}</span></button>
    </div>
    <div class="recipe-body" data-open="${r.id}">
      <div class="likes-line">${r.likes} mention${r.likes>1?'s':''} j'aime</div>
      <h3><span class="who-inline">${esc(r.author.username)}</span>${esc(r.title)}</h3>
      <p class="desc">${esc(r.description)}</p>
      ${r.comments>0?`<div class="see-comments" data-open="${r.id}">Voir les ${r.comments} commentaire${r.comments>1?'s':''}</div>`:''}
      <div class="when-row">${timeAgo(r.created_at)}</div>
    </div>
  </article>`;
}

function swipeSlide(r) {
  return `
  <section class="swipe-slide" data-recipe="${r.id}">
    <div class="swipe-media ${r.photo?'has-photo':''}" data-open="${r.id}" style="${coverStyle(r.category)}">
      ${r.photo ? `<img class="cover-img" src="${esc(r.photo)}" alt="${esc(r.title)}" loading="lazy" onerror="this.closest('.swipe-media').classList.remove('has-photo');this.remove()">` : `<div class="swipe-emoji">${r.image}</div>`}
    </div>
    <div class="swipe-rail">
      <button class="act rail-act like ${r.liked?'liked':''}" data-like="${r.id}"><span class="ic">${icon('heart',{filled:r.liked})}</span><span class="cnt">${r.likes}</span></button>
      <button class="act rail-act" data-open="${r.id}"><span class="ic">${icon('comment')}</span><span class="cnt">${r.comments}</span></button>
      <button class="act rail-act bm ${r.bookmarked?'saved':''}" data-bm="${r.id}"><span class="ic">${icon('bookmark',{filled:r.bookmarked})}</span></button>
    </div>
    <div class="swipe-info" data-open="${r.id}">
      <div class="swipe-head">
        <span class="mini-avatar" data-user="${r.author.id}">${r.author.avatar}</span>
        <span class="who" data-user="${r.author.id}">${esc(r.author.username)}</span>
        <span class="cat-tag">${esc(r.category)}</span>
      </div>
      <h3>${esc(r.title)}</h3>
      <p class="desc">${esc(r.description)}</p>
      <div class="meta-row"><span>⏱ ${r.prep_minutes} min</span><span>🍽 ${r.servings} pers.</span></div>
      <div class="swipe-cta">Voir la recette</div>
    </div>
  </section>`;
}

/* ---------- Squelettes « shimmer » pour le fil swipe ---------- */
function skeletonSwipe(n = 2) {
  let s = '';
  for (let i = 0; i < n; i++) s += `<section class="swipe-slide"><div class="swipe-media shine"></div></section>`;
  return s;
}

function wireRecipeCards(root) {
  root.querySelectorAll('[data-open]').forEach((e) => e.onclick = (ev) => { ev.stopPropagation(); go('recipe', e.dataset.open); });
  root.querySelectorAll('[data-user]').forEach((e) => e.onclick = (ev) => { ev.stopPropagation(); go('user', e.dataset.user); });
  root.querySelectorAll('[data-like]').forEach((e) => e.onclick = async (ev) => {
    ev.stopPropagation();
    haptic();
    try {
      const hadCnt = !!e.querySelector('.cnt');
      const d = await api(`/recipes/${e.dataset.like}/like`, { method: 'POST' });
      e.classList.toggle('liked', d.liked);
      e.innerHTML = `<span class="ic">${icon('heart',{filled:d.liked})}</span>${hadCnt ? `<span class="cnt">${d.likes}</span>` : ''}`;
      const likesLine = e.closest('.recipe')?.querySelector('.likes-line');
      if (likesLine) likesLine.textContent = `${d.likes} mention${d.likes>1?'s':''} j'aime`;
      await refreshPoints();
    } catch (err) { toast(err.message); }
  });
  root.querySelectorAll('[data-bm]').forEach((e) => e.onclick = async (ev) => {
    ev.stopPropagation();
    try {
      const d = await api(`/recipes/${e.dataset.bm}/bookmark`, { method: 'POST' });
      e.classList.toggle('saved', d.bookmarked);
      e.innerHTML = `<span class="ic">${icon('bookmark',{filled:d.bookmarked})}</span>`;
      toast(d.bookmarked ? 'Ajouté à tes favoris' : 'Retiré des favoris');
    } catch (err) { toast(err.message); }
  });
}

async function refreshPoints() {
  try {
    const me = await api('/me');
    App.state.user.points = me.user.points;
    const pill = document.querySelector('.points-pill');
    if (pill && pill.classList.contains('points-pill')) {
      pill.textContent = `${me.user.points} pts`;
    }
  } catch {}
}

/* ============================================================
   FEED
   ============================================================ */
async function viewFeed(mode = 'all') {
  shell(`
    <div class="swipefeed">
      <div class="swipe-tabs" id="feedChips">
        <button class="stab ${mode==='all'?'active':''}" data-mode="all">Découverte</button>
        <button class="stab ${mode==='feed'?'active':''}" data-mode="feed">Abonnements</button>
        <button class="stab ${mode==='popular'?'active':''}" data-mode="popular">Populaires</button>
      </div>
      <div id="feedList" class="swipe-list">${skeletonSwipe()}</div>
    </div>`);

  document.querySelectorAll('#feedChips .stab').forEach((c) => c.onclick = () => viewFeed(c.dataset.mode));

  let path = '/recipes';
  if (mode === 'feed') path += '?feed=1';
  if (mode === 'popular') path += '?sort=popular';
  try {
    const { recipes } = await api(path);
    const list = document.getElementById('feedList');
    if (!recipes.length) {
      list.innerHTML = mode === 'feed'
        ? `<div class="empty swipe-empty"><div class="big">🍽️</div><p>Suis des chefs pour voir leurs recettes ici.</p></div>`
        : `<div class="empty swipe-empty"><div class="big">🍽️</div><p>Aucune recette pour l'instant.</p></div>`;
      return;
    }
    list.innerHTML = recipes.map(swipeSlide).join('');
    wireRecipeCards(list);
  } catch (err) { toast(err.message); }
}

/* ============================================================
   DISCOVER / SEARCH
   ============================================================ */
async function viewDiscover(preset = '') {
  shell(`
    <div class="section-title serif">Découvrir</div>
    <div class="searchbar">
      <span>${icon('search')}</span>
      <input id="searchInput" placeholder="Recette, ingrédient, tag…" value="${esc(preset)}">
    </div>
    <div class="chips" id="catChips">
      ${CATEGORIES.map(c=>`<button class="chip ${c==='Tout'?'active':''}" data-cat="${c}">${c}</button>`).join('')}
    </div>
    <button class="chip" data-go="leaderboard" style="margin:2px 0 10px">Voir le classement des chefs</button>
    <div id="discoverList"></div>`);

  let cat = 'Tout', q = preset;
  const run = async () => {
    const list = document.getElementById('discoverList');
    list.innerHTML = skeletonCards(3);
    let path = `/recipes?sort=trending`;
    if (cat !== 'Tout') path += `&category=${encodeURIComponent(cat)}`;
    if (q) path += `&q=${encodeURIComponent(q)}`;
    try {
      const { recipes } = await api(path);
      list.innerHTML = recipes.length
        ? recipes.map(recipeCard).join('')
        : `<div class="empty"><div class="big">🤷</div><p>Rien trouvé. Essaie un autre mot-clé.</p></div>`;
      wireRecipeCards(list);
    } catch (err) { toast(err.message); }
  };

  const input = document.getElementById('searchInput');
  let deb;
  input.oninput = () => { clearTimeout(deb); q = input.value.trim(); deb = setTimeout(run, 300); };
  document.querySelectorAll('#catChips .chip').forEach((c) => c.onclick = () => {
    document.querySelectorAll('#catChips .chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active'); cat = c.dataset.cat; run();
  });
  document.querySelector('[data-go="leaderboard"]').onclick = () => go('leaderboard');
  run();
}

/* ============================================================
   CREATE RECIPE
   ============================================================ */
async function viewCreate(edit) {
  const isEdit = edit && edit.id;
  const sel = (v, cur) => v === cur ? ' selected' : '';
  App.state.view = 'create';
  shell(`
    <div class="section-title serif">${isEdit?'Modifier la recette':'Nouvelle recette'}</div>
    <div class="card" style="padding:18px">
      <form id="recipeForm">
        <div class="field"><label>Titre du plat</label><input name="title" required placeholder="Ex : Tarte aux pommes de mamie" value="${isEdit?esc(edit.title):''}"></div>
        <div class="field"><label>Photo du plat <span class="muted" style="font-weight:600">(optionnel)</span></label>
          <div class="photo-drop" id="photoDrop">
            <div class="photo-empty" id="photoEmpty">
              <div class="pe-ic">📷</div>
              <div>Ajoute une photo depuis ta pellicule</div>
              <div class="muted" style="font-size:.78rem">Elle sera compressée automatiquement</div>
            </div>
            <img class="photo-prev" id="photoPrev" hidden alt="aperçu">
            <button type="button" class="photo-remove" id="photoRemove" hidden>✕</button>
          </div>
          <input type="file" id="photoInput" accept="image/*" hidden>
        </div>
        <div class="field"><label>… ou choisis une illustration</label>
          <div class="emoji-pick" id="emojiPick">
            ${FOOD_EMOJIS.map((e,i)=>`<button type="button" class="${(isEdit?e===edit.image:i===0)?'sel':''}" data-emoji="${e}">${e}</button>`).join('')}
          </div>
        </div>
        <div class="field"><label>Description</label><textarea name="description" placeholder="Raconte ce plat en quelques mots…">${isEdit?esc(edit.description):''}</textarea></div>
        <div class="dyn-row" style="gap:8px">
          <div class="field" style="flex:1;margin:0"><label>Catégorie</label>
            <select name="category">${CATEGORIES.filter(c=>c!=='Tout').map(c=>`<option${sel(c, isEdit?edit.category:'')}>${c}</option>`).join('')}</select></div>
          <div class="field" style="flex:1;margin:0"><label>Difficulté</label>
            <select name="difficulty">${['Facile','Moyen','Difficile'].map(d=>`<option${sel(d, isEdit?edit.difficulty:'')}>${d}</option>`).join('')}</select></div>
        </div>
        <div class="dyn-row" style="gap:8px;margin-top:14px">
          <div class="field" style="flex:1;margin:0"><label>Temps (min)</label><input name="prep_minutes" type="number" value="${isEdit?edit.prep_minutes:20}" min="1"></div>
          <div class="field" style="flex:1;margin:0"><label>Portions</label><input name="servings" type="number" value="${isEdit?edit.servings:2}" min="1"></div>
        </div>
        <div class="field" style="margin-top:14px"><label>Ingrédients</label>
          <div id="ingList"></div>
          <button type="button" class="btn ghost small" id="addIng">+ Ajouter un ingrédient</button>
        </div>
        <div class="field"><label>Étapes de préparation</label>
          <div id="stepList"></div>
          <button type="button" class="btn ghost small" id="addStep">+ Ajouter une étape</button>
        </div>
        <div class="field"><label>Tags (séparés par des virgules)</label>
          <input name="tags" placeholder="ex : végétarien, rapide, chocolat" value="${isEdit?esc((edit.tags||[]).join(', ')):''}"></div>
        <button class="btn" type="submit">${isEdit?'Enregistrer les modifications':'Publier ma recette <span style="opacity:.85">(+25 pts)</span>'}</button>
      </form>
    </div>`);

  let emoji = isEdit ? edit.image : FOOD_EMOJIS[0];
  document.querySelectorAll('#emojiPick button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('#emojiPick button').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel'); emoji = b.dataset.emoji;
  });

  // Sélecteur de photo (pellicule / appareil) avec compression
  let photoData = isEdit ? (edit.photo || '') : '';
  const drop = document.getElementById('photoDrop');
  const prev = document.getElementById('photoPrev');
  const emptyEl = document.getElementById('photoEmpty');
  const removeBtn = document.getElementById('photoRemove');
  const photoInput = document.getElementById('photoInput');
  const showPhoto = (data) => {
    photoData = data || '';
    if (photoData) { prev.src = photoData; prev.hidden = false; emptyEl.hidden = true; removeBtn.hidden = false; }
    else { prev.hidden = true; prev.removeAttribute('src'); emptyEl.hidden = false; removeBtn.hidden = true; }
  };
  if (photoData) showPhoto(photoData);
  drop.onclick = (ev) => { if (ev.target !== removeBtn) photoInput.click(); };
  removeBtn.onclick = (ev) => { ev.stopPropagation(); showPhoto(''); };
  photoInput.onchange = async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    emptyEl.innerHTML = '<div class="pe-ic">⏳</div><div>Compression…</div>';
    try {
      const data = await resizeImage(file, 1280, 0.82);
      showPhoto(data);
      haptic();
    } catch { toast('Impossible de lire cette image'); emptyEl.innerHTML = '<div class="pe-ic">📷</div><div>Ajoute une photo depuis ta pellicule</div>'; }
    photoInput.value = '';
  };

  const mkRow = (ph, val) => {
    const div = document.createElement('div');
    div.className = 'dyn-row';
    const inp = document.createElement('input');
    inp.placeholder = ph; if (val) inp.value = val;
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'rm'; rm.textContent = '×';
    rm.onclick = () => div.remove();
    div.append(inp, rm);
    return div;
  };
  const ingList = document.getElementById('ingList');
  const stepList = document.getElementById('stepList');
  if (isEdit) {
    (edit.ingredients.length ? edit.ingredients : ['']).forEach((v) => ingList.appendChild(mkRow('Un ingrédient', v)));
    (edit.steps.length ? edit.steps : ['']).forEach((v) => stepList.appendChild(mkRow('Une étape', v)));
  } else {
    ingList.appendChild(mkRow('200g de farine'));
    ingList.appendChild(mkRow('3 œufs'));
    stepList.appendChild(mkRow('Préchauffer le four à 180°C'));
  }
  document.getElementById('addIng').onclick = () => ingList.appendChild(mkRow('Un ingrédient'));
  document.getElementById('addStep').onclick = () => stepList.appendChild(mkRow('Une étape'));

  document.getElementById('recipeForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const ingredients = [...ingList.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    const steps = [...stepList.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    const tags = (f.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = isEdit ? 'Enregistrement…' : 'Publication…';
    const body = {
      title: f.title, description: f.description, category: f.category,
      difficulty: f.difficulty, prep_minutes: f.prep_minutes, servings: f.servings,
      image: emoji, photo: photoData, ingredients, steps, tags,
    };
    try {
      if (isEdit) {
        await api(`/recipes/${edit.id}`, { method: 'PUT', body });
        toast('Recette mise à jour', true);
        go('recipe', edit.id);
      } else {
        await api('/recipes', { method: 'POST', body });
        await refreshMe();
        toast('Recette publiée · +25 points', true);
        go('feed');
      }
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = isEdit ? 'Enregistrer' : 'Publier ma recette'; }
  };
}

/* ============================================================
   RECIPE DETAIL
   ============================================================ */
async function viewRecipe(id) {
  App.state.view = 'feed';
  try {
    const { recipe: r } = await api('/recipes/' + id);
    shell(`
      <button class="back-btn" id="back">← Retour</button>
      <div class="card" style="margin-bottom:16px">
        <div class="detail-cover ${r.photo?'has-photo':''}" style="${coverStyle(r.category)}">${r.photo ? `<img class="cover-img" src="${esc(r.photo)}" alt="${esc(r.title)}" onerror="this.closest('.detail-cover').classList.remove('has-photo');this.remove()">` : r.image}</div>
        <div style="padding:16px">
          <div class="recipe-head" style="padding:0 0 12px">
            <div class="mini-avatar" data-user="${r.author.id}">${r.author.avatar}</div>
            <div><div class="who" data-user="${r.author.id}">${esc(r.author.username)}</div>
              <div class="when">${timeAgo(r.created_at)}</div></div>
          </div>
          <h2 class="serif" style="font-size:1.8rem">${esc(r.title)}</h2>
          <div class="meta-row" style="margin:10px 0">
            <span>🏷 ${esc(r.category)}</span><span>📊 ${esc(r.difficulty)}</span>
            <span>⏱ ${r.prep_minutes} min</span><span>🍽 ${r.servings} pers.</span>
          </div>
          <p class="muted">${esc(r.description)}</p>
          ${r.tags.length?`<div class="tags" style="margin-top:10px">${r.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</div>`:''}
          <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
            <button class="btn ${r.liked?'gold':''} small" id="likeBtn"><span class="ic">${icon('heart',{filled:r.liked})}</span> ${r.liked?'Aimé':'J\'aime'} · ${r.likes}</button>
            <button class="btn ghost small" id="bmBtn">${r.bookmarked?'Enregistré':'Enregistrer'}</button>
          </div>
          ${r.is_mine?`<div style="display:flex;gap:10px;margin-top:10px">
            <button class="btn ghost small" id="editBtn">Modifier</button>
            <button class="btn ghost small" id="delBtn" style="border-color:var(--terracotta);color:var(--terracotta)">Supprimer</button>
          </div>`:''}

          <div class="detail-section"><h3 class="serif">Ingrédients</h3>
            <ul class="ing-list">${r.ingredients.map(i=>`<li>${esc(i)}</li>`).join('') || '<li class="muted">Non précisé</li>'}</ul></div>
          <div class="detail-section"><h3 class="serif">Préparation</h3>
            <ol class="step-list">${r.steps.map(s=>`<li>${esc(s)}</li>`).join('') || '<li class="muted">Non précisé</li>'}</ol></div>

          <div class="detail-section"><h3 class="serif">${icon('comment')} Commentaires (${r.commentList.length})</h3>
            <div id="commentList">${r.commentList.map(commentHtml).join('') || '<p class="muted">Sois le premier à commenter.</p>'}</div>
            <form class="comment-form" id="commentForm">
              <input name="body" placeholder="Ton avis gourmand…" required>
              <button class="btn small" type="submit">Envoyer</button>
            </form>
          </div>
        </div>
      </div>`);

    document.getElementById('back').onclick = () => go('feed');
    App.el.querySelectorAll('[data-user]').forEach((e) => e.onclick = () => go('user', e.dataset.user));

    document.getElementById('likeBtn').onclick = async () => {
      haptic();
      const d = await api(`/recipes/${id}/like`, { method: 'POST' });
      const b = document.getElementById('likeBtn');
      b.className = 'btn small ' + (d.liked ? 'gold' : '');
      b.innerHTML = `<span class="ic">${icon('heart',{filled:d.liked})}</span> ${d.liked ? 'Aimé' : 'J\'aime'} · ${d.likes}`;
      await refreshPoints();
    };

    document.getElementById('bmBtn').onclick = async () => {
      const d = await api(`/recipes/${id}/bookmark`, { method: 'POST' });
      document.getElementById('bmBtn').innerHTML = d.bookmarked ? 'Enregistré' : 'Enregistrer';
      toast(d.bookmarked ? 'Ajouté à ton carnet' : 'Retiré du carnet');
    };

    if (r.is_mine) {
      document.getElementById('editBtn').onclick = () => viewCreate(r);
      document.getElementById('delBtn').onclick = () => {
        showModal(`<div class="mic">🗑</div><h3 class="serif">Supprimer cette recette ?</h3>
          <p class="muted">Cette action est définitive.</p>
          <div style="display:flex;gap:10px;margin-top:16px">
            <button class="btn ghost" id="cancelDel">Annuler</button>
            <button class="btn" id="confirmDel" style="background:var(--terracotta)">Supprimer</button></div>`);
        document.getElementById('cancelDel').onclick = closeModal;
        document.getElementById('confirmDel').onclick = async () => {
          try { await api(`/recipes/${id}`, { method: 'DELETE' }); closeModal(); toast('Recette supprimée'); go('feed'); }
          catch (err) { toast(err.message); }
        };
      };
    }

    document.getElementById('commentForm').onsubmit = async (e) => {
      e.preventDefault();
      const body = e.target.body.value.trim();
      if (!body) return;
      try {
        const d = await api(`/recipes/${id}/comments`, { method: 'POST', body: { body } });
        document.getElementById('commentList').innerHTML = d.comments.map(commentHtml).join('');
        e.target.reset();
        await refreshPoints();
      } catch (err) { toast(err.message); }
    };
  } catch (err) { toast(err.message); go('feed'); }
}

function commentHtml(c) {
  return `<div class="comment"><div class="mini-avatar">${c.avatar}</div>
    <div class="cbody"><div class="cname">${esc(c.username)}</div>
    <div class="ctext">${esc(c.body)}</div></div></div>`;
}

/* ============================================================
   CHALLENGES
   ============================================================ */
async function viewChallenges() {
  shell(`
    <div class="section-title serif">Défis cuisine</div>
    <p class="muted" style="margin-bottom:14px">Publie une recette qui correspond au thème pour valider un défi et empocher des points bonus.</p>
    <div id="chList"><div class="skeleton">Chargement…</div></div>`);
  try {
    const { challenges } = await api('/challenges');
    document.getElementById('chList').innerHTML = challenges.map((ch) => `
      <article class="card challenge">
        <div class="ch-top">
          <div class="ch-ic">${ch.icon}</div>
          <div style="flex:1">
            <h4>${esc(ch.title)}</h4>
            <div class="ch-desc">${esc(ch.description)}</div>
          </div>
        </div>
        <div class="ch-foot">
          <span class="reward-pts">+${ch.reward_pts} pts</span>
          ${ch.joined
            ? `<span class="joined-badge">✅ Validé</span>`
            : `<button class="btn tiny gold" data-tag="${esc(ch.tag)}">Participer</button>`}
        </div>
        <div class="muted" style="font-size:.78rem;margin-top:8px">
          👥 ${ch.participants} participant${ch.participants>1?'s':''} · Se termine le ${new Date(ch.ends_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'})}
        </div>
      </article>`).join('');
    document.querySelectorAll('[data-tag]').forEach((b) => b.onclick = () => {
      toast('Publie une recette avec le tag « ' + b.dataset.tag + ' » pour valider');
      go('create');
    });
  } catch (err) { toast(err.message); }
}

/* ============================================================
   REWARDS SHOP
   ============================================================ */
async function viewRewards() {
  App.state.view = 'rewards';
  shell(`
    <div class="section-title serif">Boutique</div>
    <div class="level-card" style="margin:0 0 16px">
      <div class="level-top"><span class="level-name">Ton solde</span>
        <span class="points-pill">${App.state.user.points} pts</span></div>
      <p class="muted" style="font-size:.85rem">Gagne des points en publiant, en likant et en relevant des défis, puis échange-les ici.</p>
    </div>
    <div id="rewardList">${skeletonCards(2)}</div>
    <div id="redeemed"></div>`);
  try {
    const { rewards, redeemed } = await api('/rewards');
    document.getElementById('rewardList').innerHTML = rewards.map((r) => {
      const afford = App.state.user.points >= r.cost;
      const out = r.stock === 0;
      return `<article class="card reward">
        <div class="ric">${r.icon}</div>
        <div class="rinfo"><h4>${esc(r.title)}</h4><p>${esc(r.description)}</p>
          <span class="cost-pill">${r.cost} pts</span>
          ${r.stock>0?`<span class="cost-pill" style="background:var(--cream);color:var(--ink-soft)">Stock : ${r.stock}</span>`:''}
        </div>
        <button class="btn small ${afford&&!out?'gold':''}" data-redeem="${r.id}" ${afford&&!out?'':'disabled'}>
          ${out?'Épuisé':afford?'Échanger':'Trop cher'}</button>
      </article>`;
    }).join('');

    document.querySelectorAll('[data-redeem]').forEach((b) => b.onclick = async () => {
      try {
        const d = await api(`/rewards/${b.dataset.redeem}/redeem`, { method: 'POST' });
        App.state.user.points = d.points;
        showModal(`<div class="mic">🎁</div><h3 class="serif">Récompense débloquée</h3>
          <p class="muted">Voici ton code à conserver :</p>
          <div class="code">${d.code}</div>
          <button class="btn" onclick="document.getElementById('modal').hidden=true">Fermer</button>`);
        viewRewards();
      } catch (err) { toast(err.message); }
    });

    document.getElementById('redeemed').innerHTML = redeemed.length ? `
      <div class="section-title serif" style="font-size:1.2rem">Mes récompenses</div>
      ${redeemed.map((r) => `<div class="card reward"><div class="ric">${r.icon}</div>
        <div class="rinfo"><h4>${esc(r.title)}</h4>
        <span class="cost-pill" style="background:var(--bg-warm);color:var(--terracotta)">Code : ${esc(r.code)}</span></div></div>`).join('')}` : '';
  } catch (err) { toast(err.message); }
}

/* ============================================================
   PROFILE (self)
   ============================================================ */
async function viewProfile() {
  await refreshMe();
  renderProfile(App.state.user, App.state.badges, null, true);
}

async function viewUser(id) {
  if (Number(id) === App.state.user.id) return go('profile');
  App.state.view = '';
  try {
    const { user, badges, recipes, isFollowing } = await api('/users/' + id);
    renderProfile(user, badges, { recipes, isFollowing }, false);
  } catch (err) { toast(err.message); }
}

function renderProfile(user, badges, extra, isSelf) {
  const lvl = user.level;
  shell(`
    ${isSelf?'':'<button class="back-btn" id="back">← Retour</button>'}
    <div class="profile-head">
      <div class="profile-avatar">${user.avatar}</div>
      <h2 class="serif">${esc(user.username)}</h2>
      <p class="bio">${esc(user.bio) || '<span class="muted">Pas encore de bio.</span>'}</p>
      <div class="stats-row">
        <div class="stat"><div class="n">${user.recipes}</div><div class="l">Recettes</div></div>
        <div class="stat"><div class="n">${user.followers}</div><div class="l">Abonnés</div></div>
        <div class="stat"><div class="n">${user.following}</div><div class="l">Abos</div></div>
      </div>
      ${isSelf
        ? ''
        : `<button class="btn ${extra.isFollowing?'ghost':''} small" id="followBtn" style="max-width:220px;margin:0 auto">
             ${extra.isFollowing?'✓ Abonné':'+ Suivre ce chef'}</button>`}
    </div>

    <div class="level-card">
      <div class="level-top">
        <span class="level-name">Niveau ${lvl.level} · ${lvl.name}</span>
        <span class="points-pill">${user.points} pts</span>
      </div>
      <div class="level-bar"><i style="width:${lvl.progress}%"></i></div>
      <div class="level-sub">${lvl.next
        ? `Encore ${lvl.next.min - user.points} pts pour devenir « ${lvl.next.name} »`
        : 'Niveau maximum atteint.'}</div>
    </div>

    <div class="section-title serif" style="font-size:1.3rem">Badges</div>
    <div class="badge-grid">
      ${badges.map((b) => `<div class="badge ${b.unlocked?'on':''}" title="${esc(b.desc)}">
        <div class="ic">${b.icon}</div><div class="nm">${esc(b.name)}</div></div>`).join('')}
    </div>

    ${isSelf?`
      <div style="display:grid;gap:10px;margin-top:16px">
        <button class="btn ghost small" data-go="bookmarks">Mon carnet de recettes</button>
        <button class="btn ghost small" id="histBtn">Mon historique de points</button>
        <button class="btn ghost small" id="themeBtn">Basculer en mode sombre</button>
        <button class="btn ghost small" id="logout2" style="border-color:var(--ink-soft);color:var(--ink-soft)">Se déconnecter</button>
      </div>`:''}

    <div class="section-title serif" style="font-size:1.3rem">${isSelf?'Mes recettes':'Ses recettes'}</div>
    <div id="userRecipes">${skeletonCards(2)}</div>`);

  if (isSelf) {
    document.getElementById('logout2').onclick = () => {
      localStorage.removeItem('cuistot_token');
      App.state = { user: null, badges: [], view: 'feed', token: null };
      renderAuth('login');
    };
    document.getElementById('histBtn').onclick = showHistory;
    const tb = document.getElementById('themeBtn');
    tb.textContent = document.documentElement.dataset.theme === 'dark' ? 'Basculer en mode clair' : 'Basculer en mode sombre';
    tb.onclick = toggleTheme;
  } else {
    document.getElementById('back').onclick = () => history.length > 1 ? go('feed') : go('feed');
    document.getElementById('followBtn').onclick = async () => {
      const d = await api(`/users/${user.id}/follow`, { method: 'POST' });
      const b = document.getElementById('followBtn');
      b.className = 'btn small ' + (d.following ? 'ghost' : '');
      b.textContent = d.following ? '✓ Abonné' : '+ Suivre ce chef';
      toast(d.following ? 'Tu suis maintenant ' + user.username : 'Désabonné');
    };
  }

  const rr = document.getElementById('userRecipes');
  const fill = (recipes) => {
    rr.innerHTML = recipes.length ? recipes.map(recipeCard).join('')
      : `<div class="empty"><div class="big">🍽️</div><p>Aucune recette publiée.</p></div>`;
    wireRecipeCards(rr);
  };
  if (extra && extra.recipes) fill(extra.recipes);
  else api(`/recipes?author=${user.id}`).then((d) => fill(d.recipes)).catch(() => fill([]));
}

async function showHistory() {
  try {
    const { events } = await api('/points/history');
    showModal(`<div class="mic">📜</div><h3 class="serif">Historique des points</h3>
      <div style="max-height:50vh;overflow:auto;text-align:left;margin:14px 0">
        ${events.length ? events.map((e) => `
          <div style="display:flex;justify-content:space-between;padding:9px 4px;border-bottom:1px solid var(--line)">
            <span style="font-size:.9rem">${esc(e.reason)}</span>
            <b style="color:${e.amount>=0?'var(--olive)':'var(--terracotta)'}">${e.amount>=0?'+':''}${e.amount}</b>
          </div>`).join('') : '<p class="muted">Rien pour l\'instant.</p>'}
      </div>
      <button class="btn" onclick="document.getElementById('modal').hidden=true">Fermer</button>`);
  } catch (err) { toast(err.message); }
}

/* ============================================================
   LEADERBOARD
   ============================================================ */
async function viewLeaderboard() {
  App.state.view = 'discover';
  shell(`
    <button class="back-btn" id="back">← Retour</button>
    <div class="section-title serif">Classement des chefs</div>
    <div class="card" id="lb"><div class="skeleton">Chargement…</div></div>`);
  document.getElementById('back').onclick = () => go('discover');
  try {
    const { users } = await api('/leaderboard');
    document.getElementById('lb').innerHTML = users.map((u) => `
      <div class="lb-row" data-user="${u.id}">
        <span class="lb-rank ${u.rank<=3?'top':''}">${u.rank<=3?['🥇','🥈','🥉'][u.rank-1]:u.rank}</span>
        <div class="mini-avatar">${u.avatar}</div>
        <div class="lb-name">${esc(u.username)}<div class="muted" style="font-size:.75rem;font-weight:600">${u.level.name}</div></div>
        <span class="lb-pts">${u.points} pts</span>
      </div>`).join('');
    document.querySelectorAll('#lb [data-user]').forEach((e) => e.onclick = () => go('user', e.dataset.user));
  } catch (err) { toast(err.message); }
}

/* ============================================================
   NOTIFICATIONS
   ============================================================ */
const NOTIF_ICON = { like: icon('heart',{filled:true}), comment: icon('comment'), follow: icon('userplus'), challenge: icon('trophy') };
async function viewNotifications() {
  App.state.view = '';
  shell(`
    <div class="section-title serif">Notifications</div>
    <div id="notifList"><div class="skeleton">Chargement…</div></div>`);
  try {
    const { notifications } = await api('/notifications');
    const list = document.getElementById('notifList');
    list.innerHTML = notifications.length ? notifications.map((n) => `
      <div class="card notif ${n.is_read?'':'unread'}" ${n.recipe_id?`data-open="${n.recipe_id}"`:''}>
        <div class="notif-ic">${NOTIF_ICON[n.type] || icon('bell')}</div>
        <div class="notif-body"><div class="notif-text">${esc(n.text)}</div>
          <div class="when">${timeAgo(n.created_at)}</div></div>
        ${n.is_read?'':'<span class="notif-dot"></span>'}
      </div>`).join('')
      : `<div class="empty"><div class="big">🔕</div><p>Aucune notification pour l'instant.<br>Publie, like et échange pour animer la communauté.</p></div>`;
    list.querySelectorAll('[data-open]').forEach((e) => e.onclick = () => go('recipe', e.dataset.open));
    // Marque tout comme lu
    await api('/notifications/read', { method: 'POST' });
    updateBell();
  } catch (err) { toast(err.message); }
}

/* ============================================================
   BOOKMARKS / FAVORIS
   ============================================================ */
async function viewBookmarks() {
  App.state.view = '';
  shell(`
    <button class="back-btn" id="back">← Retour</button>
    <div class="section-title serif">Mon carnet de recettes</div>
    <p class="muted" style="margin-bottom:12px">Les recettes que tu as enregistrées pour les cuisiner plus tard.</p>
    <div id="bmList">${skeletonCards(2)}</div>`);
  document.getElementById('back').onclick = () => go('profile');
  try {
    const { recipes } = await api('/bookmarks');
    const list = document.getElementById('bmList');
    list.innerHTML = recipes.length ? recipes.map(recipeCard).join('')
      : `<div class="empty"><div class="big">📑</div><p>Ton carnet est vide.<br>Touche « Enregistrer » sur une recette pour la retrouver ici.</p></div>`;
    wireRecipeCards(list);
  } catch (err) { toast(err.message); }
}

/* ============================================================
   THÈME (clair / sombre)
   ============================================================ */
function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}
function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('cuistot_theme', next);
  toast(next === 'dark' ? 'Mode sombre activé' : 'Mode clair activé');
  const tb = document.getElementById('themeBtn');
  if (tb) tb.textContent = next === 'dark' ? 'Basculer en mode clair' : 'Basculer en mode sombre';
}
applyTheme(localStorage.getItem('cuistot_theme') || 'dark');

// Enregistre le service worker pour l'installation mobile (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/* ============================================================
   BOOT
   ============================================================ */
(async function boot() {
  const t = localStorage.getItem('cuistot_token');
  if (t) {
    App.state.token = t;
    try { await refreshMe(); go('feed'); return; }
    catch { localStorage.removeItem('cuistot_token'); }
  }
  renderAuth('login');
})();
