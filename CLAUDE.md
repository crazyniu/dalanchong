# 开发入口

先阅读 [AGENTS.md](AGENTS.md) 与 [README.md](README.md)。

- `browser-extension/manifest.json`：插件权限、页面与注入范围。
- `browser-extension/background/background.js`：视频解析与后台消息。
- `browser-extension/background/library.js`：媒体记录与下载队列。
- `browser-extension/content/`：网页视频识别、详情按钮与电商页面增强。
- `browser-extension/pages/`：弹窗、管理页与播放器。
- [构建与发布](docs/EXTENSION_RELEASE.md)：签名和发行流程。

只在用户指定范围内修改，不运行浏览器验收，不自动发布。
