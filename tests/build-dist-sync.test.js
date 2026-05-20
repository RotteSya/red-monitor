// Byte-level contract: every file dist/ ships must exactly match the
// source tree. Defends against the v1.7.0 ship-blocker bug class
// where `npm run build:dist` either silently skipped a file or copied
// a stale version, producing the 'UI renders the raw i18n key
// "contentLbHotOnly"' symptom because dist/bridge.js lagged behind
// source.
//
// CI guarantee: if the test runs and passes, dist/ is in lock-step with
// source. Developers MUST run `npm run build:dist` before checking in
// (or shipping) — otherwise this fails.

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const dist = resolve(repo, 'dist');

// Same canonical 11 items the build script ships. Read from the build
// script itself so adding a file to ITEMS automatically gets covered.
function readItems() {
  const src = readFileSync(resolve(repo, 'scripts/build-dist.mjs'), 'utf8');
  const m = src.match(/ITEMS\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

function listFilesRec(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const st = statSync(root);
  if (st.isFile()) return [root];
  for (const name of readdirSync(root)) {
    out.push(...listFilesRec(join(root, name)));
  }
  return out;
}

describe('#45 build:dist byte-level sync (Codex P0 fix follow-up)', () => {
  it('dist/ exists (else: run `npm run build:dist`)', () => {
    expect(existsSync(dist),
      'dist/ is missing — run `npm run build:dist` before commit/ship'
    ).toBe(true);
  });

  it('every ITEMS entry has matching byte content under dist/', () => {
    const items = readItems();
    expect(items.length, 'build-dist.mjs ITEMS must declare at least one entry').toBeGreaterThan(0);
    const stale = [];
    for (const item of items) {
      const srcPath = resolve(repo, item);
      const dstPath = resolve(dist, item);
      if (!existsSync(srcPath)) continue; // source removed; build skips
      if (!existsSync(dstPath)) {
        stale.push(`${item} (missing in dist/)`);
        continue;
      }
      const srcSt = statSync(srcPath);
      if (srcSt.isFile()) {
        const srcBuf = readFileSync(srcPath);
        const dstBuf = readFileSync(dstPath);
        if (Buffer.compare(srcBuf, dstBuf) !== 0) {
          stale.push(`${item} (content differs)`);
        }
        continue;
      }
      // Directory: walk every file under it and compare 1:1.
      const srcFiles = listFilesRec(srcPath);
      for (const sf of srcFiles) {
        const rel = relative(srcPath, sf);
        const df = join(dstPath, rel);
        if (!existsSync(df)) { stale.push(`${item}/${rel} (missing in dist/)`); continue; }
        const srcBuf = readFileSync(sf);
        const dstBuf = readFileSync(df);
        if (Buffer.compare(srcBuf, dstBuf) !== 0) {
          stale.push(`${item}/${rel} (content differs)`);
        }
      }
    }
    expect(stale,
      `dist/ is out of sync with source. Run \`npm run build:dist\` to refresh.\nStale entries:\n${stale.map((s) => '  - ' + s).join('\n')}`
    ).toEqual([]);
  });
});
