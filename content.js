// Red Viral Monitor for Xiaohongshu Web.
// MAIN-world script: observes Xiaohongshu API responses, falls back to DOM
// extraction, and renders heat badges / leaderboard / Markdown copy actions.
(() => {
  const noteDataStore = new Map();
  const noteElementStore = new Map();
  const notePositionStore = new Map();
  const seenObjects = new WeakSet();

  const DEFAULT_THRESHOLDS = { trending: 100, viral: 500 };
  const DEFAULT_LB_COLUMNS = [
    { id: 'rank', visible: true },
    { id: 'icon', visible: true },
    { id: 'author', visible: false },
    { id: 'preview', visible: true },
    { id: 'heat', visible: true },
    { id: 'velocity', visible: true },
  ];
  const KNOWN_COLUMN_IDS = DEFAULT_LB_COLUMNS.map((col) => col.id);
  const NOTE_ID_RE = /^[0-9a-zA-Z]{12,40}$/;
  const XHS_API_RE = /\/api\/sns\/web\//i;
  const MARKDOWN_IMAGE_LIMIT = 9;
  const PLUGIN_NAME = 'Red Viral Monitor';
  const MARKDOWN_TITLE_SELECTORS = [
    '#detail-title',
    '[id*="detail-title"]',
    '.note-content .title',
    '.note-content [class*="title"]',
    '.interaction-container .title',
    '.interaction-container [class*="title"]',
    '.note-title',
    '.title',
    '[class*="title"]',
  ];
  const MARKDOWN_TEXT_SELECTORS = [
    '#detail-title',
    '#detail-desc',
    '[id*="detail-title"]',
    '[id*="detail-desc"]',
    '.note-content .title',
    '.note-content .desc',
    '.note-content [class*="title"]',
    '.note-content [class*="desc"]',
    '.interaction-container .title',
    '.interaction-container .desc',
    '.interaction-container [class*="title"]',
    '.interaction-container [class*="desc"]',
    '.note-title',
    '.title',
    '.desc',
  ];
  const MARKDOWN_NOISE_SELECTOR = [
    '.xvm-lb',
    '.xvm-badge',
    '.xvm-copy-md-button',
    '.xvm-toast',
    '[class*="xvm-"]',
    '.comments-container',
    '.comment-list',
    '.comment-item',
    '[class*="comments"]',
    '[class*="comment-list"]',
    '[class*="comment-item"]',
    '[class*="comment-wrapper"]',
    '[id*="comment"]',
    'textarea',
    'input',
    '[contenteditable="true"]',
  ].join(',');
  const METRIC_ROOT_SELECTORS = [
    '.interactions',
    '.interaction',
    '.interact-container',
    '.interaction-container',
    '.engage-bar',
    '.toolbar',
    '.footer',
    '[class*="interact"]',
    '[class*="interaction"]',
    '[class*="toolbar"]',
    '[class*="footer"]',
  ];

  let localizedStrings = {};
  let velocityThresholds = { ...DEFAULT_THRESHOLDS };
  let leaderboardEnabled = true;
  let leaderboardCount = 10;
  let leaderboardColumns = DEFAULT_LB_COLUMNS.map((col) => ({ ...col }));
  let copyAsMarkdownEnabled = true;
  let badgeStyle = 'pill-solid';
  let themePref = 'system';
  let resolvedTheme = resolveTheme(themePref);

  let scanQueued = false;
  let leaderboardEl = null;
  let leaderboardRaf = 0;
  let activeToast = null;

  function i18n(key) {
    return localizedStrings[key] || key;
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

  function normalizeLeaderboardColumns(raw) {
    if (!Array.isArray(raw)) return DEFAULT_LB_COLUMNS.map((col) => ({ ...col }));
    const seen = new Set();
    const out = [];
    for (const col of raw) {
      if (!col || typeof col.id !== 'string') continue;
      if (!KNOWN_COLUMN_IDS.includes(col.id) || seen.has(col.id)) continue;
      seen.add(col.id);
      out.push({ id: col.id, visible: !!col.visible });
    }
    for (const col of DEFAULT_LB_COLUMNS) {
      if (!seen.has(col.id)) out.push({ ...col });
    }
    return out;
  }

  function normalizeLeaderboardCount(raw) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return 10;
    return Math.max(1, Math.min(50, n));
  }

  function applySettings(data = {}) {
    localizedStrings = data.messages || localizedStrings;
    velocityThresholds = normalizeThresholds(data.thresholds);
    leaderboardEnabled = data.featureVelocityLeaderboard !== false;
    copyAsMarkdownEnabled = data.featureCopyAsMarkdown !== false;
    leaderboardCount = normalizeLeaderboardCount(data.leaderboardCount);
    leaderboardColumns = normalizeLeaderboardColumns(data.leaderboardColumns);
    badgeStyle = data.badgeStyle === 'inline-classic' ? 'inline-classic' : 'pill-solid';
    document.documentElement.dataset.xvmBadgeStyle = badgeStyle;

    document.querySelectorAll('.xvm-badge,.xvm-copy-md-button').forEach((el) => el.remove());
    document.querySelectorAll('[data-xvm-scored]').forEach((el) => el.removeAttribute('data-xvm-scored'));
    scheduleScan();
    if (leaderboardEnabled) renderLeaderboard();
    else hideLeaderboard();
  }

  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (_) {
      return 'light';
    }
  }

  function applyTheme(pref = themePref) {
    themePref = pref || 'system';
    resolvedTheme = resolveTheme(themePref);
    if (leaderboardEl) leaderboardEl.dataset.theme = resolvedTheme;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const type = event.data?.type;
    if (type === 'RVM_SETTINGS_UPDATE') applySettings(event.data);
    if (type === 'RVM_THEME_UPDATE') applyTheme(event.data.pref || 'system');
    if (type === 'RVM_LB_POS_LOAD' && event.data.pos && leaderboardEl) {
      const pos = clampPanelPosition(event.data.pos);
      leaderboardEl.style.left = `${pos.left}px`;
      leaderboardEl.style.top = `${pos.top}px`;
      leaderboardEl.style.right = 'auto';
    }
  });

  window.postMessage({ type: 'RVM_REQUEST_SETTINGS' }, '*');
  window.postMessage({ type: 'RVM_THEME_REQUEST' }, '*');

  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(themePref));
  } catch (_) {}

  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      if (!document.body) {
        setTimeout(scheduleScan, 50);
        return;
      }
      scanInitialState();
      scanDomNotes(document);
      renderBadges();
      renderCopyButtons();
      if (leaderboardEnabled) scheduleLeaderboardRender();
    });
  }

  function scanInitialState() {
    const roots = [
      window.__INITIAL_STATE__,
      window.__INITIAL_DATA__,
      window.__NUXT__,
      window.__pinia,
      window.__REDUX_STATE__,
    ];
    for (const root of roots) {
      try { scanForNotes(root); } catch (_) {}
    }
  }

  async function handleApiResponse(response, source) {
    try {
      const json = source === 'fetch' ? await response.clone().json() : response.json();
      const found = scanForNotes(json);
      if (found) scheduleScan();
    } catch (_) {}
  }

  window.__rvmNet?.onResponse(XHS_API_RE, ({ response, source }) => {
    handleApiResponse(response, source);
  });

  function scanForNotes(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 18) return 0;
    if (seenObjects.has(obj)) return 0;
    seenObjects.add(obj);

    let found = 0;
    if (Array.isArray(obj)) {
      for (const item of obj) found += scanForNotes(item, depth + 1);
      return found;
    }

    const data = extractNoteData(obj);
    if (data?.id) {
      mergeNoteData(data);
      found += 1;
    }

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value && typeof value === 'object') found += scanForNotes(value, depth + 1);
    }
    return found;
  }

  function extractNoteData(raw) {
    const card = raw.note_card || raw.noteCard || raw.note || raw.card || raw;
    const interact = card.interact_info || card.interactInfo || raw.interact_info || raw.interactInfo || {};
    const user = card.user || card.user_info || card.userInfo || raw.user || raw.user_info || raw.userInfo || {};
    const hasNoteShape = raw.note_card || raw.noteCard || raw.model_type === 'note'
      || card.interact_info || card.interactInfo || card.display_title || card.displayTitle
      || card.note_id || card.noteId || raw.note_id || raw.noteId;
    if (!hasNoteShape) return null;

    const id = firstString(
      raw.note_id, raw.noteId, raw.noteID,
      card.note_id, card.noteId, card.noteID,
      raw.note?.note_id, raw.note?.noteId,
      raw.id, card.id, raw.note?.id
    );
    if (!isNoteId(id)) return null;

    const token = firstString(raw.xsec_token, raw.xsecToken, card.xsec_token, card.xsecToken);
    const title = cleanText(firstString(
      card.display_title, card.displayTitle, card.title, raw.display_title, raw.displayTitle, raw.title
    ));
    const desc = cleanText(firstString(card.desc, card.description, card.content, raw.desc, raw.description, raw.content));
    const authorName = cleanText(firstString(
      user.nickname, user.nick_name, user.nickName, user.name,
      card.nickname, raw.nickname
    ));
    const authorId = firstString(user.user_id, user.userId, user.id, raw.user_id, raw.userId);
    const image = extractImageUrl(card) || extractImageUrl(raw);
    const createdAt = normalizeTimestamp(firstValue(
      card.time, card.timestamp, card.create_time, card.createTime, card.last_update_time, card.lastUpdateTime,
      raw.time, raw.timestamp, raw.create_time, raw.createTime
    ));
    const stats = {
      likes: parseCount(firstValue(interact.liked_count, interact.likedCount, interact.like_count, interact.likeCount, card.liked_count, card.likedCount)),
      collects: parseCount(firstValue(interact.collected_count, interact.collectedCount, interact.collect_count, interact.collectCount, card.collected_count, card.collectedCount)),
      comments: parseCount(firstValue(interact.comment_count, interact.commentCount, card.comment_count, card.commentCount)),
      shares: parseCount(firstValue(interact.share_count, interact.shareCount, card.share_count, card.shareCount)),
    };
    const text = [title, desc].filter(Boolean).join('\n\n');
    const url = buildNoteUrl(id, token, raw.xsec_source || raw.xsecSource || card.xsec_source || card.xsecSource);

    return completeNoteData({
      id,
      title,
      text,
      authorName,
      authorId,
      image,
      createdAt,
      url,
      xsecToken: token,
      source: 'api',
      ...stats,
    });
  }

  function extractImageUrl(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const direct = firstString(obj.url, obj.src, obj.image, obj.image_url, obj.imageUrl, obj.cover, obj.cover_url, obj.coverUrl);
    if (direct && /^https?:\/\//.test(direct)) return direct;
    const candidates = [
      obj.cover,
      obj.cover_image,
      obj.coverImage,
      obj.image_list?.[0],
      obj.imageList?.[0],
      obj.images_list?.[0],
      obj.imagesList?.[0],
    ];
    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;
      const url = firstString(item.url, item.src, item.trace_id, item.file_id, item.info_list?.[0]?.url, item.infoList?.[0]?.url);
      if (url && /^https?:\/\//.test(url)) return url;
    }
    return '';
  }

  function mergeNoteData(next) {
    if (!next?.id) return null;
    const prev = noteDataStore.get(next.id);
    const merged = completeNoteData({
      ...prev,
      ...next,
      title: next.title || prev?.title || '',
      text: next.text || prev?.text || '',
      authorName: next.authorName || prev?.authorName || '',
      image: next.image || prev?.image || '',
      url: next.url || prev?.url || buildNoteUrl(next.id),
      likes: maxMetric(prev?.likes, next.likes),
      collects: maxMetric(prev?.collects, next.collects),
      comments: maxMetric(prev?.comments, next.comments),
      shares: maxMetric(prev?.shares, next.shares),
      createdAt: next.createdAt || prev?.createdAt || null,
      updatedAt: Date.now(),
    });
    noteDataStore.set(merged.id, merged);
    return merged;
  }

  function maxMetric(a, b) {
    const na = Number.isFinite(a) ? a : 0;
    const nb = Number.isFinite(b) ? b : 0;
    return Math.max(na, nb);
  }

  function completeNoteData(data) {
    const likes = Number(data.likes) || 0;
    const collects = Number(data.collects) || 0;
    const comments = Number(data.comments) || 0;
    const shares = Number(data.shares) || 0;
    const heat = likes + collects * 1.8 + comments * 3 + shares * 4;
    const createdMs = data.createdAt ? new Date(data.createdAt).getTime() : NaN;
    const hours = Number.isFinite(createdMs)
      ? Math.max((Date.now() - createdMs) / 3_600_000, 0.5)
      : 24;
    return {
      ...data,
      likes,
      collects,
      comments,
      shares,
      heat,
      velocity: heat / hours,
      estimatedVelocity: !Number.isFinite(createdMs),
    };
  }

  function scanDomNotes(root) {
    for (const el of collectNoteElements(root)) {
      const id = getNoteIdFromElement(el);
      if (!id) continue;
      rememberNoteElement(id, el);
      const domData = extractDomNoteData(el, id);
      if (domData) mergeNoteData(domData);
    }
  }

  function rememberNoteElement(id, el) {
    if (!id || !el) return;
    noteElementStore.set(id, el);
    rememberNotePosition(id, el);
  }

  function rememberNotePosition(id, el) {
    if (!id || !el?.isConnected) return;
    const rect = safeRect(el);
    if (rect.width < 1 || rect.height < 1) return;
    notePositionStore.set(id, {
      top: window.scrollY + rect.top,
      height: rect.height,
      href: location.href,
      updatedAt: Date.now(),
    });
  }

  function collectNoteElements(root = document) {
    const out = new Set();
    const scope = root.querySelectorAll ? root : document;
    const add = (el) => {
      if (!el || el === document.body || el === document.documentElement) return;
      const rect = safeRect(el);
      if (rect.width < 80 || rect.height < 60) return;
      out.add(el);
    };

    const selector = [
      '.note-item',
      '.note-card',
      '.feeds-page .note-item',
      '.search-note-card',
      '.explore-note',
      '.note-detail',
      '.note-container',
      '[data-note-id]',
      '[data-noteid]',
    ].join(',');
    scope.querySelectorAll(selector).forEach(add);
    scope.querySelectorAll('a[href*="/explore/"],a[href*="/discovery/item/"],a[href*="/search_result/"]').forEach((link) => {
      add(findNoteRoot(link));
    });

    const locationId = getNoteIdFromUrl(location.href);
    if (locationId) {
      for (const detailSelector of ['.note-detail', '.note-container', '.interaction-container', '[class*="note-detail"]']) {
        const detail = document.querySelector(detailSelector);
        if (detail) add(detail);
      }
    }
    return out;
  }

  function findNoteRoot(link) {
    let node = link;
    let fallback = link;
    for (let depth = 0; node && node !== document.body && depth < 10; depth++, node = node.parentElement) {
      const cls = String(node.className || '').toLowerCase();
      const rect = safeRect(node);
      if (/note|card|feed|item/.test(cls) && rect.width >= 120 && rect.height >= 120) return node;
      if (rect.width >= 160 && rect.height >= 160 && node.querySelector?.('img')) fallback = node;
    }
    return fallback;
  }

  function getNoteIdFromElement(el) {
    const explicit = firstString(
      el.dataset?.noteId, el.dataset?.noteid,
      el.getAttribute?.('data-note-id'), el.getAttribute?.('data-noteid')
    );
    if (isNoteId(explicit)) return explicit;

    const ownHref = el.matches?.('a[href]') ? el.getAttribute('href') : '';
    const fromOwnHref = getNoteIdFromUrl(ownHref);
    if (fromOwnHref) return fromOwnHref;

    const links = el.querySelectorAll?.('a[href*="/explore/"],a[href*="/discovery/item/"],a[href*="/search_result/"]') || [];
    for (const link of links) {
      const id = getNoteIdFromUrl(link.getAttribute('href') || link.href || '');
      if (id) return id;
    }

    const locationId = getNoteIdFromUrl(location.href);
    if (locationId && el.matches?.('.note-detail,.note-container,[class*="note-detail"]')) return locationId;

    const generic = firstString(el.dataset?.id, el.getAttribute?.('data-id'));
    if (isNoteId(generic)) return generic;
    return '';
  }

  function getNoteIdFromUrl(raw) {
    if (!raw) return '';
    let path = String(raw);
    try { path = new URL(raw, location.origin).pathname; } catch (_) {}
    const match = path.match(/\/(?:explore|search_result|discovery\/item)\/([0-9a-zA-Z]+)/);
    return isNoteId(match?.[1]) ? match[1] : '';
  }

  function extractDomNoteData(el, id) {
    const rawText = cleanText(el.innerText || '');
    const text = readElementTextForMarkdown(el) || trimTextBeforeComments(stripMarkdownUiText(rawText));
    const title = readElementTitleForMarkdown(el, text) || firstReadableLine(text);
    const authorName = cleanText(queryText(el, [
      '.author',
      '.name',
      '.username',
      '.user-name',
      '[class*="author"]',
      '[class*="user-name"]',
      '[class*="nickname"]',
    ]));
    const metrics = parseMetricsFromElement(el);
    const createdAt = parseDateFromText(text || rawText);
    const image = extractDomImage(el);
    const link = el.matches?.('a[href]') ? el : el.querySelector?.('a[href*="/explore/"],a[href*="/search_result/"]');
    const url = link?.href || (getNoteIdFromUrl(location.href) === id ? location.href : buildNoteUrl(id));

    if (!title && !authorName && !metrics.likes && !metrics.collects && !metrics.comments && !metrics.shares) return null;
    return completeNoteData({
      id,
      title,
      text: title && text && text.length > title.length ? text : title,
      authorName,
      image,
      createdAt,
      url,
      source: 'dom',
      ...metrics,
    });
  }

  function queryText(root, selectors) {
    for (const selector of selectors) {
      const el = root.querySelector?.(selector);
      const text = cleanText(el?.textContent || '');
      if (text) return text;
    }
    return '';
  }

  function firstReadableLine(text) {
    const lines = String(text || '').split('\n').map(cleanText).filter(Boolean);
    return lines.find((line) => line.length >= 2 && line.length <= 80 && !looksLikeMetricLine(line)) || '';
  }

  function parseMetricsFromElement(el) {
    const samples = new Set();
    const add = (value) => {
      const text = cleanText(value || '');
      if (text) samples.add(text);
    };
    const addTextSamples = (value) => {
      const lines = String(value || '').split('\n').map(cleanText).filter(Boolean);
      for (let i = 0; i < lines.length; i += 1) {
        add(lines[i]);
        if (isMetricLabelLine(lines[i]) && isMetricNumberLine(lines[i + 1])) add(`${lines[i]} ${lines[i + 1]}`);
      }
    };
    const roots = collectMetricRoots(el);
    for (const root of roots) {
      root.querySelectorAll?.('[aria-label],[title],button,span,div').forEach((node) => {
        if (isInsideMarkdownNoise(node)) return;
        add(node.getAttribute?.('aria-label'));
        add(node.getAttribute?.('title'));
        const text = node.childElementCount <= 2 ? node.textContent : '';
        if (/赞|点赞|喜欢|收藏|评论|留言|分享|like|collect|comment|share/i.test(text || '')) addTextSamples(text);
      });
    }
    if (!samples.size) addTextSamples(el.innerText);

    const metrics = { likes: 0, collects: 0, comments: 0, shares: 0 };
    for (const text of samples) {
      metrics.likes = Math.max(metrics.likes, extractMetric(text, ['赞', '点赞', '喜欢', 'like', 'likes']));
      metrics.collects = Math.max(metrics.collects, extractMetric(text, ['收藏', 'collect', 'collects']));
      metrics.comments = Math.max(metrics.comments, extractMetric(text, ['评论', '留言', 'comment', 'comments']));
      metrics.shares = Math.max(metrics.shares, extractMetric(text, ['分享', '转发', 'share', 'shares']));
    }
    return metrics;
  }

  function collectMetricRoots(el) {
    const roots = new Set();
    for (const selector of METRIC_ROOT_SELECTORS) {
      el.querySelectorAll?.(selector).forEach((node) => {
        if (!isInsideMarkdownNoise(node)) roots.add(node);
      });
    }
    if (!roots.size) roots.add(el);
    return roots;
  }

  function extractMetric(text, labels) {
    const source = String(text || '').replace(/\s+/g, ' ');
    let best = 0;
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [
        new RegExp(`${escaped}\\s*[:：]?\\s*([0-9][0-9,.]*\\s*(?:万|千|k|K|w|W)?)`, 'i'),
        new RegExp(`([0-9][0-9,.]*\\s*(?:万|千|k|K|w|W)?)\\s*${escaped}`, 'i'),
      ];
      for (const re of patterns) {
        const match = source.match(re);
        if (match) best = Math.max(best, parseCount(match[1]));
      }
    }
    return best;
  }

  function parseDateFromText(text) {
    const source = String(text || '');
    const now = new Date();
    const rel = source.match(/(\d+)\s*(秒|分钟|小时|天|周|月|年)前/);
    if (rel) {
      const n = Number(rel[1]);
      const unit = rel[2];
      const ms = unit === '秒' ? n * 1000
        : unit === '分钟' ? n * 60_000
        : unit === '小时' ? n * 3_600_000
        : unit === '天' ? n * 86_400_000
        : unit === '周' ? n * 7 * 86_400_000
        : unit === '月' ? n * 30 * 86_400_000
        : n * 365 * 86_400_000;
      return new Date(Date.now() - ms).toISOString();
    }
    if (/昨天/.test(source)) return new Date(Date.now() - 86_400_000).toISOString();
    if (/今天/.test(source)) return now.toISOString();

    const full = source.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (full) return new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3])).toISOString();
    const monthDay = source.match(/(?:^|\s)(\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\s|$)/);
    if (monthDay) return new Date(now.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2])).toISOString();
    return null;
  }

  function extractDomImage(el) {
    const imgs = Array.from(el.querySelectorAll?.('img[src]') || []);
    const img = imgs.find((node) => {
      const rect = safeRect(node);
      return rect.width >= 40 && rect.height >= 40 && !/avatar|icon/i.test(node.className || '');
    }) || imgs[0];
    return img?.currentSrc || img?.src || '';
  }

  function renderBadges() {
    for (const [id, el] of noteElementStore) {
      if (!el.isConnected) {
        noteElementStore.delete(id);
        continue;
      }
      if (el.hasAttribute('data-xvm-scored')) continue;
      const data = noteDataStore.get(id);
      if (!data || data.heat <= 0) continue;

      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = `xvm-badge ${badgeClassFor(data.velocity)}`;
      badge.textContent = `${badgePrefixFor(data.velocity)} ${formatVelocity(data.velocity)}`;
      badge.title = buildTooltip(data);
      badge.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        showToast(buildTooltip(data), { sticky: true });
      });

      const host = getOverlayHost(el);
      ensurePositioned(host);
      if (isDetailMediaHost(host)) badge.classList.add('xvm-badge--detail');
      host.appendChild(badge);
      el.setAttribute('data-xvm-scored', '1');
    }
  }

  function renderCopyButtons() {
    for (const [id, el] of noteElementStore) {
      if (!el.isConnected) continue;
      const host = getOverlayHost(el);
      const existing = host.querySelector?.(':scope > .xvm-copy-md-button');
      if (!copyAsMarkdownEnabled) {
        existing?.remove();
        continue;
      }
      if (existing) continue;
      const data = noteDataStore.get(id);
      if (!data) continue;
      ensurePositioned(host);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xvm-copy-md-button';
      btn.title = i18n('contentCopyMdLabel');
      btn.setAttribute('aria-label', i18n('contentCopyMdLabel'));
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-1v-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1H8Zm-4 4a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6Zm3-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7Z"/></svg>';
      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (btn.disabled) return;
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        try {
          const latest = noteDataStore.get(id) || data;
          const ok = await copyTextToClipboard(buildNoteMarkdown(latest, el));
          showToast(ok ? i18n('contentCopyMdDone') : i18n('contentCopyMdCopyFailed'), { kind: ok ? 'success' : 'error' });
        } finally {
          setTimeout(() => {
            btn.disabled = false;
            btn.removeAttribute('aria-busy');
          }, 600);
        }
      });
      if (isDetailMediaHost(host)) btn.classList.add('xvm-copy-md-button--detail');
      host.appendChild(btn);
    }
  }

  function isDetailNoteElement(el) {
    return !!el.matches?.('.note-detail,.note-container,.interaction-container,[class*="note-detail"]');
  }

  function isDetailMediaHost(el) {
    return !!el.matches?.('.media-container,[class*="media-container"]');
  }

  function getOverlayHost(el) {
    if (!isDetailNoteElement(el)) return el;
    // On the note detail page, anchor overlays to the media area: it stays put
    // while the note text and comments scroll, and the panel's top edge is
    // crowded by the author row, follow button, and close control.
    const root = el.closest?.('.note-container,.note-detail,[class*="note-detail"]') || el;
    return root.querySelector?.('.media-container,[class*="media-container"]')
      || el.querySelector?.('.note-content,.interaction-container,[class*="content"]')
      || el;
  }

  function ensurePositioned(el) {
    if (!el || el.dataset.xvmPositioned) return;
    const style = getComputedStyle(el);
    if (style.position === 'static') el.style.position = 'relative';
    el.dataset.xvmPositioned = '1';
  }

  function badgeClassFor(velocity) {
    if (velocity >= velocityThresholds.viral) return 'xvm-badge--red';
    if (velocity >= velocityThresholds.trending) return 'xvm-badge--orange';
    return 'xvm-badge--green';
  }

  function badgePrefixFor(velocity) {
    if (velocity >= velocityThresholds.viral) return 'HOT';
    if (velocity >= velocityThresholds.trending) return 'UP';
    return 'HEAT';
  }

  function buildTooltip(data) {
    const lines = [
      data.title || i18n('contentFallbackNoteLabel'),
      `${i18n('contentHeat')}: ${formatCompact(data.heat)}`,
      `${i18n('contentVelocity')}: ${formatVelocity(data.velocity)}${data.estimatedVelocity ? ` (${i18n('contentEstimated')})` : ''}`,
      `${i18n('contentLikes')}: ${formatCompact(data.likes)}`,
      `${i18n('contentCollects')}: ${formatCompact(data.collects)}`,
      `${i18n('contentComments')}: ${formatCompact(data.comments)}`,
      `${i18n('contentShares')}: ${formatCompact(data.shares)}`,
    ];
    if (data.createdAt) lines.push(`${i18n('contentPosted')}: ${formatDate(data.createdAt)}`);
    return lines.filter(Boolean).join('\n');
  }

  function buildNoteMarkdown(data = {}, el) {
    const elementText = readElementTextForMarkdown(el);
    const sourceText = data.source === 'dom' && elementText ? elementText : (data.text || elementText || data.title || '');
    const text = stripMarkdownUiText(cleanText(sourceText));
    const elementTitle = readElementTitleForMarkdown(el, elementText);
    const title = cleanText(data.title || elementTitle || firstReadableLine(text) || i18n('contentFallbackNoteLabel'));
    const author = cleanText(data.authorName || '');
    const posted = data.createdAt ? formatDate(data.createdAt) : '';
    const url = resolveMarkdownSourceUrl(data);
    const body = removeLeadingTitle(text, title);
    const images = collectImagesForMarkdown(data, el);
    const metrics = resolveMarkdownMetrics(data, el);
    const lines = [`# ${escapeMarkdown(title)}`, ''];
    if (author) lines.push(`> ${i18n('contentAuthor')}: ${escapeMarkdown(author)}`);
    if (posted) lines.push(`> ${i18n('contentPosted')}: ${posted}`);
    if (url) lines.push(`> ${i18n('contentSource')}: ${url}`);
    if (lines[lines.length - 1] !== '') lines.push('');
    if (body) lines.push(escapeMarkdown(body), '');
    if (images.length) {
      for (const image of images.slice(0, MARKDOWN_IMAGE_LIMIT)) lines.push(`![](${image})`);
      lines.push('');
    }
    lines.push(`- ${i18n('contentLikes')}: ${formatCompact(metrics.likes)}`);
    lines.push(`- ${i18n('contentCollects')}: ${formatCompact(metrics.collects)}`);
    lines.push(`- ${i18n('contentComments')}: ${formatCompact(metrics.comments)}`);
    lines.push(`- ${i18n('contentShares')}: ${formatCompact(metrics.shares)}`);
    lines.push('', pluginSourceLine());
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function readElementTitleForMarkdown(el, fallbackText = '') {
    if (!el) return '';
    return firstTextFromSelectors(el, MARKDOWN_TITLE_SELECTORS)
      || firstReadableLine(stripMarkdownUiText(fallbackText || readElementTextForMarkdown(el)));
  }

  function readElementTextForMarkdown(el) {
    if (!el) return '';
    const selected = collectTextFromSelectors(el, MARKDOWN_TEXT_SELECTORS);
    if (selected) return selected;
    const clone = cloneWithoutMarkdownNoise(el);
    if (clone?.querySelectorAll) {
      return trimTextBeforeComments(cleanText(clone.innerText || clone.textContent || ''));
    }
    return trimTextBeforeComments(cleanText(el.innerText || el.textContent || ''));
  }

  function firstTextFromSelectors(root, selectors) {
    for (const selector of selectors) {
      const el = root.querySelector?.(selector);
      if (isInsideMarkdownNoise(el)) continue;
      const text = cleanText(el?.innerText || el?.textContent || '');
      if (text && !looksLikeMarkdownNoiseLine(text)) return text;
    }
    return '';
  }

  function collectTextFromSelectors(root, selectors) {
    const parts = [];
    const seen = new Set();
    for (const selector of selectors) {
      root.querySelectorAll?.(selector).forEach((node) => {
        if (isInsideMarkdownNoise(node)) return;
        const text = cleanText(node.innerText || node.textContent || '');
        if (!text || seen.has(text) || looksLikeMarkdownNoiseLine(text)) return;
        seen.add(text);
        parts.push(text);
      });
    }
    return cleanText(parts.join('\n\n'));
  }

  function cloneWithoutMarkdownNoise(el) {
    const clone = el.cloneNode?.(true);
    clone?.querySelectorAll?.(MARKDOWN_NOISE_SELECTOR).forEach((node) => node.remove?.());
    return clone;
  }

  function isInsideMarkdownNoise(node) {
    return !!node?.closest?.(MARKDOWN_NOISE_SELECTOR);
  }

  function looksLikeMarkdownNoiseLine(line) {
    const text = cleanText(line);
    return !text
      || /^评论$/.test(text)
      || /^全部评论$/.test(text)
      || /^共\s*\d+\s*条评论$/.test(text)
      || /^说点什么/.test(text)
      || /^还没有评论/.test(text)
      || /^(HOT|UP|HEAT)\s+[0-9.,万千kKwW亿]+\/h$/i.test(text);
  }

  function trimTextBeforeComments(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const cut = lines.findIndex((line, index) => index > 0 && looksLikeCommentSectionStart(line));
    return cleanText((cut >= 0 ? lines.slice(0, cut) : lines).join('\n'));
  }

  function looksLikeCommentSectionStart(line) {
    const text = cleanText(line);
    return /^评论$/.test(text)
      || /^全部评论$/.test(text)
      || /^共\s*\d+\s*条评论$/.test(text)
      || /^说点什么/.test(text)
      || /^还没有评论/.test(text);
  }

  function stripMarkdownUiText(text) {
    const blocked = new Set([
      'contentCopyMdLabel',
      'contentCopyMdDone',
      'contentCopyMdNoNoteFound',
      'contentCopyMdCopyFailed',
      'contentLeaderboardTitle',
      'contentLeaderboardEmpty',
    ].map(i18n).map(cleanText).filter(Boolean));
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const kept = [];
    for (const raw of lines) {
      const line = cleanText(raw);
      if (!line) {
        if (kept[kept.length - 1] !== '') kept.push('');
        continue;
      }
      if (blocked.has(line) || looksLikeMarkdownNoiseLine(line)) continue;
      kept.push(line);
    }
    return trimTextBeforeComments(cleanText(kept.join('\n')));
  }

  function removeLeadingTitle(text, title) {
    const body = cleanText(text);
    const cleanTitle = cleanText(title);
    if (!body || body === cleanTitle) return '';
    const lines = body.split('\n');
    while (lines.length && !cleanText(lines[0])) lines.shift();
    if (cleanText(lines[0]) === cleanTitle) {
      lines.shift();
      while (lines.length && !cleanText(lines[0])) lines.shift();
    }
    return cleanText(lines.join('\n'));
  }

  function resolveMarkdownSourceUrl(data = {}) {
    const currentId = getNoteIdFromUrl(location.href);
    const currentNoteUrl = data.id && currentId === data.id ? location.href : '';
    if (currentNoteUrl && /[?&]xsec_token=/.test(currentNoteUrl)) return currentNoteUrl;
    if (data.url) return data.url;
    if (currentNoteUrl) return currentNoteUrl;
    return buildNoteUrl(data.id, data.xsecToken);
  }

  function pluginSourceLine() {
    return `来自插件：${PLUGIN_NAME}`;
  }

  function resolveMarkdownMetrics(data = {}, el) {
    const fromData = {
      likes: Number(data.likes) || 0,
      collects: Number(data.collects) || 0,
      comments: Number(data.comments) || 0,
      shares: Number(data.shares) || 0,
    };
    const fromDom = el ? parseMetricsFromElement(el) : null;
    if (!fromDom) return fromData;
    if (metricsLookSuspicious(fromData) && metricsHaveSignal(fromDom) && !metricsLookSuspicious(fromDom)) {
      return {
        likes: fromDom.likes || fromData.likes,
        collects: fromDom.collects || fromData.collects,
        comments: fromDom.comments || fromData.comments,
        shares: fromDom.shares || fromData.shares,
      };
    }
    return {
      likes: fromData.likes || fromDom.likes,
      collects: fromData.collects || fromDom.collects,
      comments: fromData.comments || fromDom.comments,
      shares: fromData.shares || fromDom.shares,
    };
  }

  function metricsLookSuspicious(metrics) {
    const values = ['likes', 'collects', 'comments', 'shares'].map((key) => Number(metrics?.[key]) || 0).filter(Boolean);
    return values.length >= 3 && new Set(values).size === 1;
  }

  function metricsHaveSignal(metrics) {
    return ['likes', 'collects', 'comments', 'shares'].some((key) => Number(metrics?.[key]) > 0);
  }

  function collectImagesForMarkdown(data, el) {
    const urls = new Set();
    const add = (url) => {
      const value = String(url || '').trim();
      if (/^https?:\/\//.test(value)) urls.add(value);
    };
    add(data.image);
    const imageRoot = cloneWithoutMarkdownNoise(el) || el;
    imageRoot?.querySelectorAll?.('img[src]').forEach((img) => {
      const src = img.currentSrc || img.src;
      add(src);
    });
    return Array.from(urls);
  }

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (_) {
        return false;
      }
    }
  }

  function scheduleLeaderboardRender() {
    if (leaderboardRaf) return;
    leaderboardRaf = requestAnimationFrame(() => {
      leaderboardRaf = 0;
      renderLeaderboard();
    });
  }

  function renderLeaderboard() {
    if (!leaderboardEnabled) return hideLeaderboard();
    if (!document.body) {
      setTimeout(scheduleLeaderboardRender, 50);
      return;
    }
    if (!leaderboardEl) {
      leaderboardEl = document.createElement('aside');
      leaderboardEl.className = 'xvm-lb';
      leaderboardEl.dataset.theme = resolvedTheme;
      leaderboardEl.innerHTML = `
        <div class="xvm-lb-head" title="${escapeHtml(i18n('contentLeaderboardDragToMove'))}">
          <span class="xvm-lb-grip" aria-hidden="true"></span>
          <strong class="xvm-lb-title"></strong>
        </div>
        <ol class="xvm-lb-list"></ol>
      `;
      document.body.appendChild(leaderboardEl);
      bindLeaderboardDrag(leaderboardEl);
      bindLeaderboardList(leaderboardEl.querySelector('.xvm-lb-list'));
      window.postMessage({ type: 'RVM_LB_POS_REQUEST' }, '*');
    }
    leaderboardEl.querySelector('.xvm-lb-title').textContent = i18n('contentLeaderboardTitle');
    const list = leaderboardEl.querySelector('.xvm-lb-list');
    if (!list) return;
    list.textContent = '';

    const items = Array.from(noteDataStore.values())
      .filter((item) => item.heat > 0 && hasCurrentPageNoteLocation(item.id))
      .sort((a, b) => b.velocity - a.velocity || b.heat - a.heat)
      .slice(0, leaderboardCount);

    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'xvm-lb-empty';
      empty.textContent = i18n('contentLeaderboardEmpty');
      list.appendChild(empty);
      return;
    }

    items.forEach((item, idx) => {
      const row = document.createElement('li');
      row.className = `xvm-lb-item ${badgeClassFor(item.velocity).replace('xvm-badge--', 'xvm-lb-')}`;
      row.dataset.id = item.id;
      row.title = item.title || item.url || '';
      for (const col of leaderboardColumns) {
        if (!col.visible) continue;
        const span = document.createElement('span');
        span.className = `xvm-lb-${col.id}`;
        if (col.id === 'rank') span.textContent = String(idx + 1);
        if (col.id === 'icon') span.textContent = badgePrefixFor(item.velocity);
        if (col.id === 'author') span.textContent = item.authorName || '';
        if (col.id === 'preview') span.textContent = item.title || firstReadableLine(item.text) || i18n('contentFallbackNoteLabel');
        if (col.id === 'heat') span.textContent = formatCompact(item.heat);
        if (col.id === 'velocity') span.textContent = formatVelocity(item.velocity);
        row.appendChild(span);
      }
      list.appendChild(row);
    });
  }

  function bindLeaderboardList(list) {
    if (!list || list.dataset.xvmClickBound) return;
    list.dataset.xvmClickBound = '1';
    list.addEventListener('click', (event) => {
      const row = event.target?.closest?.('.xvm-lb-item');
      if (!row || !list.contains(row)) return;
      event.preventDefault();
      event.stopPropagation();

      const item = noteDataStore.get(row.dataset.id);
      if (!item) return;
      const el = resolveNoteElement(item.id);
      if (el) {
        focusNoteElement(el);
      } else if (scrollToRememberedNote(item.id)) {
        retryFocusNote(item.id);
      } else {
        showToast(i18n('contentCopyMdNoNoteFound'), { kind: 'error' });
      }
    });
  }

  function hasCurrentPageNoteLocation(id) {
    const el = noteElementStore.get(id);
    if (isConnectedNoteElement(el, id)) return true;
    const pos = notePositionStore.get(id);
    return !!pos && pos.href === location.href;
  }

  function resolveNoteElement(id) {
    if (!id) return null;
    const stored = noteElementStore.get(id);
    if (isConnectedNoteElement(stored, id)) return stored;
    if (stored && !stored.isConnected) noteElementStore.delete(id);

    const found = findNoteElementById(id);
    if (found) {
      rememberNoteElement(id, found);
      const domData = extractDomNoteData(found, id);
      if (domData) mergeNoteData(domData);
      return found;
    }

    scanDomNotes(document);
    const rescanned = noteElementStore.get(id);
    return isConnectedNoteElement(rescanned, id) ? rescanned : null;
  }

  function isConnectedNoteElement(el, id) {
    if (!el?.isConnected) return false;
    const foundId = getNoteIdFromElement(el);
    return !foundId || foundId === id;
  }

  function findNoteElementById(id) {
    const attrId = escapeCssAttr(id);
    const selectors = [
      `[data-note-id="${attrId}"]`,
      `[data-noteid="${attrId}"]`,
      `a[href*="/explore/${attrId}"]`,
      `a[href*="/search_result/${attrId}"]`,
      `a[href*="/discovery/item/${attrId}"]`,
    ].join(',');

    for (const candidate of document.querySelectorAll(selectors)) {
      const el = candidate.matches?.('a[href]') ? findNoteRoot(candidate) : candidate;
      if (getNoteIdFromElement(el) === id || getNoteIdFromElement(candidate) === id) return el;
    }

    const locationId = getNoteIdFromUrl(location.href);
    if (locationId === id) {
      for (const selector of ['.note-detail', '.note-container', '.interaction-container', '[class*="note-detail"]']) {
        const detail = document.querySelector(selector);
        if (detail) return detail;
      }
    }
    return null;
  }

  function focusNoteElement(el) {
    const id = getNoteIdFromElement(el);
    if (id) rememberNotePosition(id, el);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('xvm-note-focus');
    setTimeout(() => el.classList.remove('xvm-note-focus'), 1600);
  }

  function scrollToRememberedNote(id) {
    const pos = notePositionStore.get(id);
    if (!pos || pos.href !== location.href) return false;
    const target = Math.max(0, pos.top - Math.max(80, (window.innerHeight - pos.height) / 2));
    window.scrollTo({ top: target, behavior: 'smooth' });
    return true;
  }

  function retryFocusNote(id) {
    for (const delay of [260, 700, 1200]) {
      setTimeout(() => {
        const el = resolveNoteElement(id);
        if (el) focusNoteElement(el);
      }, delay);
    }
  }

  function hideLeaderboard() {
    leaderboardEl?.remove();
    leaderboardEl = null;
  }

  function bindLeaderboardDrag(panel) {
    const head = panel.querySelector('.xvm-lb-head');
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      panel.classList.add('xvm-lb-dragging');
      const rect = panel.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      head.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    head.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const pos = clampPanelPosition({
        left: startLeft + event.clientX - startX,
        top: startTop + event.clientY - startY,
      });
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
      panel.style.right = 'auto';
    });
    const stop = (event) => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('xvm-lb-dragging');
      head.releasePointerCapture?.(event.pointerId);
      const rect = panel.getBoundingClientRect();
      window.postMessage({ type: 'RVM_LB_POS_SAVE', pos: { left: rect.left, top: rect.top } }, '*');
    };
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
  }

  function clampPanelPosition(pos) {
    const width = leaderboardEl?.offsetWidth || 300;
    const height = leaderboardEl?.offsetHeight || 360;
    return {
      left: Math.max(8, Math.min(window.innerWidth - width - 8, Number(pos.left) || 24)),
      top: Math.max(8, Math.min(window.innerHeight - height - 8, Number(pos.top) || 96)),
    };
  }

  function showToast(message, options = {}) {
    if (!document.body) return;
    activeToast?.remove();
    const toast = document.createElement('div');
    toast.className = `xvm-toast ${options.kind ? `xvm-toast--${options.kind}` : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    activeToast = toast;
    requestAnimationFrame(() => toast.classList.add('xvm-toast--show'));
    const timeout = options.sticky ? 6500 : 2200;
    setTimeout(() => {
      toast.classList.remove('xvm-toast--show');
      setTimeout(() => toast.remove(), 160);
      if (activeToast === toast) activeToast = null;
    }, timeout);
  }

  function buildNoteUrl(id, token = '', source = '') {
    if (!id) return location.href;
    const url = new URL(`/explore/${id}`, 'https://www.xiaohongshu.com');
    if (token) url.searchParams.set('xsec_token', token);
    if (source) url.searchParams.set('xsec_source', source);
    return url.href;
  }

  function normalizeTimestamp(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      const ms = n > 10_000_000_000 ? n : n * 1000;
      return new Date(ms).toISOString();
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  function parseCount(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value).trim().replace(/,/g, '');
    if (!s || /^(赞|收藏|评论|分享|like|collect|comment|share)$/i.test(s)) return 0;
    let multiplier = 1;
    if (/[万wW]$/.test(s)) multiplier = 10_000;
    if (/[千kK]$/.test(s)) multiplier = 1000;
    s = s.replace(/[万千kKwW]/g, '');
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? Math.round(n * multiplier) : 0;
  }

  function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
  }

  function firstString(...values) {
    const value = firstValue(...values);
    return value == null ? '' : String(value);
  }

  function isNoteId(value) {
    return typeof value === 'string' && NOTE_ID_RE.test(value);
  }

  function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function looksLikeMetricLine(line) {
    return /^(赞|收藏|评论|分享|点赞|喜欢|[0-9.,万千kKwW\s]+)$/.test(String(line || '').trim());
  }

  function isMetricLabelLine(line) {
    return /^(赞|点赞|喜欢|收藏|评论|留言|分享|转发|like|likes|collect|collects|comment|comments|share|shares)$/i.test(String(line || '').trim());
  }

  function isMetricNumberLine(line) {
    return /^[0-9][0-9,.]*\s*(?:万|千|k|K|w|W)?$/.test(String(line || '').trim());
  }

  function safeRect(el) {
    try { return el.getBoundingClientRect(); }
    catch (_) { return { width: 0, height: 0, left: 0, top: 0 }; }
  }

  function formatCompact(value) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    if (n >= 100_000_000) return `${trimNumber(n / 100_000_000)}亿`;
    if (n >= 10_000) return `${trimNumber(n / 10_000)}万`;
    if (n >= 1000) return `${trimNumber(n / 1000)}k`;
    return String(n);
  }

  function formatVelocity(value) {
    return `${formatCompact(value)}/h`;
  }

  function trimNumber(value) {
    return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');
  }

  function formatDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function escapeMarkdown(value) {
    return String(value || '').replace(/\r/g, '').trim();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function escapeCssAttr(value) {
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function isXvmOwnedNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return true;
    if (node.closest?.('.xvm-lb,.xvm-badge,.xvm-copy-md-button,.xvm-toast')) return true;
    return String(node.className || '').split(/\s+/).some((cls) => cls.startsWith('xvm-'));
  }

  function isOwnMutationBatch(mutations) {
    return mutations.every((mutation) => {
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return nodes.length > 0 && nodes.every(isXvmOwnedNode);
    });
  }

  const observer = new MutationObserver((mutations) => {
    if (isOwnMutationBatch(mutations)) return;
    scheduleScan();
  });
  function start() {
    scheduleScan();
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    setInterval(scheduleScan, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
