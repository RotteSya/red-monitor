const DEFAULT_THRESHOLDS = { trending: 100, viral: 500 };
const DEFAULT_COLUMNS = [
  { id: 'rank', visible: true },
  { id: 'icon', visible: true },
  { id: 'author', visible: false },
  { id: 'preview', visible: true },
  { id: 'heat', visible: true },
  { id: 'velocity', visible: true },
];
const KNOWN_COLUMN_IDS = DEFAULT_COLUMNS.map((col) => col.id);
const SUPPORTED_LANGUAGE_IDS = ['auto', 'zh_CN', 'en', 'ja'];
const CONTENT_MESSAGE_KEYS = [
  'contentLikes',
  'contentCollects',
  'contentComments',
  'contentShares',
  'contentHeat',
  'contentVelocity',
  'contentEstimated',
  'contentPosted',
  'contentAuthor',
  'contentSource',
  'contentLeaderboardTitle',
  'contentLeaderboardDragToMove',
  'contentLeaderboardEmpty',
  'contentCopyMdLabel',
  'contentCopyMdDone',
  'contentCopyMdNoNoteFound',
  'contentCopyMdCopyFailed',
  'contentFallbackNoteLabel',
];

const DEFAULT_FEATURES = {
  featureVelocityLeaderboard: true,
  featureCopyAsMarkdown: true,
  badgeStyle: 'pill-solid',
  leaderboardCount: 10,
  leaderboardColumns: DEFAULT_COLUMNS,
  language: 'auto',
};
const STORAGE_DEFAULTS = { ...DEFAULT_THRESHOLDS, ...DEFAULT_FEATURES };

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

function getEffectiveLanguageId(pref = 'auto') {
  const normalized = normalizeLanguage(pref);
  return normalized === 'auto' ? getBrowserLocaleId() : normalized;
}

function normalizeSubstitutions(substitutions) {
  if (substitutions == null) return [];
  return Array.isArray(substitutions) ? substitutions.map(String) : [String(substitutions)];
}

function formatLocaleMessage(entry, substitutions) {
  if (!entry?.message) return '';
  const subs = normalizeSubstitutions(substitutions);
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

const localeBundleCache = new Map();
async function loadLocaleBundle(languageId) {
  if (localeBundleCache.has(languageId)) return localeBundleCache.get(languageId);
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${languageId}/messages.json`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    localeBundleCache.set(languageId, json);
    return json;
  } catch (_) {
    localeBundleCache.set(languageId, null);
    return null;
  }
}

async function getLocalizedMessages(languagePref) {
  const languageId = getEffectiveLanguageId(languagePref);
  const bundle = normalizeLanguage(languagePref) === 'auto' ? null : await loadLocaleBundle(languageId);
  const out = {};
  for (const key of CONTENT_MESSAGE_KEYS) {
    const local = formatLocaleMessage(bundle?.[key]);
    if (local) {
      out[key] = local;
      continue;
    }
    try { out[key] = chrome.i18n.getMessage(key) || key; }
    catch (_) { out[key] = key; }
  }
  return out;
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

function normalizeLeaderboardCount(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(50, n));
}

function normalizeLeaderboardColumns(raw) {
  if (!Array.isArray(raw)) return DEFAULT_COLUMNS.map((col) => ({ ...col }));
  const seen = new Set();
  const out = [];
  for (const col of raw) {
    if (!col || typeof col.id !== 'string') continue;
    if (!KNOWN_COLUMN_IDS.includes(col.id) || seen.has(col.id)) continue;
    seen.add(col.id);
    out.push({ id: col.id, visible: !!col.visible });
  }
  for (const col of DEFAULT_COLUMNS) {
    if (!seen.has(col.id)) out.push({ ...col });
  }
  return out;
}

async function pushSettings(raw) {
  window.postMessage({
    type: 'RVM_SETTINGS_UPDATE',
    thresholds: normalizeThresholds(raw),
    featureVelocityLeaderboard: raw?.featureVelocityLeaderboard !== false,
    featureCopyAsMarkdown: raw?.featureCopyAsMarkdown !== false,
    leaderboardCount: normalizeLeaderboardCount(raw?.leaderboardCount),
    leaderboardColumns: normalizeLeaderboardColumns(raw?.leaderboardColumns),
    badgeStyle: raw?.badgeStyle === 'inline-classic' ? 'inline-classic' : 'pill-solid',
    language: normalizeLanguage(raw?.language),
    effectiveLanguage: getEffectiveLanguageId(raw?.language),
    messages: await getLocalizedMessages(raw?.language),
  }, '*');
}

function safeChromeCall(fn) {
  try {
    if (chrome?.runtime?.id) fn();
  } catch (_) {}
}

safeChromeCall(() => {
  chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => {
    pushSettings(items);
  });
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const type = event.data?.type;

  if (type === 'RVM_REQUEST_SETTINGS') {
    safeChromeCall(() => chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => pushSettings(items)));
    return;
  }

  if (type === 'RVM_THEME_REQUEST') {
    safeChromeCall(() => {
      chrome.storage.sync.get({ theme: 'system' }, (items) => {
        window.postMessage({ type: 'RVM_THEME_UPDATE', pref: items.theme || 'system' }, '*');
      });
    });
    return;
  }

  if (type === 'RVM_LB_POS_REQUEST') {
    safeChromeCall(() => {
      chrome.storage.local.get({ rvmLeaderboardPos: null }, (items) => {
        if (items.rvmLeaderboardPos) {
          window.postMessage({ type: 'RVM_LB_POS_LOAD', pos: items.rvmLeaderboardPos }, '*');
        }
      });
    });
    return;
  }

  if (type === 'RVM_LB_POS_SAVE' && event.data.pos) {
    safeChromeCall(() => chrome.storage.local.set({ rvmLeaderboardPos: event.data.pos }));
  }
});

safeChromeCall(() => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (changes.theme) {
      const pref = changes.theme.newValue || 'system';
      window.postMessage({ type: 'RVM_THEME_UPDATE', pref }, '*');
    }
    const touched = changes.trending || changes.viral || changes.featureVelocityLeaderboard
      || changes.featureCopyAsMarkdown || changes.badgeStyle || changes.leaderboardCount
      || changes.leaderboardColumns || changes.language;
    if (!touched) return;
    chrome.storage.sync.get(STORAGE_DEFAULTS, (items) => pushSettings(items));
  });
});
