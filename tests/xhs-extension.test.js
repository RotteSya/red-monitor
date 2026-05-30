import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const manifest = JSON.parse(readFileSync(resolve(repo, 'manifest.json'), 'utf8'));
const popupHtml = readFileSync(resolve(repo, 'popup.html'), 'utf8');
const popupJs = readFileSync(resolve(repo, 'popup.js'), 'utf8');
const bridgeJs = readFileSync(resolve(repo, 'bridge.js'), 'utf8');
const contentJs = readFileSync(resolve(repo, 'content.js'), 'utf8');
const buildScript = readFileSync(resolve(repo, 'scripts/build-dist.mjs'), 'utf8');

function readMessages(locale) {
  return JSON.parse(readFileSync(resolve(repo, `_locales/${locale}/messages.json`), 'utf8'));
}

function messageStrings(locale) {
  return Object.fromEntries(Object.entries(readMessages(locale)).map(([key, entry]) => [key, entry.message]));
}

function loadContentHooks(locale = 'zh_CN', href = 'https://www.xiaohongshu.com/explore/64f1abcd1234') {
  const hooks = {};
  const context = {
    __RVM_TEST_HOOKS__: hooks,
    console,
    URL,
    location: { href },
    navigator: { clipboard: { writeText: async () => {} } },
    Node: { ELEMENT_NODE: 1 },
    MutationObserver: class {
      observe() {}
    },
    document: {
      readyState: 'loading',
      body: null,
      documentElement: { dataset: {} },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
  };
  context.window = context;
  context.window.addEventListener = () => {};
  context.window.postMessage = () => {};
  context.window.__rvmNet = { onResponse() {} };
  const testableContentJs = contentJs.replace(
    '\n  const observer = new MutationObserver',
    `\n  Object.assign(globalThis.__RVM_TEST_HOOKS__, {
    buildNoteMarkdown,
    setLocalizedStrings(messages = {}) {
      localizedStrings = messages;
    },
  });\n\n  const observer = new MutationObserver`
  );
  new Script(testableContentJs, { filename: 'content.js' }).runInContext(createContext(context));
  hooks.setLocalizedStrings(messageStrings(locale));
  return hooks;
}

function markdownElement({ innerText = '', images = [] } = {}) {
  const imageNodes = images.map((url) => ({ src: url, currentSrc: url }));
  const querySelectorAll = (selector) => (selector === 'img[src]' ? imageNodes : []);
  return {
    innerText,
    textContent: innerText,
    cloneNode() {
      return {
        innerText,
        textContent: innerText,
        querySelectorAll,
      };
    },
    querySelector() { return null; },
    querySelectorAll,
  };
}

function detailMarkdownElement() {
  const titleNode = textNode('城市漫步路线');
  const descNode = textNode('上午逛咖啡店\n下午去旧书店');
  const metricNodes = [
    textNode('', { ariaLabel: '点赞 2400' }),
    textNode('', { ariaLabel: '收藏 1100' }),
    textNode('', { ariaLabel: '评论 88' }),
    textNode('', { ariaLabel: '分享 12' }),
  ];
  const selectorMap = new Map([
    ['#detail-title', [titleNode]],
    ['#detail-desc', [descNode]],
    ['.interaction-container', [{ querySelectorAll: () => metricNodes, closest: () => null }]],
  ]);
  return {
    innerText: '城市漫步路线\n\n上午逛咖啡店\n下午去旧书店\n\n评论\n路人甲\n这条路线我也走过\n路人乙\n求地址',
    textContent: '城市漫步路线\n\n上午逛咖啡店\n下午去旧书店\n\n评论\n路人甲\n这条路线我也走过\n路人乙\n求地址',
    cloneNode() {
      return {
        innerText: this.innerText,
        textContent: this.textContent,
        querySelectorAll(selector) {
          if (/comment|xvm|textarea|input|contenteditable/.test(selector)) return [textNode('评论\n路人甲\n这条路线我也走过')];
          return [];
        },
      };
    },
    querySelector(selector) {
      return selectorMap.get(selector)?.[0] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[aria-label],[title],button,span,div') return metricNodes;
      return selectorMap.get(selector) || [];
    },
  };
}

function textNode(text, attrs = {}) {
  return {
    innerText: text,
    textContent: text,
    childElementCount: 0,
    closest: () => null,
    remove() {},
    getAttribute(name) {
      if (name === 'aria-label') return attrs.ariaLabel || '';
      if (name === 'title') return attrs.title || '';
      return '';
    },
    querySelectorAll() { return []; },
  };
}

function readBuildItems() {
  const block = buildScript.match(/ITEMS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  return [...block.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

describe('Xiaohongshu-only extension manifest', () => {
  it('matches Xiaohongshu domains and does not match X/Twitter', () => {
    const matches = manifest.content_scripts.flatMap((entry) => entry.matches || []);
    expect(matches.some((match) => match.includes('xiaohongshu.com'))).toBe(true);
    expect(matches.join('\n')).not.toMatch(/x\.com|twitter\.com|pro\.x\.com/i);
  });

  it('loads only the Xiaohongshu bridge, net hook, and content script', () => {
    const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
    expect(scripts).toEqual(['bridge.js', 'lib/xhs-net-hook.js', 'content.js']);
    expect(scripts.join('\n')).not.toMatch(/grok|starchart|x-net-hook|x-client|premium|rate-filter|content-filter/i);
  });

  it('does not request remote-rule host permissions from the old extension', () => {
    expect(manifest.host_permissions || []).not.toContain('https://raw.githubusercontent.com/*');
  });
});

describe('Xiaohongshu popup contract', () => {
  it('has settings, leaderboard, and about tabs only', () => {
    const tabs = [...popupHtml.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(['settings', 'leaderboard', 'about']);
    expect(popupHtml).not.toMatch(/Grok|Tweet|Retweet|StarChart|xvm-pro-section|rate-filter-section/i);
  });

  it('keeps the controls used by popup.js', () => {
    for (const id of [
      'settings-form',
      'trending',
      'viral',
      'badge-style',
      'feat-copy-md',
      'feat-leaderboard',
      'lb-count',
      'lb-col-list',
      'lb-reset-pos',
      'language-select',
      'theme-toggle',
    ]) {
      expect(popupHtml).toContain(`id="${id}"`);
    }
  });

  it('persists settings through chrome.storage.sync', () => {
    expect(popupJs).toMatch(/chrome\.storage\.sync\.get/);
    expect(popupJs).toMatch(/chrome\.storage\.sync\.set/);
    expect(popupJs).toContain('leaderboardColumns');
    expect(popupJs).toContain('featureCopyAsMarkdown');
  });
});

describe('Xiaohongshu runtime bridge/content contract', () => {
  it('uses RVM postMessage events and the Xiaohongshu API matcher', () => {
    expect(bridgeJs).toContain('RVM_SETTINGS_UPDATE');
    expect(contentJs).toContain('RVM_REQUEST_SETTINGS');
    expect(contentJs).toContain('const XHS_API_RE =');
    expect(contentJs).toContain('api\\/sns\\/web');
    expect(contentJs).toContain('__rvmNet');
  });

  it('extracts Xiaohongshu note fields instead of tweet fields', () => {
    expect(contentJs).toContain('note_card');
    expect(contentJs).toContain('interact_info');
    expect(contentJs).toContain('collected_count');
    expect(contentJs).toContain('buildNoteMarkdown');
    expect(contentJs).not.toMatch(/tweet_results|HomeTimeline|Retweeters|grok\.x\.com|data-testid="tweet"/i);
  });

  it('keeps leaderboard jumps bound to note links instead of generic DOM ids', () => {
    const fn = contentJs.match(/function getNoteIdFromElement\(el\) \{([\s\S]*?)\n  \}/)?.[1] || '';
    expect(fn.indexOf('fromOwnHref')).toBeGreaterThan(-1);
    expect(fn.indexOf('const generic')).toBeGreaterThan(-1);
    expect(fn.indexOf('fromOwnHref')).toBeLessThan(fn.indexOf('const generic'));
    expect(contentJs).toContain('resolveNoteElement(item.id)');
    expect(contentJs).toContain('findNoteElementById(id)');
    expect(contentJs).toContain('bindLeaderboardList(leaderboardEl.querySelector');
    expect(contentJs).toContain('isOwnMutationBatch(mutations)');
    expect(contentJs).toContain('scrollToRememberedNote(item.id)');
  });

  it('prefers explicit Xiaohongshu note ids from API payloads', () => {
    const fn = contentJs.match(/function extractNoteData\(raw\) \{([\s\S]*?)\n  function extractImageUrl/)?.[1] || '';
    expect(fn.indexOf('raw.note_id')).toBeGreaterThan(-1);
    expect(fn.indexOf('raw.id')).toBeGreaterThan(-1);
    expect(fn.indexOf('raw.note_id')).toBeLessThan(fn.indexOf('raw.id'));
  });

  it('declares required content i18n keys in all locales', () => {
    const required = [
      'extName',
      'extDescription',
      'contentLikes',
      'contentCollects',
      'contentComments',
      'contentShares',
      'contentHeat',
      'contentVelocity',
      'contentLeaderboardTitle',
      'contentCopyMdLabel',
      'contentFallbackNoteLabel',
    ];
    for (const locale of ['zh_CN', 'en', 'ja']) {
      const messages = readMessages(locale);
      for (const key of required) expect(messages[key]?.message, `${locale}/${key}`).toBeTruthy();
    }
  });
});

describe('Markdown copy formatter', () => {
  it('outputs archival note Markdown without heat or velocity fields', () => {
    const id = '64f1abcd1234';
    const hooks = loadContentHooks('zh_CN', `https://www.xiaohongshu.com/explore/${id}?xsec_token=current-token`);
    const images = [
      'https://img.example/a.jpg',
      'https://img.example/b.jpg',
      'https://img.example/c.jpg',
      'https://img.example/d.jpg',
      'https://img.example/e.jpg',
      'https://img.example/f.jpg',
      'https://img.example/g.jpg',
      'https://img.example/h.jpg',
      'https://img.example/i.jpg',
      'https://img.example/j.jpg',
    ];
    const md = hooks.buildNoteMarkdown({
      id,
      title: '周末露营清单',
      text: '周末露营清单\n\n帐篷和炉具都要提前检查\n复制笔记为 Markdown\nHOT 520/h',
      authorName: '溪边计划',
      createdAt: '2026-05-01T10:00:00.000Z',
      url: `https://www.xiaohongshu.com/explore/${id}`,
      image: images[0],
      likes: 2400,
      collects: 1100,
      comments: 88,
      shares: 12,
      heat: 9999,
      velocity: 520,
      estimatedVelocity: true,
    }, markdownElement({ images }));

    expect(md).toContain('# 周末露营清单');
    expect(md).toContain('> 作者: 溪边计划');
    expect(md).toContain('> 发布: 2026-05-01');
    expect(md).toContain(`> 来源: https://www.xiaohongshu.com/explore/${id}?xsec_token=current-token`);
    expect(md).toContain('帐篷和炉具都要提前检查');
    expect(md).toContain('- 点赞: 2.4k');
    expect(md).toContain('- 收藏: 1.1k');
    expect(md).toContain('- 评论: 88');
    expect(md).toContain('- 分享: 12');
    expect(md).not.toMatch(/互动热度|热度速度|估算|heat|velocity|9999|520\/h/i);
    expect(md).not.toContain('复制笔记为 Markdown');
    expect(md).not.toContain('HOT 520/h');
    expect(md.split('\n').filter((line) => line.startsWith('![]('))).toHaveLength(9);
    expect(md.split('\n').at(-1)).toBe('来自插件：Red Viral Monitor');
  });

  it('falls back to readable DOM text and omits missing optional metadata', () => {
    const hooks = loadContentHooks('zh_CN', 'https://www.xiaohongshu.com/explore/anothernoteid');
    const md = hooks.buildNoteMarkdown({
      id: '64f1abcd5678',
      likes: 0,
      collects: 0,
      comments: 0,
      shares: 0,
    }, markdownElement({ innerText: '正文首行\n\n更多内容' }));

    expect(md).toContain('# 正文首行');
    expect(md).toContain('更多内容');
    expect(md).toContain('> 来源: https://www.xiaohongshu.com/explore/64f1abcd5678');
    expect(md).not.toContain('> 作者:');
    expect(md).not.toContain('> 发布:');
    expect(md.split('\n').at(-1)).toBe('来自插件：Red Viral Monitor');
  });

  it('does not copy detail-page comments or reuse one suspicious metric value', () => {
    const hooks = loadContentHooks('zh_CN', 'https://www.xiaohongshu.com/explore/64f1abcd9999');
    const md = hooks.buildNoteMarkdown({
      id: '64f1abcd9999',
      likes: 7,
      collects: 7,
      comments: 7,
      shares: 7,
    }, detailMarkdownElement());

    expect(md).toContain('# 城市漫步路线');
    expect(md).toContain('上午逛咖啡店');
    expect(md).toContain('下午去旧书店');
    expect(md).not.toContain('路人甲');
    expect(md).not.toContain('这条路线我也走过');
    expect(md).toContain('- 点赞: 2.4k');
    expect(md).toContain('- 收藏: 1.1k');
    expect(md).toContain('- 评论: 88');
    expect(md).toContain('- 分享: 12');
  });

});

describe('dist build contract', () => {
  it('ships only the Xiaohongshu extension files', () => {
    const items = readBuildItems();
    expect(items).toEqual([
      '_locales',
      'icons/icon-v4-16.png',
      'icons/icon-v4-48.png',
      'icons/icon-v4-128.png',
      'lib/xhs-net-hook.js',
      'bridge.js',
      'content.js',
      'manifest.json',
      'popup.html',
      'popup.js',
      'styles.css',
    ]);
  });

  it('does not ship legacy X/Twitter-only source trees', () => {
    const items = readBuildItems().join('\n');
    expect(items).not.toMatch(/^src$|^userscript$|starchart\.js|popup-dashboard\.js|x-net-hook/i);
  });
});
