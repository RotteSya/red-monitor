#!/usr/bin/env node
// Sync the loadable extension source tree to ./dist for quick bb-browser
// reloads. Run after any source change; bb-browser users keep the same
// "Load unpacked → dist/" mapping and just click "Reload" in chrome.
//
// Usage: node scripts/build-dist.mjs

import { rmSync, mkdirSync, cpSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

// Xiaohongshu-only MV3 extension shipping set. Keep this list narrow so
// legacy X/Twitter modules in the source tree are not copied into dist/.
const ITEMS = [
  '_locales',
  'icons',
  'lib/xhs-net-hook.js',
  'bridge.js',
  'content.js',
  'manifest.json',
  'popup.html',
  'popup.js',
  'styles.css',
];

function main() {
  let cleanRoot = true;
  if (existsSync(dist)) {
    try {
      rmSync(dist, { recursive: true, force: true });
    } catch (err) {
      if (err?.code !== 'EBUSY') throw err;
      cleanRoot = false;
      console.warn('[build-dist] dist/ is locked, refreshing entries in place');
      for (const item of ITEMS) {
        rmSync(resolve(dist, item), { recursive: true, force: true });
      }
    }
  }
  mkdirSync(dist, { recursive: true });

  let copied = 0;
  for (const item of ITEMS) {
    const src = resolve(root, item);
    const dst = resolve(dist, item);
    if (!existsSync(src)) {
      console.warn(`[build-dist] skip missing: ${item}`);
      continue;
    }
    const st = statSync(src);
    if (st.isDirectory()) {
      cpSync(src, dst, { recursive: true });
    } else {
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst);
    }
    copied += 1;
  }
  console.log(`[build-dist] synced ${copied} entries to dist/${cleanRoot ? '' : ' (in-place)'}`);
  console.log(`[build-dist] chrome → load unpacked → ${dist}`);
}

main();
