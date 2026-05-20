// === X List member filter settings (popup context) ===
//
// Persists list metadata/member cache to chrome.storage.local; MAIN-world
// filter.js consumes the same key. Member fetches go through member-source.js,
// which queues authenticated GraphQL requests for the x.com bridge.

(function () {
  const STORAGE_KEY = 'xvm_list_member_filter_v1';
  const DEFAULTS = {
    enabled: false,
    ttlMs: 24 * 60 * 60 * 1000,
    scopes: { home: true, list: true, profile: true, status: true },
    lists: [],
  };
  const LIMITS = globalThis.__xvmListMemberSource?.LIMITS || {
    maxLists: 5,
    maxMembersPerList: 5000,
    maxMembersTotal: 10000,
  };

  function t(key, ...subs) {
    try {
      const v = chrome?.i18n?.getMessage?.(key, subs.length ? subs.map(String) : undefined);
      if (v) return v;
    } catch (_) {}
    return key;
  }

  function storageGet(key, fallback) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(key, (o) => resolve(o?.[key] ?? fallback)); }
      catch (_) { resolve(fallback); }
    });
  }

  function storageSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, resolve); }
      catch (_) { resolve(); }
    });
  }

  function normalize(raw) {
    const out = { ...DEFAULTS, scopes: { ...DEFAULTS.scopes }, lists: [] };
    if (!raw || typeof raw !== 'object') return out;
    out.enabled = raw.enabled === true;
    out.ttlMs = Number.isFinite(raw.ttlMs) ? raw.ttlMs : DEFAULTS.ttlMs;
    if (raw.scopes && typeof raw.scopes === 'object') {
      out.scopes = {
        home: raw.scopes.home !== false,
        list: raw.scopes.list !== false,
        profile: raw.scopes.profile !== false,
        status: raw.scopes.status !== false,
      };
    }
    if (Array.isArray(raw.lists)) {
      out.lists = raw.lists.map(normalizeList).filter(Boolean);
    }
    return out;
  }

  function normalizeList(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const listId = String(raw.listId || raw.id || '').trim();
    const url = String(raw.url || '').trim();
    if (!listId && !url) return null;
    return {
      listId,
      url,
      name: String(raw.name || listId || url).trim(),
      screenName: String(raw.screenName || raw.ownerScreenName || '').trim().replace(/^@+/, '').toLowerCase(),
      enabled: raw.enabled !== false,
      members: Array.isArray(raw.members) ? raw.members : [],
      fetchedAt: Number.isFinite(raw.fetchedAt) ? raw.fetchedAt : 0,
      ttlMs: Number.isFinite(raw.ttlMs) ? raw.ttlMs : DEFAULTS.ttlMs,
      fetchStatus: ['ready', 'fetching', 'error', 'empty', 'stale'].includes(raw.fetchStatus) ? raw.fetchStatus : (raw.members?.length ? 'ready' : 'empty'),
      source: raw.source ? String(raw.source) : '',
      lastError: raw.lastError ? String(raw.lastError) : '',
    };
  }

  function parseListInput(raw) {
    const input = String(raw || '').trim();
    if (!input) return null;
    const numeric = input.match(/^\d+$/)?.[0] || '';
    const idFromUrl = input.match(/(?:x\.com|twitter\.com)\/i\/lists\/(\d+)/i)?.[1]
      || input.match(/\/lists\/(\d+)(?:[/?#]|$)/i)?.[1]
      || numeric;
    if (!idFromUrl && !/^https?:\/\//i.test(input)) return null;
    const parsed = {
      listId: idFromUrl,
      url: /^https?:\/\//i.test(input) ? input : (idFromUrl ? `https://x.com/i/lists/${idFromUrl}` : input),
      name: idFromUrl ? `List ${idFromUrl}` : input,
      enabled: true,
      members: [],
      fetchedAt: 0,
      ttlMs: DEFAULTS.ttlMs,
      fetchStatus: 'empty',
      source: '',
      lastError: '',
    };
    return parsed;
  }

  async function resolveTier() {
    const TL = globalThis.__xvmTierLogic;
    if (!TL) return { tier: 'free', daysLeft: 0, source: 'tier-logic-missing' };
    const lic = await storageGet('xvm_license_v1', null);
    const trial = await storageGet('xvm_trial_v1', null);
    return TL.resolveTierFrom(lic, trial, Date.now());
  }

  function buildSection() {
    const section = document.getElementById('list-member-filter-section');
    if (!section) return null;
    section.innerHTML = `
      <h2 class="rf-title" data-k="lfTitle"></h2>
      <p class="rf-locked-hint" id="lf-locked-hint" data-k="lfLockedHint" hidden></p>
      <label class="rf-toggle">
        <span data-k="lfEnabled"></span>
        <span class="switch">
          <input type="checkbox" id="lf-enabled" />
          <span class="slider"></span>
        </span>
      </label>
      <label class="rf-row" for="lf-list-input">
        <span data-k="lfInputLabel"></span>
        <input id="lf-list-input" type="text" placeholder="https://x.com/i/lists/1234567890" />
      </label>
      <div class="rf-actions">
        <button type="button" id="lf-add" class="rf-btn" data-k="lfAdd"></button>
        <button type="button" id="lf-save" class="rf-btn-ghost" data-k="rfSave"></button>
      </div>
      <p class="rf-rule-hint" data-k="lfCaptureHint"></p>
      <ul id="lf-list" class="col-list" aria-live="polite"></ul>
      <div class="rf-msg" id="lf-msg"></div>
    `;
    section.querySelectorAll('[data-k]').forEach((el) => { el.textContent = t(el.dataset.k); });
    return section;
  }

  function memberCount(lists) {
    return (lists || []).reduce((n, l) => n + (Array.isArray(l.members) ? l.members.length : 0), 0);
  }

  function isListStale(list, now = Date.now()) {
    const ttlMs = Number.isFinite(list?.ttlMs) ? list.ttlMs : DEFAULTS.ttlMs;
    return !!(list?.fetchedAt && ttlMs > 0 && now - list.fetchedAt > ttlMs);
  }

  function activeMemberCount(lists) {
    return (lists || [])
      .filter((l) => l.enabled !== false && !isListStale(l))
      .reduce((n, l) => n + (Array.isArray(l.members) ? l.members.length : 0), 0);
  }

  function hasReadyMembers(settings) {
    return activeMemberCount(settings.lists) > 0;
  }

  function isDuplicate(a, b) {
    if (a.listId && b.listId) return a.listId === b.listId;
    return a.url && b.url && a.url === b.url;
  }

  function statusText(list) {
    if (isListStale(list)) return t('lfStale');
    if (list.fetchStatus === 'ready') return t('lfReady');
    if (list.fetchStatus === 'fetching') return t('lfFetching');
    if (list.fetchStatus === 'error') return t('lfError');
    return t('lfEmptyMembers');
  }

  function setMessage(section, text, kind = 'ok') {
    const msg = section.querySelector('#lf-msg');
    msg.textContent = text;
    msg.dataset.kind = kind;
  }

  function setBusy(section, busy) {
    section.dataset.busy = busy ? '1' : '0';
    for (const el of section.querySelectorAll('#lf-add, #lf-save, #lf-list button')) {
      el.disabled = !!busy || section.dataset.locked === '1';
    }
  }

  function renderList(section, settings) {
    const ul = section.querySelector('#lf-list');
    ul.innerHTML = '';
    settings.lists.forEach((list, idx) => {
      const li = document.createElement('li');
      li.dataset.listId = list.listId;
      li.style.alignItems = 'flex-start';
      const label = document.createElement('div');
      label.style.flex = '1';
      const title = document.createElement('div');
      title.textContent = `${list.name || list.listId || list.url} · ${list.members.length} ${t('lfMembers')}`;
      const meta = document.createElement('div');
      meta.className = 'ft-desc';
      meta.textContent = list.lastError
        ? `${statusText(list)} · ${list.lastError}`
        : `${statusText(list)}${list.fetchedAt ? ` · ${new Date(list.fetchedAt).toLocaleString()}` : ''}`;
      label.append(title, meta);

      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'ft-lb-reset-btn';
      refresh.dataset.action = 'refresh';
      refresh.dataset.index = String(idx);
      refresh.textContent = t('lfRefresh');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ft-lb-reset-btn';
      del.dataset.action = 'delete';
      del.dataset.index = String(idx);
      del.textContent = t('lfDelete');
      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '4px';
      actions.append(refresh, del);
      li.append(label, actions);
      if (list.lastError) li.title = list.lastError;
      ul.appendChild(li);
    });
  }

  function setLocked(section, locked) {
    section.dataset.locked = locked ? '1' : '0';
    for (const el of section.querySelectorAll('input, button')) el.disabled = !!locked;
    const hint = section.querySelector('#lf-locked-hint');
    if (hint) hint.hidden = !locked;
  }

  async function mount() {
    const section = buildSection();
    if (!section) return;
    let settings = normalize(await storageGet(STORAGE_KEY, DEFAULTS));
    section.querySelector('#lf-enabled').checked = settings.enabled;
    renderList(section, settings);

    const { tier } = await resolveTier();
    setLocked(section, tier === 'free');
    let busy = false;

    async function fetchAndStore(parsed, replaceIndex = -1) {
      const source = globalThis.__xvmListMemberSource;
      if (!source?.fetchListMembers) throw new Error(t('lfSourceMissing'));
      const existingLists = replaceIndex >= 0
        ? settings.lists.filter((_, i) => i !== replaceIndex)
        : settings.lists;
      if (replaceIndex < 0 && existingLists.length >= LIMITS.maxLists) {
        throw new Error(t('lfLimitLists', LIMITS.maxLists));
      }
      const result = await source.fetchListMembers(parsed, { maxMembers: LIMITS.maxMembersPerList });
      const nextTotal = memberCount(existingLists) + result.members.length;
      if (nextTotal > LIMITS.maxMembersTotal) {
        throw new Error(t('lfLimitMembers', LIMITS.maxMembersTotal));
      }
      return normalizeList({
        ...parsed,
        ...result,
        name: result.name || parsed.name,
        enabled: parsed.enabled !== false,
        fetchStatus: 'ready',
        ttlMs: parsed.ttlMs || DEFAULTS.ttlMs,
        lastError: '',
      });
    }

    section.querySelector('#lf-add').addEventListener('click', async () => {
      if (busy) return;
      const parsed = parseListInput(section.querySelector('#lf-list-input').value);
      if (!parsed) {
        setMessage(section, t('lfInvalidInput'), 'err');
        return;
      }
      const duplicate = settings.lists.findIndex((l) => isDuplicate(l, parsed));
      if (duplicate < 0 && settings.lists.length >= LIMITS.maxLists) {
        setMessage(section, t('lfLimitLists', LIMITS.maxLists), 'err');
        return;
      }
      busy = true;
      setBusy(section, true);
      setMessage(section, t('lfFetching'), 'ok');
      try {
        const ready = await fetchAndStore(parsed, duplicate);
        const lists = duplicate >= 0 ? settings.lists.map((l, i) => i === duplicate ? ready : l) : [...settings.lists, ready];
        settings = normalize({ ...settings, lists });
        section.querySelector('#lf-list-input').value = '';
        renderList(section, settings);
        await storageSet({ [STORAGE_KEY]: settings });
        setMessage(section, t('lfFetchOk', ready.members.length), 'ok');
      } catch (e) {
        const failed = normalizeList({ ...parsed, fetchStatus: 'error', lastError: e.message || String(e) });
        const lists = duplicate >= 0 ? settings.lists.map((l, i) => i === duplicate ? failed : l) : [...settings.lists, failed];
        settings = normalize({ ...settings, lists });
        renderList(section, settings);
        await storageSet({ [STORAGE_KEY]: settings });
        setMessage(section, t('lfFetchFailed', e.message || String(e)), 'err');
      } finally {
        busy = false;
        setBusy(section, false);
      }
    });

    section.querySelector('#lf-list').addEventListener('click', async (event) => {
      if (busy) return;
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const idx = Number(btn.dataset.index);
      if (!Number.isInteger(idx) || !settings.lists[idx]) return;
      if (btn.dataset.action === 'delete') {
        settings = normalize({ ...settings, lists: settings.lists.filter((_, i) => i !== idx) });
        if (!hasReadyMembers(settings)) settings.enabled = false;
        section.querySelector('#lf-enabled').checked = settings.enabled;
        renderList(section, settings);
        await storageSet({ [STORAGE_KEY]: settings });
        setMessage(section, t('lfDeletedOk'), 'ok');
        return;
      }
      if (btn.dataset.action === 'refresh') {
        busy = true;
        setBusy(section, true);
        setMessage(section, t('lfFetching'), 'ok');
        try {
          const ready = await fetchAndStore(settings.lists[idx], idx);
          settings = normalize({ ...settings, lists: settings.lists.map((l, i) => i === idx ? ready : l) });
          renderList(section, settings);
          await storageSet({ [STORAGE_KEY]: settings });
          setMessage(section, t('lfFetchOk', ready.members.length), 'ok');
        } catch (e) {
          settings = normalize({
            ...settings,
            lists: settings.lists.map((l, i) => i === idx ? normalizeList({ ...l, fetchStatus: 'error', lastError: e.message || String(e) }) : l),
          });
          renderList(section, settings);
          await storageSet({ [STORAGE_KEY]: settings });
          setMessage(section, t('lfFetchFailed', e.message || String(e)), 'err');
        } finally {
          busy = false;
          setBusy(section, false);
        }
      }
    });

    section.querySelector('#lf-save').addEventListener('click', async () => {
      settings = normalize({ ...settings, enabled: section.querySelector('#lf-enabled').checked });
      if (settings.enabled && !hasReadyMembers(settings)) {
        settings.enabled = false;
        section.querySelector('#lf-enabled').checked = false;
        await storageSet({ [STORAGE_KEY]: settings });
        setMessage(section, t('lfEmptyMembers'), 'err');
        return;
      }
      await storageSet({ [STORAGE_KEY]: settings });
      setMessage(section, t('rfSavedOk'), 'ok');
    });

    try {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'local') return;
        if ('xvm_license_v1' in changes || 'xvm_trial_v1' in changes) {
          const r = await resolveTier();
          setLocked(section, r.tier === 'free');
        }
        if (STORAGE_KEY in changes) {
          settings = normalize(changes[STORAGE_KEY].newValue);
          section.querySelector('#lf-enabled').checked = settings.enabled;
          renderList(section, settings);
        }
      });
    } catch (_) {}
  }

  document.addEventListener('DOMContentLoaded', mount);
  window.__xvmListMemberFilterPopup = { STORAGE_KEY, DEFAULTS, LIMITS, mount, parseListInput };
})();
