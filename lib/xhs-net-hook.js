// Xiaohongshu net-hook: single chokepoint for observing page fetch/XHR calls.
// It is intentionally read-only; subscribers can inspect responses without
// mutating Xiaohongshu requests or user session state.
(() => {
  if (window.__rvmNet) {
    window.__rvmNet._resetSubs();
    return;
  }

  const reqSubs = [];
  const resSubs = [];
  const RES_HISTORY = [];
  const RES_HISTORY_MAX = 80;
  const RES_HISTORY_TTL_MS = 15_000;

  function pruneHistory(now = Date.now()) {
    while (RES_HISTORY[0] && now - RES_HISTORY[0].ts > RES_HISTORY_TTL_MS) RES_HISTORY.shift();
    while (RES_HISTORY.length > RES_HISTORY_MAX) RES_HISTORY.shift();
  }

  function extractUrl(input) {
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;
    if (typeof input === 'string') return input;
    return null;
  }

  function normalizeHeaders(headersLike) {
    const out = {};
    if (!headersLike) return out;
    try {
      if (headersLike instanceof Headers) {
        headersLike.forEach((value, key) => { out[key.toLowerCase()] = value; });
      } else if (typeof headersLike === 'object') {
        for (const key of Object.keys(headersLike)) out[key.toLowerCase()] = headersLike[key];
      }
    } catch (_) {}
    return out;
  }

  function notifyReq(url, init, headers, source) {
    if (!url) return;
    for (const sub of reqSubs) {
      if (!sub.matcher.test(url)) continue;
      try { sub.fn({ url, init, headers, source }); } catch (_) {}
    }
  }

  function notifyRes(url, response, source) {
    if (!url) return;
    const historyResponse = source === 'fetch' && typeof response?.clone === 'function'
      ? (() => { try { return response.clone(); } catch (_) { return response; } })()
      : response;
    RES_HISTORY.push({ url, response: historyResponse, source, ts: Date.now() });
    pruneHistory();

    for (const sub of resSubs) {
      if (!sub.matcher.test(url)) continue;
      try { sub.fn({ url, response, source }); } catch (_) {}
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = extractUrl(args[0]);
    const init = args[1] || {};
    const rawHeaders = init.headers || (args[0] instanceof Request ? args[0].headers : null);
    const headers = normalizeHeaders(rawHeaders);
    notifyReq(url, init, headers, 'fetch');
    const response = await originalFetch.apply(this, args);
    notifyRes(url, response, 'fetch');
    return response;
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const urlStr = url instanceof URL ? url.href : (typeof url === 'string' ? url : null);
    this.__rvmNet = { method, url: urlStr, headers: {} };
    if (urlStr) {
      this.addEventListener('load', function () {
        const meta = this.__rvmNet || {};
        notifyReq(urlStr, { method: meta.method }, meta.headers || {}, 'xhr');
        notifyRes(urlStr, {
          status: this.status,
          getHeader: (name) => this.getResponseHeader(name),
          text: () => this.responseText,
          json: () => JSON.parse(this.responseText),
        }, 'xhr');
      });
    }
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__rvmNet) this.__rvmNet.headers[String(name).toLowerCase()] = value;
    return xhrSetHeader.apply(this, arguments);
  };

  window.__rvmNet = {
    originalFetch,
    onRequest(matcher, fn) { reqSubs.push({ matcher, fn }); },
    onResponse(matcher, fn) {
      resSubs.push({ matcher, fn });
      pruneHistory();
      for (const h of RES_HISTORY) {
        if (!matcher.test(h.url)) continue;
        try { fn({ url: h.url, response: h.response, source: h.source }); } catch (_) {}
      }
    },
    _resetSubs() {
      reqSubs.length = 0;
      resSubs.length = 0;
    },
  };
})();
