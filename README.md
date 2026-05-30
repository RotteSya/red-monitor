# Red Viral Monitor

[English](README.en.md)

Red Viral Monitor 是一个专门面向小红书 Web 端的 Manifest V3 浏览器扩展。当前可加载版本只匹配 `xiaohongshu.com`，用于在页面内标记笔记互动热度、生成当前页面热度榜，并把笔记复制为 Markdown。

## 功能

| 功能 | 位置 | 说明 |
|---|---|---|
| 热度徽章 | 笔记卡片 / 笔记详情 | 根据点赞、收藏、评论、分享计算互动热度与每小时速度，默认阈值为 `100/h`（UP）和 `500/h`（HOT） |
| 页面热度榜 | 可拖拽浮动面板 | 当前页面捕获到的笔记按互动速度排序，支持设置条数、列显示和面板位置重置 |
| Markdown 复制 | 笔记浮层按钮 | 复制标题、正文、作者、图片、互动数据和来源链接 |
| DOM 兜底 | 小红书页面结构变化时 | API 数据不足时从可见笔记卡片中提取标题、作者和指标 |
| Popup 设置 | 扩展弹窗 | 设置阈值、徽章样式、榜单列、语言和主题 |

支持中文、英文、日文界面。设置保存在 `chrome.storage.sync`，榜单位置保存在 `chrome.storage.local`。

## 安装开发版

```bash
npm install
npm test
npm run build:dist
```

然后打开 Chrome / Edge 的 `chrome://extensions/`，启用开发者模式，加载本仓库生成的 `dist/` 目录。不要直接加载仓库根目录：构建脚本会只同步当前小红书扩展需要的文件。

## 工作原理

扩展分成两个页面运行环境：

- `lib/xhs-net-hook.js` 在页面 `MAIN` world 中只读观察 `fetch` / `XMLHttpRequest` 响应，识别 `/api/sns/web/` 返回的笔记数据。
- `content.js` 合并 API 与 DOM 提取结果，在页面上渲染徽章、榜单和 Markdown 复制按钮。
- `bridge.js` 在扩展隔离环境中读取 `chrome.storage`，通过 `window.postMessage` 把设置同步给页面脚本。
- `popup.html` / `popup.js` 提供设置界面。

小红书扩展不会向外部服务上传笔记内容，也不会修改小红书请求。当 API 响应里没有完整指标时，`content.js` 会扫描页面上的笔记 DOM，尽量从可见文本、链接和图片里补齐数据。

## 常用命令

```bash
npm test              # 运行 Vitest 合同测试
npm run build:dist    # 刷新 Chrome 可加载的 dist/ 目录
```

`npm test` 会覆盖以下关键合同：manifest 只匹配小红书、dist 只包含当前扩展文件、popup 控件与脚本保持一致、内容脚本使用小红书字段。

## 项目结构

```
├── _locales/                  # 国际化文案（zh_CN / en / ja）
├── icons/icon-v4-*.png        # 扩展图标
├── lib/xhs-net-hook.js        # 小红书 fetch/XHR 只读观察器
├── bridge.js                  # 扩展隔离环境与页面 MAIN world 通信
├── content.js                 # 小红书笔记热度、榜单、复制逻辑
├── popup.html / popup.js      # 设置弹窗
├── styles.css                 # 注入页面的样式
├── scripts/build-dist.mjs     # 生成可加载扩展目录
├── tests/                     # Vitest 合同测试
└── manifest.json              # Chrome 扩展清单
```

## 许可证

MIT. See [LICENSE](LICENSE).
