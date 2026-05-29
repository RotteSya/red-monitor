# Red Viral Monitor

[English](README.en.md)

Red Viral Monitor 是一个专门面向小红书 Web 端的 Manifest V3 浏览器扩展。它不再加载或匹配 X/Twitter 页面，只在 `xiaohongshu.com` 域名上运行。

## 功能

| 功能 | 位置 | 说明 |
|---|---|---|
| 热度徽章 | 笔记卡片 / 笔记详情 | 根据点赞、收藏、评论、分享计算互动热度和每小时速度 |
| 页面热度榜 | 可拖拽浮动面板 | 当前页面捕获到的笔记按互动速度排序 |
| Markdown 复制 | 笔记浮层按钮 | 复制标题、正文、图片、互动数据和来源链接 |
| DOM 兜底 | 小红书页面结构变化时 | API 数据不足时从可见笔记卡片中提取标题、作者和指标 |

## 安装开发版

```bash
npm install
npm run build:dist
```

然后打开 Chrome / Edge 的 `chrome://extensions/`，启用开发者模式，加载本仓库的 `dist/` 目录。

## 工作原理

扩展在小红书页面内只读观察 `fetch` / `XMLHttpRequest` 响应，识别 `/api/sns/web/` 返回的笔记数据，并将其合并到本地页面内存中。它不会向外部服务上传笔记内容，也不会修改小红书请求。

当 API 响应里没有完整指标时，`content.js` 会扫描页面上的笔记 DOM，尽量从可见文本、链接和图片里补齐数据。

## 项目结构

```
├── _locales/                  # 国际化（zh_CN / en / ja）
├── icons/                     # 扩展图标
├── lib/xhs-net-hook.js        # 小红书 fetch/XHR 只读观察器
├── bridge.js                  # 扩展隔离世界与页面 MAIN world 通信
├── content.js                 # 小红书笔记热度、榜单、复制逻辑
├── popup.html / popup.js      # 设置弹窗
├── styles.css                 # 注入页面的样式
├── scripts/build-dist.mjs     # 生成可加载扩展目录
└── manifest.json              # Chrome 扩展清单
```

## 开发

```bash
npm test
npm run build:dist
```

## 许可证

MIT. See [LICENSE](LICENSE).
