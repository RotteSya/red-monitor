# Red Viral Monitor

[中文](README.md)

Red Viral Monitor is a Manifest V3 browser extension for Xiaohongshu Web. The current loadable build matches only `xiaohongshu.com` and adds note heat badges, a page-level heat leaderboard, and Markdown copy actions.

## Features

| Feature | Surface | Notes |
|---|---|---|
| Heat badges | Note cards / note detail | Scores likes, collects, comments, and shares into interaction heat and hourly speed, with default thresholds of `100/h` (UP) and `500/h` (HOT) |
| Page leaderboard | Draggable floating panel | Ranks notes captured on the current page by interaction speed, with configurable count, columns, and position reset |
| Markdown copy | Floating note button | Copies title, body, author, images, metrics, and source URL |
| DOM fallback | Xiaohongshu layout drift | Extracts visible note title, author, links, images, and metrics when API data is partial |
| Popup settings | Extension popup | Configures thresholds, badge style, leaderboard columns, language, and theme |

The UI supports Chinese, English, and Japanese. Settings are stored in `chrome.storage.sync`; leaderboard position is stored in `chrome.storage.local`.

## Development Install

```bash
npm install
npm test
npm run build:dist
```

Open `chrome://extensions/` in Chrome or Edge, enable Developer Mode, and load the generated `dist/` directory. Do not load the repository root directly: the build script copies only the files needed by the current Xiaohongshu extension.

## How It Works

The extension is split across the page and extension environments:

- `lib/xhs-net-hook.js` runs in the page `MAIN` world and passively observes `fetch` / `XMLHttpRequest` responses for `/api/sns/web/` note payloads.
- `content.js` merges API and DOM extraction results, then renders badges, the leaderboard, and Markdown copy buttons.
- `bridge.js` runs in the isolated extension world and relays `chrome.storage` settings to page scripts through `window.postMessage`.
- `popup.html` / `popup.js` provide the settings UI.

The Xiaohongshu extension does not upload note content to external services and does not mutate Xiaohongshu requests. When API data is incomplete, `content.js` scans visible note DOM as a fallback.

## Commands

```bash
npm test              # Run Vitest contract tests
npm run build:dist    # Refresh the Chrome-loadable dist/ directory
```

`npm test` covers the important contracts: the manifest matches only Xiaohongshu, `dist/` contains only current extension files, popup controls stay wired to the script, and content extraction uses Xiaohongshu fields.

## Project Layout

```
├── _locales/                  # i18n messages (zh_CN / en / ja)
├── icons/icon-v4-*.png        # Extension icons
├── lib/xhs-net-hook.js        # Xiaohongshu fetch/XHR read-only observer
├── bridge.js                  # Isolated-world bridge to page MAIN world
├── content.js                 # Xiaohongshu note heat, leaderboard, and copy logic
├── popup.html / popup.js      # Settings popup
├── styles.css                 # Styles injected into Xiaohongshu pages
├── scripts/build-dist.mjs     # Generates the loadable extension directory
├── tests/                     # Vitest contract tests
└── manifest.json              # Chrome extension manifest
```

## License

MIT. See [LICENSE](LICENSE).
