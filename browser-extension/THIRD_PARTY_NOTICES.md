# 第三方来源

## 原片探测参考

jiji262/douyin-downloader，核对 revision ed863617aa52353821aca8fdebcfad4e916ebff5。
https://github.com/jiji262/douyin-downloader

原片请求参数与浏览器详情解析由本插件实现。上游 MIT 许可见 licenses/douyin-downloader-MIT.txt。

## 网页组件与资源

`vendor/ui/components.js` 的组件及其依赖保留各自许可，完整捆绑声明见 `vendor/ui/components.js.LEGAL.txt`。发布资源保留第三方许可文件、LEGAL 资源及代码中的许可注释。


## 完整许可证文本

- Lucide Static 0.468.0 SVG 图标：[ISC 与包含的 Feather MIT 声明](licenses/lucide-static-0.468.0-LICENSE.txt)。
- Web Awesome Core 组件：[MIT](licenses/awesome.me-webawesome-3.14.0-LICENSE.txt)，版权行另保留在捆绑声明和源码。
- Lit HTML、Lit Element、Reactive Element：[BSD-3-Clause](licenses/lit-reactive-element-2.1.2-LICENSE.txt)，其各包许可证文件一并保留。
- 组件运行依赖 Floating UI（dom/core/utils）、Shoelace Localize、composed-offset-position、nanoid：完整许可见 `licenses/` 中对应的 `*-LICENSE.txt`。

Web Awesome 源包的组件 chunk 标识与现有捆绑声明核对；依赖按这些 chunk 的导入追溯。捆绑代码原有版权注释和 `.LEGAL.txt` 不移除。

项目来源代码携带的 MIT 声明保留于 [project-source-MIT.txt](licenses/project-source-MIT.txt)。

## 达人工作区界面

`invitation-ui.js` 使用 React、Radix UI 等组件，并内嵌 Tailwind CSS 样式。构建保留代码许可注释，并按实际捆绑依赖生成完整许可汇总 [invitation-ui-LICENSES.txt](licenses/invitation-ui-LICENSES.txt)；构建工具本身不作为运行组件分发。平台标识仅用于标明对应来源，商标权归各自权利人。

`react-remove-scroll-bar@2.3.8` 的发布包遗漏完整 LICENSE，仅标记 MIT；构建汇总包含官方上游仓库当前 LICENSE 正文，离线副本见源码 `src/legal/react-remove-scroll-bar-LICENSE.txt`。
