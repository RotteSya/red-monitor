# Privacy Policy for Red Viral Monitor

**Last updated:** May 30, 2026

Red Viral Monitor is a Chrome extension for Xiaohongshu Web. It adds heat badges, a page leaderboard, and Markdown copy tools to pages the user is already viewing.

## What the extension handles

The extension may read the following data from `xiaohongshu.com` pages:

- Visible note text, title, author, image URLs, source links, and public interaction counts such as likes, collects, comments, and shares.
- Xiaohongshu Web API responses that are already loaded by the page, limited to `/api/sns/web/` note data used to power the extension features.
- User preferences configured in the extension popup, such as heat thresholds, badge style, visible leaderboard columns, language, and theme.

## How the data is used

The extension uses this data only to provide its single purpose:

- Showing heat badges on Xiaohongshu notes.
- Ranking notes on the current page by interaction speed.
- Copying note information as Markdown when the user chooses that action.
- Remembering user settings and local UI preferences.

## Storage

- `chrome.storage.sync` stores extension settings such as thresholds, feature toggles, language, theme, badge style, and leaderboard column preferences.
- `chrome.storage.local` stores local UI state such as the leaderboard position.

Chrome Sync may sync `chrome.storage.sync` data through the user's Google account according to Chrome's own sync behavior. The extension developer does not receive this data.

## Data sharing and transfers

Red Viral Monitor does not send note content, browsing history, analytics, telemetry, or personal information to developer-operated servers.

The extension does not:

- Sell user data.
- Use user data for advertising or retargeting.
- Share user data with analytics or tracking services.
- Allow the developer or other humans to read user data.
- Access passwords, payment information, health information, or precise location.

## Host access

The extension runs only on:

- `https://xiaohongshu.com/*`
- `https://www.xiaohongshu.com/*`
- `https://*.xiaohongshu.com/*`

This access is required so the extension can render badges and the leaderboard directly on Xiaohongshu Web pages and read the note data already present on those pages.

## Remote code

The extension does not load remote JavaScript. All extension code is included in the package distributed through the Chrome Web Store.

## Contact

For questions, please open an issue at:

https://github.com/RotteSya/red-monitor

