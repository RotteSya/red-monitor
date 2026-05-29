import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

describe('dist build contract', () => {
  it('ships only the Xiaohongshu extension files', () => {
    const items = readBuildItems();
    expect(items).toEqual([
      '_locales',
      'icons',
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
