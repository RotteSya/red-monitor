const DEFAULT_THRESHOLDS = { trending: 100, viral: 500 };
const DEFAULT_COLUMNS = [
  { id: 'rank', visible: true },
  { id: 'icon', visible: true },
  { id: 'author', visible: false },
  { id: 'preview', visible: true },
  { id: 'heat', visible: true },
  { id: 'velocity', visible: true },
];
const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: true,
  featureCopyAsMarkdown: true,
  badgeStyle: 'pill-solid',
  leaderboardCount: 10,
  leaderboardColumns: DEFAULT_COLUMNS,
  language: 'auto',
  theme: 'system',
};
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };
const SUPPORTED_LANGUAGE_IDS = ['auto', 'zh_CN', 'en', 'ja'];
const THEME_ORDER = ['light', 'dark', 'system'];
const COLUMN_LABEL_KEYS = {
  rank: 'columnRank',
  icon: 'columnIcon',
  author: 'columnAuthor',
  preview: 'columnPreview',
  heat: 'columnHeat',
  velocity: 'columnVelocity',
};

const form = document.getElementById('settings-form');
const trendingInput = document.getElementById('trending');
const viralInput = document.getElementById('viral');
const badgeStyleSelect = document.getElementById('badge-style');
const copyMdToggle = document.getElementById('feat-copy-md');
const leaderboardToggle = document.getElementById('feat-leaderboard');
const leaderboardCountInput = document.getElementById('lb-count');
const languageSelect = document.getElementById('language-select');
const colListEl = document.getElementById('lb-col-list');
const resetBtn = document.getElementById('reset');
const statusEl = document.getElementById('status');
const lbResetBtn = document.getElementById('lb-reset-pos');
const lbResetMsg = document.getElementById('lb-reset-msg');
const themeToggle = document.getElementById('theme-toggle');
const versionEl = document.getElementById('popup-version');

let localeBundle = null;
let currentLanguage = 'auto';
let currentTheme = 'system';
let columnsState = DEFAULT_COLUMNS.map((col) => ({ ...col }));

function normalizeLanguage(raw) {
  return SUPPORTED_LANGUAGE_IDS.includes(raw) ? raw : 'auto';
}

function getBrowserLocaleId() {
  try {
    const ui = chrome?.i18n?.getUILanguage?.() || navigator.language || '';
    const lower = ui.toLowerCase();
    if (lower.startsWith('zh')) return 'zh_CN';
    if (lower.startsWith('ja')) return 'ja';
  } catch (_) {}
  return 'en';
}

function getEffectiveLanguageId(pref = currentLanguage) {
  const normalized = normalizeLanguage(pref);
  return normalized === 'auto' ? getBrowserLocaleId() : normalized;
}

function formatLocaleMessage(entry, substitutions) {
  if (!entry?.message) return '';
  const subs = substitutions == null ? [] : (Array.isArray(substitutions) ? substitutions.map(String) : [String(substitutions)]);
  let message = String(entry.message).replace(/\$\$/g, '\u0000');
  const placeholders = entry.placeholders || {};
  for (const [name, meta] of Object.entries(placeholders)) {
    const match = String(meta?.content || '').match(/^\$(\d+)$/);
    const value = match ? (subs[Number(match[1]) - 1] ?? '') : String(meta?.content || '');
    message = message.replace(new RegExp(`\\$${name}\\$`, 'gi'), value);
  }
  message = message.replace(/\$(\d+)/g, (_, n) => subs[Number(n) - 1] ?? '');
  return message.replace(/\u0000/g, '$');
}

async function loadLocaleBundle(language) {
  const effective = getEffectiveLanguageId(language);
  if (normalizeLanguage(language) === 'auto') {
    localeBundle = null;
    return;
  }
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${effective}/messages.json`));
    localeBundle = res.ok ? await res.json() : null;
  } catch (_) {
    localeBundle = null;
  }
}

function t(key, substitutions) {
  const local = formatLocaleMessage(localeBundle?.[key], substitutions);
  if (local) return local;
  try { return chrome.i18n.getMessage(key, substitutions) || key; }
  catch (_) { return key; }
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const msg = t(el.dataset.i18nTitle);
    if (msg) {
      el.title = msg;
      el.setAttribute('aria-label', msg);
    }
  });
  document.documentElement.lang = getEffectiveLanguageId(currentLanguage).replace('_', '-');
}

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (_) {
    return 'light';
  }
}

function applyTheme(pref) {
  currentTheme = THEME_ORDER.includes(pref) ? pref : 'system';
  document.body.dataset.theme = resolveTheme(currentTheme);
  document.body.dataset.themePref = currentTheme;
  const use = themeToggle?.querySelector('use');
  if (use) {
    const icon = currentTheme === 'light' ? 'icon-sun' : currentTheme === 'dark' ? 'icon-moon' : 'icon-monitor';
    use.setAttribute('href', `#${icon}`);
  }
}

function normalizeThresholds(raw) {
  const trending = Number.parseInt(raw?.trending, 10);
  const viral = Number.parseInt(raw?.viral, 10);
  const next = {
    trending: Number.isFinite(trending) && trending > 0 ? trending : DEFAULT_THRESHOLDS.trending,
    viral: Number.isFinite(viral) && viral > 0 ? viral : DEFAULT_THRESHOLDS.viral,
  };
  if (next.viral <= next.trending) next.viral = Math.max(next.trending + 1, DEFAULT_THRESHOLDS.viral);
  return next;
}

function normalizeCount(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(50, n));
}

function normalizeColumns(raw) {
  if (!Array.isArray(raw)) return DEFAULT_COLUMNS.map((col) => ({ ...col }));
  const ids = DEFAULT_COLUMNS.map((col) => col.id);
  const seen = new Set();
  const out = [];
  for (const col of raw) {
    if (!col || typeof col.id !== 'string') continue;
    if (!ids.includes(col.id) || seen.has(col.id)) continue;
    seen.add(col.id);
    out.push({ id: col.id, visible: !!col.visible });
  }
  for (const col of DEFAULT_COLUMNS) {
    if (!seen.has(col.id)) out.push({ ...col });
  }
  return out;
}

function flash(message) {
  statusEl.textContent = message;
  clearTimeout(flash._timer);
  flash._timer = setTimeout(() => { statusEl.textContent = ''; }, 1800);
}

function renderColumns() {
  colListEl.textContent = '';
  for (const col of columnsState) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.textContent = t(COLUMN_LABEL_KEYS[col.id] || col.id);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!col.visible;
    checkbox.addEventListener('change', () => {
      col.visible = checkbox.checked;
      chrome.storage.sync.set({ leaderboardColumns: columnsState }, () => flash(t('flashColumnsSaved')));
    });
    li.append(label, checkbox);
    colListEl.appendChild(li);
  }
}

function setActiveTab(name) {
  document.querySelectorAll('[role="tab"][data-tab]').forEach((btn) => {
    btn.setAttribute('aria-selected', btn.dataset.tab === name ? 'true' : 'false');
  });
  document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
    panel.dataset.active = panel.dataset.tabPanel === name ? '1' : '0';
  });
  try { localStorage.setItem('rvm_popup_active_tab', name); } catch (_) {}
}

async function loadState() {
  chrome.storage.sync.get(STORAGE_DEFAULTS, async (items) => {
    currentLanguage = normalizeLanguage(items.language);
    await loadLocaleBundle(currentLanguage);
    applyI18n();

    const thresholds = normalizeThresholds(items);
    trendingInput.value = thresholds.trending;
    viralInput.value = thresholds.viral;
    badgeStyleSelect.value = items.badgeStyle === 'inline-classic' ? 'inline-classic' : 'pill-solid';
    copyMdToggle.checked = items.featureCopyAsMarkdown !== false;
    leaderboardToggle.checked = items.featureVelocityLeaderboard !== false;
    leaderboardCountInput.value = normalizeCount(items.leaderboardCount);
    languageSelect.value = currentLanguage;
    columnsState = normalizeColumns(items.leaderboardColumns);
    renderColumns();
    applyTheme(items.theme || 'system');
  });
}

document.querySelectorAll('[role="tab"][data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const thresholds = normalizeThresholds({ trending: trendingInput.value, viral: viralInput.value });
  trendingInput.value = thresholds.trending;
  viralInput.value = thresholds.viral;
  chrome.storage.sync.set({
    ...thresholds,
    badgeStyle: badgeStyleSelect.value === 'inline-classic' ? 'inline-classic' : 'pill-solid',
    featureCopyAsMarkdown: copyMdToggle.checked,
  }, () => flash(t('flashSaved')));
});

resetBtn.addEventListener('click', () => {
  chrome.storage.sync.set({
    ...DEFAULT_THRESHOLDS,
    badgeStyle: DEFAULT_FEATURES.badgeStyle,
    featureCopyAsMarkdown: DEFAULT_FEATURES.featureCopyAsMarkdown,
  }, () => {
    trendingInput.value = DEFAULT_THRESHOLDS.trending;
    viralInput.value = DEFAULT_THRESHOLDS.viral;
    badgeStyleSelect.value = DEFAULT_FEATURES.badgeStyle;
    copyMdToggle.checked = DEFAULT_FEATURES.featureCopyAsMarkdown;
    flash(t('flashReset'));
  });
});

copyMdToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ featureCopyAsMarkdown: copyMdToggle.checked }, () => {
    flash(t(copyMdToggle.checked ? 'flashCopyMdOn' : 'flashCopyMdOff'));
  });
});

badgeStyleSelect.addEventListener('change', () => {
  chrome.storage.sync.set({ badgeStyle: badgeStyleSelect.value }, () => flash(t('flashBadgeStyleSaved')));
});

leaderboardToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ featureVelocityLeaderboard: leaderboardToggle.checked }, () => {
    flash(t(leaderboardToggle.checked ? 'flashLeaderboardOn' : 'flashLeaderboardOff'));
  });
});

leaderboardCountInput.addEventListener('change', () => {
  const n = normalizeCount(leaderboardCountInput.value);
  leaderboardCountInput.value = n;
  chrome.storage.sync.set({ leaderboardCount: n }, () => flash(t('flashShowingTop', [String(n)])));
});

languageSelect.addEventListener('change', async () => {
  currentLanguage = normalizeLanguage(languageSelect.value);
  await loadLocaleBundle(currentLanguage);
  applyI18n();
  renderColumns();
  chrome.storage.sync.set({ language: currentLanguage }, () => flash(t('flashLanguageSaved')));
});

themeToggle.addEventListener('click', () => {
  const idx = THEME_ORDER.indexOf(currentTheme);
  const next = THEME_ORDER[(Math.max(idx, 0) + 1) % THEME_ORDER.length];
  applyTheme(next);
  chrome.storage.sync.set({ theme: next }, () => flash(t('flashThemeSaved')));
});

try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(currentTheme));
} catch (_) {}

lbResetBtn.addEventListener('click', () => {
  chrome.storage.local.remove('rvmLeaderboardPos', () => {
    lbResetMsg.textContent = t('featureLeaderboardResetDone');
    setTimeout(() => { lbResetMsg.textContent = ''; }, 1800);
  });
});

try {
  versionEl.textContent = chrome.runtime.getManifest().version;
} catch (_) {}

const savedTab = (() => {
  try { return localStorage.getItem('rvm_popup_active_tab') || 'settings'; }
  catch (_) { return 'settings'; }
})();
setActiveTab(['settings', 'leaderboard', 'about'].includes(savedTab) ? savedTab : 'settings');
loadState();
