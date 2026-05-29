# Red Viral Monitor

[中文](README.md)

Red Viral Monitor is a Manifest V3 browser extension built only for Xiaohongshu Web. It no longer matches or loads on X/Twitter.

## Features

| Feature | Surface | Notes |
|---|---|---|
| Heat badges | Note cards / note detail | Scores likes, collects, comments, and shares into interaction heat and hourly speed |
| Page leaderboard | Draggable floating panel | Ranks notes captured on the current page by interaction speed |
| Markdown copy | Floating note button | Copies title, body, images, metrics, and source URL |
| DOM fallback | Xiaohongshu layout drift | Extracts visible note title, author, links, images, and metrics when API data is partial |

## Development Install

```bash
npm install
npm run build:dist
```

Open `chrome://extensions/` in Chrome or Edge, enable Developer Mode, and load the generated `dist/` directory.

## How It Works

The extension passively observes `fetch` / `XMLHttpRequest` responses on Xiaohongshu pages and reads note data from `/api/sns/web/` payloads. It does not upload note content to external services and does not mutate Xiaohongshu requests.

When API data is incomplete, `content.js` scans visible note DOM as a fallback.

## License

MIT. See [LICENSE](LICENSE).
