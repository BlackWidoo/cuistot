// Configuration ESLint (flat config, ESLint 9+). Le projet n'a pas de bundler — scripts
// classiques côté front, require() côté serveur — donc pas de sourceType 'module' ici, et
// les globals sont listés à la main plutôt que via le paquet "globals" (une dépendance de
// moins à installer sans npm disponible en local pour vérifier que tout s'installe bien).
'use strict';

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly', // global Node >= 18, utilisé dans test/*.js (et disponible partout côté serveur)
};

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  location: 'readonly',
  history: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  Image: 'readonly',
  Notification: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
};

const serviceWorkerGlobals = {
  self: 'readonly',
  caches: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  URL: 'readonly',
};

// Règles core ESLint uniquement (aucun plugin/preset externe requis) : on vise les vraies
// fautes (variable non définie, redéclaration, code mort) plutôt que du style — le style est
// du ressort de Prettier, pas d'ESLint, dans cette config.
const baseRules = {
  'no-undef': 'error',
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-const-assign': 'error',
  'no-unreachable': 'error',
  'no-unsafe-negation': 'error',
  'no-fallthrough': 'error',
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
};

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    files: [
      'server.js',
      'db.js',
      'gamification.js',
      'seed-core.js',
      'config.js',
      'bootstrap.js',
      'eslint.config.js',
      'test/**/*.js',
      'middleware/**/*.js',
      'services/**/*.js',
      'schemas/**/*.js',
      'routes/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: baseRules,
  },
  {
    files: ['app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: baseRules,
  },
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: serviceWorkerGlobals,
    },
    rules: baseRules,
  },
];
