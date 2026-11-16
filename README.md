# 大懒虫浏览器插件

面向 Chromium 浏览器的网页视频捕获、预览、解析与下载工具。

当前版本：`0.3.9` · 最低 Chromium：`116` · Manifest V3

## 功能

- 识别网页真实请求或播放的完整视频，显示捕获列表与画质。
- 网页内预览、复制地址、全部下载与下载所选。
- 抖音分享链接批量解析，以及抖音、快手详情页视频下载。
- 支持电商页面的视频列表、商品/达人关联视频、筛选与批量下载。
- 浏览器原生下载队列、进度与已下载状态。

## 安装与使用

1. 获取本仓库源码，或下载 ZIP 并解压。
2. 打开浏览器扩展管理页，开启开发者模式，选择「加载已解压的扩展程序」。源码选择 `browser-extension/`，ZIP 选择其解压目录。
3. 在网页播放视频，点击浏览器工具栏的大懒虫图标查看列表、预览或下载。
4. 点击「更多」进入视频管理页，批量解析抖音链接或下载已捕获视频。

源码可直接加载；更新源码后重新加载插件并刷新需要使用的网页。各浏览器的 CRX 安装政策不同，签名与发行流程见 [构建与发布](docs/EXTENSION_RELEASE.md)。

## 数据与权限

媒体和下载运行状态保存在当前浏览器的扩展会话存储，电商页面缓存使用本地存储。平台操作使用浏览器现有登录会话，视频格式在本机排序，下载文件由 Chrome 管理。

- `scripting`：读取平台视频详情并展示网页预览。
- `webRequest`：识别网页真实请求的视频资源。
- `downloads`：提交及跟踪视频下载。
- `storage`：保存本机媒体记录与页面缓存。
- `tabs`：定位来源页面和视频管理页。
- `contextMenus`：提供视频管理快捷入口。

只处理实际请求或播放的 HTTP(S) 完整视频；音频、播放清单、分段及 blob 地址不作为完整视频文件。清空捕获列表不会删除已下载文件。仅处理你有权下载的内容。

## 开发与打包

打包环境：Node.js 24+、pnpm 11.15.1。Mac 可双击 `一键安装.command` 准备本项目打包依赖，或运行：

```sh
pnpm setup:extension
pnpm package:extension --zip-only
```

输出位于 `dist-release/browser-extension/`。压缩只处理发布副本，可读源码和第三方许可保留。开发检查按用户指定范围执行，浏览器验收由用户负责。

```text
browser-extension/
  background/       视频后台与下载队列
  content/          网页视频识别与页面增强
  pages/            弹窗、视频管理与预览
  shared/           媒体数据、解析与界面工具
  vendor/           第三方组件与图标
scripts/            安装与打包
tests/              按需运行的离线测试
.github/workflows/  ZIP 检查与签名发行
docs/               功能与发行说明
```

## 文档

- [视频工具](docs/extension/README.md)
- [电商页面](docs/extension/COMMERCE.md)
- [资源来源](docs/extension/PLATFORM_SOURCES.md)
- [验证与验收](docs/TESTING.md)
- [构建与发布](docs/EXTENSION_RELEASE.md)
- [开发约定](AGENTS.md)
- [第三方声明](browser-extension/THIRD_PARTY_NOTICES.md)

## 许可证

来源代码许可保留于 [LICENSE](LICENSE)。随包组件与图标的完整许可位于 `browser-extension/licenses/`，捆绑声明与版权注释一并保留。请勿提交 Cookie、签名私钥、真实浏览器配置或用户下载文件。
