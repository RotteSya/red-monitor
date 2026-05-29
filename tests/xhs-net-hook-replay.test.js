import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const hookSource = readFileSync(resolve(repo, 'lib/xhs-net-hook.js'), 'utf8');

function makeFakeResponse(url) {
  const response = {
    json: async () => ({ url, ok: true }),
  };
  response.clone = () => makeFakeResponse(url);
  return response;
}

function loadHook() {
  const fakeWindow = {
    fetch: async (url) => makeFakeResponse(url),
    addEventListener() {},
  };
  class FakeXHR {
    open() {}
    setRequestHeader() {}
    send() {}
    addEventListener() {}
  }
  FakeXHR.prototype.open = function () {};
  FakeXHR.prototype.setRequestHeader = function () {};
  const ctx = {
    window: fakeWindow,
    XMLHttpRequest: FakeXHR,
    Request: class {},
    URL,
    Headers: class { forEach() {} },
    console,
    Date,
  };
  vm.runInNewContext(hookSource, ctx);
  return { net: ctx.window.__rvmNet, win: ctx.window };
}

describe('xhs-net-hook response replay', () => {
  it('replays a recent matching Xiaohongshu API response to a late subscriber', async () => {
    const { net, win } = loadHook();
    const url = 'https://edith.xiaohongshu.com/api/sns/web/v1/homefeed';
    await win.fetch(url);

    const seen = [];
    net.onResponse(/\/api\/sns\/web\//, ({ url: seenUrl }) => seen.push(seenUrl));

    expect(seen).toEqual([url]);
  });

  it('keeps replayed fetch responses clone-able', async () => {
    const { net, win } = loadHook();
    const url = 'https://edith.xiaohongshu.com/api/sns/web/v1/feed';
    await win.fetch(url);

    let done;
    const handled = new Promise((resolveDone) => { done = resolveDone; });
    net.onResponse(/\/api\/sns\/web\//, async ({ response }) => {
      done(await response.clone().json());
    });

    await expect(handled).resolves.toEqual({ url, ok: true });
  });

  it('does not replay non-matching responses', async () => {
    const { net, win } = loadHook();
    await win.fetch('https://example.com/health.json');

    const seen = [];
    net.onResponse(/\/api\/sns\/web\//, ({ url }) => seen.push(url));

    expect(seen).toEqual([]);
  });
});
