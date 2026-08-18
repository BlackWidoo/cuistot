/* Cuistot — SPA front-end (vanilla JS) */
'use strict';

const App = {
  el: document.getElementById('app'),
  state: { user: null, badges: [], view: 'feed' },
};

/* ---------- API helper ---------- */
// La session repose uniquement sur le cookie httpOnly posé par le serveur (pas de jeton
// en localStorage : ça évite qu'un script malveillant puisse le lire et voler la session).
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
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
// Illustrations de plat proposées à la publication (clé d'icône SVG, stockée telle quelle en base)
const FOOD_ICONS = ['plate','pot','pasta','bowl','salad','pizza','taco','burger','pan','croissant','pancake','cake','cupcake','donut','icecream','drink'];
// Icônes proposées comme avatar de profil (doit rester en phase avec server.js)
const AVATAR_ICONS_FREE = ['pan','leaf','flame','user','coffee','sun','moon','fish','bolt','heart'];
// Icône -> clé du badge qu'il faut avoir débloqué pour y accéder (voir gamification.js)
const AVATAR_UNLOCKS = { star: 'star', users: 'popular', medal: 'challenger', crown: 'legend', book: 'prolific' };
const AVATAR_COLORS = ['cream','terracotta','gold','olive','berry','teal'];
// Rendu d'une icône décorative (illustration de plat, badge, récompense...) : repli discret si la clé est inconnue
function glyph(key, size) {
  return `<span class="glyph"${size?` style="font-size:${size}"`:''}>${icon(key) || icon('plate')}</span>`;
}

// Rendu d'un avatar : icône blanche sur un fond de la couleur choisie par l'utilisateur
function avatarGlyph(key, color) {
  const bg = AVATAR_COLORS.includes(color) ? `var(--av-${color})` : 'var(--av-cream)';
  return `<span class="glyph avatar-glyph" style="background:${bg}">${icon(key) || icon('user')}</span>`;
}

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
  // Marque / avatars
  pan: '<circle cx="11" cy="13" r="7.5"/><path d="M18.5 9.5 22 7.5"/><circle cx="11" cy="13" r="2.4" fill="currentColor" stroke="none"/>',
  leaf: '<path d="M4 20c0-9.5 5.5-16 16-16-1 10.5-6.5 17-16 16Z"/><path d="M6 18C10 14 14 10 17 5"/>',
  flame: '<path d="M12 21c-4 0-7-2.8-7-6.5C5 9.8 8 6.5 9 3.5c.4 2.3 1.6 3.4 2.6 3.2C13 6.4 11.8 4 13 2.5c3.3 2.7 6 7 6 12 0 3.7-3 6.5-7 6.5Z"/><path d="M12 21c-1.8 0-3.2-1.3-3.2-3.2 0-1.6 1-2.7 1.8-3.9.4.9 1 1.3 1.4 1.3.7 0 .6-1.1 1-1.6 1.1 1.1 2.2 2.5 2.2 4.2 0 1.9-1.4 3.2-3.2 3.2Z"/>',
  // Badges / récompenses / défis
  star: '<path d="M12 3.3l2.6 5.5 6 .6-4.5 4 1.3 5.9-5.4-3.2-5.4 3.2 1.3-5.9-4.5-4 6-.6L12 3.3Z"/>',
  users: '<circle cx="8.5" cy="8.5" r="3.2"/><path d="M2.5 20c1-3.6 3.2-5.5 6-5.5s5 1.9 6 5.5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15 14.3c2.5.2 4.3 2 5.2 5.2"/>',
  medal: '<circle cx="12" cy="15" r="5.5"/><path d="M9 9.5 6.5 3h3L12 8l2.5-5h3L15 9.5"/>',
  crown: '<path d="M4 17h16l-1.3-7.3-3.7 3-3-5.5-3 5.5-3.7-3L4 17Z"/><path d="M6 20h12"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 1 5 18.5v-14Z"/><path d="M5 18.5A1.5 1.5 0 0 1 6.5 17H20"/>',
  palette: '<path d="M12 3a9 8 0 1 0 0 16c1.1 0 2-.8 2-1.9 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-3-3.6-5-9-5Z"/><path d="M7.5 11h.01M9.5 7.5h.01M14.5 7h.01" stroke-width="2.6"/>',
  scroll: '<path d="M6 4h11a2 2 0 0 1 2 2v11a2.5 2.5 0 0 1-2.5 2.5H8"/><path d="M6 4a2 2 0 0 0-2 2v11a2.5 2.5 0 0 0 2.5 2.5H8a2 2 0 0 1-2-2V4Z"/><path d="M9 8h7M9 11.5h7"/>',
  rocket: '<path d="M12 3c3 1.5 5 4.8 5 8.6 0 2-.8 4-1.8 5l-1-2h-4.4l-1 2c-1-1-1.8-3-1.8-5C7 7.8 9 4.5 12 3Z"/><circle cx="12" cy="10.3" r="1.5"/><path d="M9 16.3l-1.8 3.7 3.6-1.4M15 16.3l1.8 3.7-3.6-1.4"/>',
  cart: '<path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.8h7.6a2 2 0 0 0 2-1.6L20.5 8H6"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  // Petites icônes utilitaires
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v4.8l3.3 2"/>',
  tag: '<path d="M11 3h6a2 2 0 0 1 2 2v6a2 2 0 0 1-.6 1.4l-8 8a2 2 0 0 1-2.8 0l-5-5a2 2 0 0 1 0-2.8l8-8A2 2 0 0 1 11 3Z"/><path d="M15.5 8.5h.01"/>',
  gauge: '<path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 15 16 10"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.4"/>',
  trash: '<path d="M5 7h14"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 9V6.5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1V9"/><path d="M12 5.5v14.5"/><path d="M12 5.5c-.7-2.6-5-2.6-5 .3 0 1.3 1.1 1.7 2.4 1.7H12Z"/><path d="M12 5.5c.7-2.6 5-2.6 5 .3 0 1.3-1.1 1.7-2.4 1.7H12Z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.6 2.6L16 9.3"/>',
  // Illustrations de plats (choix à la publication d\'une recette)
  plate: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.3"/>',
  pot: '<path d="M4 11h16v3.5a5.5 5.5 0 0 1-5.5 5.5h-5A5.5 5.5 0 0 1 4 14.5V11Z"/><path d="M2 11h20"/><path d="M8 11V8M16 11V8"/><path d="M7.2 5.3c1-1 2-1 3 0M13.8 5.3c1-1 2-1 3 0"/>',
  pasta: '<path d="M3.3 12h17.4a7.5 6.5 0 0 1-8.7 6.5A7.5 6.5 0 0 1 3.3 12Z"/><path d="M8 12c0-2.3 1-4.2 2.5-4.8M12 12c0-2.8 1.1-5 2.9-6M16 12c0-2 .8-3.6 2-4.6"/>',
  bowl: '<path d="M3.3 12h17.4a7.5 6.5 0 0 1-8.7 6.5A7.5 6.5 0 0 1 3.3 12Z"/><path d="M6.2 12a5.8 4.8 0 0 1 11.6 0"/>',
  salad: '<path d="M3.3 13h17.4a7.5 6 0 0 1-8.7 6A7.5 6 0 0 1 3.3 13Z"/><path d="M8 13c0-2.5 1.8-4.3 4-4.3s4 1.8 4 4.3"/><path d="M12 8.7V5.2"/><path d="M9.3 6.2 10.8 8M14.7 6.2 13.2 8"/>',
  pizza: '<path d="M12 4 4.3 19.6a19 19 0 0 0 15.4 0L12 4Z"/><path d="M9 19a12 12 0 0 1 6 0"/><circle cx="12" cy="12.5" r="1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="16" r="1" fill="currentColor" stroke="none"/>',
  taco: '<path d="M3 12a9 9 0 0 1 18 0"/><path d="M3 12c0 4 4 6.5 9 6.5s9-2.5 9-6.5"/><path d="M7.2 12v2.6M12 12v3.5M16.8 12v2.6"/>',
  burger: '<path d="M4 10a8 4 0 0 1 16 0Z"/><path d="M3.3 12h17.4"/><path d="M4 15.3h16"/><path d="M4.5 15.3c0 2 3.1 3.5 7.5 3.5s7.5-1.5 7.5-3.5"/>',
  cake: '<path d="M4 20 12 4l8 16Z"/><path d="M8 12.2h8M6.5 16h11"/>',
  cupcake: '<path d="M6 10h12l-1.3 8.6a1.5 1.5 0 0 1-1.5 1.4H8.8a1.5 1.5 0 0 1-1.5-1.4L6 10Z"/><path d="M6 10a3 3 0 0 1 0-6c1 0 1.8.5 2.3 1.3A3 3 0 0 1 12 4a3 3 0 0 1 3.7 1.3C16.2 4.5 17 4 18 4a3 3 0 0 1 0 6"/>',
  pancake: '<ellipse cx="12" cy="7.5" rx="6.5" ry="2"/><ellipse cx="12" cy="11.3" rx="6.5" ry="2"/><ellipse cx="12" cy="15.1" rx="6.5" ry="2"/><path d="M15.5 15.1c1.3-.1 2-.9 2-1.8"/>',
  croissant: '<path d="M6 12c0-5.2 3.5-8.7 8-8.7-2 1.6-3 4.1-3 8.7s1 7.1 3 8.7c-4.5 0-8-3.5-8-8.7Z"/>',
  donut: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>',
  icecream: '<path d="M8 11a4 4 0 0 1 8 0v.4H8V11Z"/><path d="M9 12.4l2.2 8a1 1 0 0 0 1.7 0l2.1-8"/>',
  drink: '<path d="M7 3h10l-1.2 15a2 2 0 0 1-2 1.8h-3.6a2 2 0 0 1-2-1.8L7 3Z"/><path d="M6 7h12"/>',
  chocolate: '<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M4 12h16M9.3 6v12M14.7 6v12"/>',
  // Avatars supplémentaires
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4.3"/><path d="M12 2.5v2.6M12 18.9v2.6M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2.5 12h2.6M18.9 12h2.6M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  coffee: '<path d="M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c.8.8.8 1.7 0 2.5M12 3.5c.8.8.8 1.7 0 2.5"/>',
  fish: '<path d="M3 12c3-4 8-6 13-4 2 .8 4 2.3 5 4-1 1.7-3 3.2-5 4-5 2-10 0-13-4Z"/><path d="M17 9.5 20 7v10l-3-2.5"/><circle cx="7.5" cy="11.3" r=".8" fill="currentColor" stroke="none"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
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
        <div class="big">${icon('pan')}</div>
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
        ${tab==='login' ? `<button class="link-btn" id="forgotBtn">Mot de passe oublié ?</button>` : ''}
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
      App.state.user = data.user;
      await refreshMe();
      toast('Bienvenue ' + data.user.username, true);
      go('feed');
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = tab === 'login' ? 'Se connecter' : 'Créer mon compte';
    }
  };

  const forgotBtn = document.getElementById('forgotBtn');
  if (forgotBtn) forgotBtn.onclick = renderForgotPassword;
}

/* ---------- Mot de passe oublié ---------- */
function renderForgotPassword() {
  App.el.innerHTML = `
    <div class="auth">
      <div class="auth-hero">
        <div class="big">${icon('scroll')}</div>
        <h1>Mot de passe oublié</h1>
        <p>Indique ton email : si un compte existe, un lien de réinitialisation est envoyé.</p>
      </div>
      <div class="auth-card">
        <form id="forgotForm">
          <div class="field"><label>Email</label><input name="email" type="email" required placeholder="toi@exemple.fr" autocomplete="email"></div>
          <button class="btn" type="submit">Envoyer le lien</button>
        </form>
        <button class="link-btn" id="backToLogin">← Retour à la connexion</button>
      </div>
    </div>`;
  document.getElementById('backToLogin').onclick = () => renderAuth('login');
  document.getElementById('forgotForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = '…';
    try {
      const d = await api('/forgot-password', { method: 'POST', body: { email } });
      toast('Si ce compte existe, un lien vient d\'être envoyé.', true);
      // En développement (pas de fournisseur d'email branché), le lien est aussi loggé
      // côté serveur ; ce champ ne sera jamais présent en production.
      if (d.devToken) console.log('Lien de réinitialisation (dev) :', `${location.origin}/?reset=${d.devToken}`);
      renderAuth('login');
    } catch (err) {
      toast(err.message);
      btn.disabled = false; btn.textContent = 'Envoyer le lien';
    }
  };
}

/* ---------- Réinitialisation du mot de passe (arrivée via /?reset=token) ---------- */
function renderResetPassword(token) {
  App.el.innerHTML = `
    <div class="auth">
      <div class="auth-hero">
        <div class="big">${icon('pan')}</div>
        <h1>Nouveau mot de passe</h1>
        <p>Choisis un nouveau mot de passe pour ton compte Cuistot.</p>
      </div>
      <div class="auth-card">
        <form id="resetForm">
          <div class="field"><label>Nouveau mot de passe</label><input name="password" type="password" required placeholder="••••••" autocomplete="new-password" minlength="6"></div>
          <button class="btn" type="submit">Valider</button>
        </form>
      </div>
    </div>`;
  document.getElementById('resetForm').onsubmit = async (e) => {
    e.preventDefault();
    const password = e.target.password.value;
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = '…';
    try {
      await api('/reset-password', { method: 'POST', body: { token, password } });
      history.replaceState(null, '', location.pathname);
      toast('Mot de passe mis à jour, connecte-toi !', true);
      renderAuth('login');
    } catch (err) {
      toast(err.message);
      btn.disabled = false; btn.textContent = 'Valider';
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
      <div class="logo"><span class="dot">${icon('pan')}</span><span class="wordmark">Cuistot</span></div>
      <div class="spacer"></div>
      <button class="points-pill" data-go="rewards">${u.points} pts</button>
      <button class="bell-btn" data-go="notifications">${icon('bell')}<span class="bell-badge" id="bellBadge" hidden>0</span></button>
      <button class="avatar-btn" data-go="profile">${avatarGlyph(u.avatar, u.avatar_color)}</button>
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
      <div class="mini-avatar" data-user="${r.author.id}">${avatarGlyph(r.author.avatar, r.author.avatar_color)}</div>
      <div class="who" data-user="${r.author.id}">${esc(r.author.username)}</div>
      <span class="cat-tag">${esc(r.category)}</span>
    </div>
    <div class="recipe-cover ${r.photo?'has-photo':''}" data-open="${r.id}" style="${coverStyle(r.category)}">
      ${r.photo ? `<img class="cover-img" src="${esc(r.photo)}" alt="${esc(r.title)}" loading="lazy" onerror="this.closest('.recipe-cover').classList.remove('has-photo');this.remove()">` : glyph(r.image)}
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
      ${r.photo ? `<img class="cover-img" src="${esc(r.photo)}" alt="${esc(r.title)}" loading="lazy" onerror="this.closest('.swipe-media').classList.remove('has-photo');this.remove()">` : `<div class="swipe-emoji">${glyph(r.image)}</div>`}
    </div>
    <div class="swipe-rail">
      <button class="act rail-act like ${r.liked?'liked':''}" data-like="${r.id}"><span class="ic">${icon('heart',{filled:r.liked})}</span><span class="cnt">${r.likes}</span></button>
      <button class="act rail-act" data-open="${r.id}"><span class="ic">${icon('comment')}</span><span class="cnt">${r.comments}</span></button>
      <button class="act rail-act bm ${r.bookmarked?'saved':''}" data-bm="${r.id}"><span class="ic">${icon('bookmark',{filled:r.bookmarked})}</span></button>
    </div>
    <div class="swipe-info" data-open="${r.id}">
      <div class="swipe-head">
        <span class="mini-avatar" data-user="${r.author.id}">${avatarGlyph(r.author.avatar, r.author.avatar_color)}</span>
        <span class="who" data-user="${r.author.id}">${esc(r.author.username)}</span>
        <span class="cat-tag">${esc(r.category)}</span>
      </div>
      <h3>${esc(r.title)}</h3>
      <p class="desc">${esc(r.description)}</p>
      <div class="meta-row"><span>${icon('clock')} ${r.prep_minutes} min</span><span>${icon('users')} ${r.servings} pers.</span></div>
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

  let basePath = '/recipes';
  if (mode === 'feed') basePath += '?feed=1';
  if (mode === 'popular') basePath += (basePath.includes('?') ? '&' : '?') + 'sort=popular';
  const LIMIT = 10;
  let offset = 0, hasMore = true, loading = false;
  const list = document.getElementById('feedList');

  const loadMore = async () => {
    if (loading || !hasMore) return;
    loading = true;
    try {
      const sep = basePath.includes('?') ? '&' : '?';
      const { recipes, hasMore: more } = await api(`${basePath}${sep}limit=${LIMIT}&offset=${offset}`);
      if (offset === 0 && !recipes.length) {
        list.innerHTML = mode === 'feed'
          ? `<div class="empty swipe-empty"><div class="big">${icon('plate')}</div><p>Suis des chefs pour voir leurs recettes ici.</p></div>`
          : `<div class="empty swipe-empty"><div class="big">${icon('plate')}</div><p>Aucune recette pour l'instant.</p></div>`;
        hasMore = false;
        return;
      }
      if (offset === 0) list.innerHTML = recipes.map(swipeSlide).join('');
      else list.insertAdjacentHTML('beforeend', recipes.map(swipeSlide).join(''));
      wireRecipeCards(list);
      offset += recipes.length;
      hasMore = more;
    } catch (err) { toast(err.message); }
    finally { loading = false; }
  };

  await loadMore();
  list.onscroll = () => {
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - list.clientHeight) loadMore();
  };
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
    <div id="discoverList"></div>
    <div style="text-align:center"><button class="btn ghost small" id="loadMoreBtn" hidden style="margin-top:4px">Charger plus</button></div>`);

  let cat = 'Tout', q = preset, offset = 0, hasMore = false;
  const LIMIT = 15;
  const moreBtn = document.getElementById('loadMoreBtn');
  const run = async () => {
    const list = document.getElementById('discoverList');
    list.innerHTML = skeletonCards(3);
    offset = 0; moreBtn.hidden = true;
    let path = `/recipes?sort=trending`;
    if (cat !== 'Tout') path += `&category=${encodeURIComponent(cat)}`;
    if (q) path += `&q=${encodeURIComponent(q)}`;
    try {
      const { recipes, hasMore: more } = await api(`${path}&limit=${LIMIT}&offset=0`);
      list.innerHTML = recipes.length
        ? recipes.map(recipeCard).join('')
        : `<div class="empty"><div class="big">${icon('search')}</div><p>Rien trouvé. Essaie un autre mot-clé.</p></div>`;
      wireRecipeCards(list);
      offset = recipes.length; hasMore = more;
      moreBtn.hidden = !hasMore;
    } catch (err) { toast(err.message); }
  };
  moreBtn.onclick = async () => {
    let path = `/recipes?sort=trending`;
    if (cat !== 'Tout') path += `&category=${encodeURIComponent(cat)}`;
    if (q) path += `&q=${encodeURIComponent(q)}`;
    moreBtn.textContent = '…';
    try {
      const { recipes, hasMore: more } = await api(`${path}&limit=${LIMIT}&offset=${offset}`);
      const list = document.getElementById('discoverList');
      list.insertAdjacentHTML('beforeend', recipes.map(recipeCard).join(''));
      wireRecipeCards(list);
      offset += recipes.length; hasMore = more;
      moreBtn.hidden = !hasMore;
    } catch (err) { toast(err.message); }
    finally { moreBtn.textContent = 'Charger plus'; }
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
              <div class="pe-ic">${icon('camera')}</div>
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
            ${FOOD_ICONS.map((k,i)=>`<button type="button" class="${(isEdit?k===edit.image:i===0)?'sel':''}" data-icon="${k}">${icon(k)}</button>`).join('')}
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

  let dishIcon = isEdit ? edit.image : FOOD_ICONS[0];
  document.querySelectorAll('#emojiPick button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('#emojiPick button').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel'); dishIcon = b.dataset.icon;
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
    emptyEl.innerHTML = `<div class="pe-ic">${icon('camera')}</div><div>Compression…</div>`;
    try {
      const data = await resizeImage(file, 1280, 0.82);
      showPhoto(data);
      haptic();
    } catch { toast('Impossible de lire cette image'); emptyEl.innerHTML = `<div class="pe-ic">${icon('camera')}</div><div>Ajoute une photo depuis ta pellicule</div>`; }
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
      image: dishIcon, photo: photoData, ingredients, steps, tags,
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
        <div class="detail-cover ${r.photo?'has-photo':''}" style="${coverStyle(r.category)}">${r.photo ? `<img class="cover-img" src="${esc(r.photo)}" alt="${esc(r.title)}" onerror="this.closest('.detail-cover').classList.remove('has-photo');this.remove()">` : glyph(r.image)}</div>
        <div style="padding:16px">
          <div class="recipe-head" style="padding:0 0 12px">
            <div class="mini-avatar" data-user="${r.author.id}">${avatarGlyph(r.author.avatar, r.author.avatar_color)}</div>
            <div><div class="who" data-user="${r.author.id}">${esc(r.author.username)}</div>
              <div class="when">${timeAgo(r.created_at)}</div></div>
          </div>
          <h2 class="serif" style="font-size:1.8rem">${esc(r.title)}</h2>
          <div class="meta-row" style="margin:10px 0">
            <span>${icon('tag')} ${esc(r.category)}</span><span>${icon('gauge')} ${esc(r.difficulty)}</span>
            <span>${icon('clock')} ${r.prep_minutes} min</span><span>${icon('users')} ${r.servings} pers.</span>
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
        showModal(`<div class="mic">${icon('trash')}</div><h3 class="serif">Supprimer cette recette ?</h3>
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
  return `<div class="comment"><div class="mini-avatar">${avatarGlyph(c.avatar, c.avatar_color)}</div>
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
          <div class="ch-ic">${glyph(ch.icon)}</div>
          <div style="flex:1">
            <h4>${esc(ch.title)}</h4>
            <div class="ch-desc">${esc(ch.description)}</div>
          </div>
        </div>
        <div class="ch-foot">
          <span class="reward-pts">+${ch.reward_pts} pts</span>
          ${ch.joined
            ? `<span class="joined-badge">${icon('check')} Validé</span>`
            : `<button class="btn tiny gold" data-tag="${esc(ch.tag)}">Participer</button>`}
        </div>
        <div class="muted" style="font-size:.78rem;margin-top:8px">
          ${icon('users')} ${ch.participants} participant${ch.participants>1?'s':''} · Se termine le ${new Date(ch.ends_at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'})}
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
        <div class="ric">${glyph(r.icon)}</div>
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
        showModal(`<div class="mic">${icon('gift')}</div><h3 class="serif">Récompense débloquée</h3>
          <p class="muted">Voici ton code à conserver :</p>
          <div class="code">${d.code}</div>
          <button class="btn" onclick="document.getElementById('modal').hidden=true">Fermer</button>`);
        viewRewards();
      } catch (err) { toast(err.message); }
    });

    document.getElementById('redeemed').innerHTML = redeemed.length ? `
      <div class="section-title serif" style="font-size:1.2rem">Mes récompenses</div>
      ${redeemed.map((r) => `<div class="card reward"><div class="ric">${glyph(r.icon)}</div>
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
      ${isSelf
        ? `<button class="profile-avatar editable" id="avatarBtn" title="Changer d'avatar">${avatarGlyph(user.avatar, user.avatar_color)}<span class="avatar-edit">${icon('camera')}</span></button>`
        : `<div class="profile-avatar">${avatarGlyph(user.avatar, user.avatar_color)}</div>`}
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
        <div class="ic">${glyph(b.icon)}</div><div class="nm">${esc(b.name)}</div></div>`).join('')}
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
    document.getElementById('logout2').onclick = async () => {
      try { await api('/logout', { method: 'POST' }); } catch {}
      App.state = { user: null, badges: [], view: 'feed' };
      renderAuth('login');
    };
    document.getElementById('histBtn').onclick = showHistory;
    const tb = document.getElementById('themeBtn');
    tb.textContent = document.documentElement.dataset.theme === 'dark' ? 'Basculer en mode clair' : 'Basculer en mode sombre';
    tb.onclick = toggleTheme;
    document.getElementById('avatarBtn').onclick = () => {
      const unlockedBadges = new Set(badges.filter((b) => b.unlocked).map((b) => b.key));
      const isLocked = (k) => AVATAR_UNLOCKS[k] && !unlockedBadges.has(AVATAR_UNLOCKS[k]);
      const allIcons = [...AVATAR_ICONS_FREE, ...Object.keys(AVATAR_UNLOCKS)];
      showModal(`<h3 class="serif">Choisis ton avatar</h3>
        <div class="emoji-pick" id="avatarPick" style="justify-content:center;margin-top:14px">
          ${allIcons.map((k) => {
            const locked = isLocked(k);
            return `<button type="button" class="${k===user.avatar?'sel':''} ${locked?'locked':''}" data-icon="${k}" data-locked="${locked}">
              ${icon(k)}${locked ? `<span class="lock-badge">${icon('lock')}</span>` : ''}
            </button>`;
          }).join('')}
        </div>
        <h3 class="serif" style="font-size:1.1rem;margin-top:18px">Couleur du fond</h3>
        <div class="color-pick" id="colorPick">
          ${AVATAR_COLORS.map((c) => `<button type="button" class="${c===user.avatar_color?'sel':''}" data-color="${c}" style="background:var(--av-${c})"></button>`).join('')}
        </div>`);
      document.querySelectorAll('#avatarPick button').forEach((b) => b.onclick = async () => {
        if (b.dataset.locked === 'true') {
          const badgeKey = AVATAR_UNLOCKS[b.dataset.icon];
          const badge = badges.find((x) => x.key === badgeKey);
          toast(badge ? `Débloque-le : ${badge.desc}` : 'Avatar pas encore débloqué');
          return;
        }
        try {
          const d = await api('/me', { method: 'PATCH', body: { avatar: b.dataset.icon } });
          App.state.user.avatar = d.user.avatar;
          closeModal();
          renderProfile(App.state.user, App.state.badges, null, true);
        } catch (err) { toast(err.message); }
      });
      document.querySelectorAll('#colorPick button').forEach((b) => b.onclick = async () => {
        try {
          const d = await api('/me', { method: 'PATCH', body: { avatar_color: b.dataset.color } });
          App.state.user.avatar_color = d.user.avatar_color;
          closeModal();
          renderProfile(App.state.user, App.state.badges, null, true);
        } catch (err) { toast(err.message); }
      });
    };
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
      : `<div class="empty"><div class="big">${icon('plate')}</div><p>Aucune recette publiée.</p></div>`;
    wireRecipeCards(rr);
  };
  if (extra && extra.recipes) fill(extra.recipes);
  else api(`/recipes?author=${user.id}`).then((d) => fill(d.recipes)).catch(() => fill([]));
}

async function showHistory() {
  try {
    const { events } = await api('/points/history');
    showModal(`<div class="mic">${icon('scroll')}</div><h3 class="serif">Historique des points</h3>
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
        <span class="lb-rank ${u.rank<=3?'top':''}">${u.rank<=3?`<span style="color:${['#e5a54b','#b9c0c6','#c98a4b'][u.rank-1]}">${icon('medal')}</span>`:u.rank}</span>
        <div class="mini-avatar">${avatarGlyph(u.avatar, u.avatar_color)}</div>
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
      : `<div class="empty"><div class="big">${icon('bell')}</div><p>Aucune notification pour l'instant.<br>Publie, like et échange pour animer la communauté.</p></div>`;
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
      : `<div class="empty"><div class="big">${icon('bookmark')}</div><p>Ton carnet est vide.<br>Touche « Enregistrer » sur une recette pour la retrouver ici.</p></div>`;
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
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) { renderResetPassword(resetToken); return; }
  try { await refreshMe(); } catch {}
  if (App.state.user) { go('feed'); return; }
  renderAuth('login');
})();
