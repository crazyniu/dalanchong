# Claude 开发入口

先完整阅读 [AGENTS.md](AGENTS.md)，它是本仓库统一的开发、权限、数据与验证约定。本文件不定义另一套规则。

主要入口：

- [README](README.md)：当前功能、安装、数据流与开发命令。
- `src/invitation-ui/entry.tsx`：网页内 React 工作区入口。
- `browser-extension/background.js`：worker 入口。
- `browser-extension/invite-background.js`：邀约消息与作用域边界。
- `browser-extension/license-background.js`：授权状态与撤销事件。
- [验证与验收](docs/TESTING.md)：自动测试与真实环境边界。

在功能分支提交 PR；不自动合并、部署、激活真实账号或发送真实邀约。发现文档和实现不一致时，先报告并在授权范围内修正，不能默默扩大范围。
