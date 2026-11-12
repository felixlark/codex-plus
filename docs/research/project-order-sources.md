# Project 自动排序：来源与现状记录

采集日期：2026-11-10；本机工程 checkout `/Users/longbiao/Projects/codex-plus`，候选基线 `3d49969f0f7daeb362b2a1ead5043b79e0bf6270`；执行电脑 `sol`。

## 公开源码

通过 GitHub 官方连接器 `mcp__github__get_file_contents` 读取以下固定候选。复核时使用固定 commit URL；本机缓存属于可丢弃资源。

| 来源 | 具体代码 | 相关事实 |
| --- | --- | --- |
| qqheling/codexplusplus `a114ae5ca7a6ca4e798482fc943848df0ccffabb` | [cdp.rs](https://github.com/qqheling/codexplusplus/blob/a114ae5ca7a6ca4e798482fc943848df0ccffabb/crates/codex-plus-core/src/cdp.rs)、[launcher.rs](https://github.com/qqheling/codexplusplus/blob/a114ae5ca7a6ca4e798482fc943848df0ccffabb/crates/codex-plus-core/src/launcher.rs)、[renderer-inject.js](https://github.com/qqheling/codexplusplus/blob/a114ae5ca7a6ca4e798482fc943848df0ccffabb/assets/inject/renderer-inject.js) | loopback CDP target 发现、调试启动参数、renderer 注入、资源链接发现及动态 import |
| b-nnett/codex-plusplus `13d0c2421cc4258565710910ca8dfe60344c027e` | [SidebarAdapter.swift](https://github.com/b-nnett/codex-plusplus/blob/13d0c2421cc4258565710910ca8dfe60344c027e/Sources/CodexPPCore/SidebarAdapter.swift)、[sidebar-adapter.js](https://github.com/b-nnett/codex-plusplus/blob/13d0c2421cc4258565710910ca8dfe60344c027e/Sources/CodexPPCore/Resources/sidebar-adapter.js)、[shell-adapter.js](https://github.com/b-nnett/codex-plusplus/blob/13d0c2421cc4258565710910ca8dfe60344c027e/Sources/CodexPPCore/Resources/shell-adapter.js)、[renderer-runtime.js](https://github.com/b-nnett/codex-plusplus/blob/13d0c2421cc4258565710910ca8dfe60344c027e/Sources/CodexPPCore/Resources/renderer-runtime.js)、[better-sidebar](https://github.com/b-nnett/codex-plusplus/tree/13d0c2421cc4258565710910ca8dfe60344c027e/extensions/better-sidebar) | AST 结构发现、独立佐证、版本化能力接口、初始化/清理；当前 README 描述签名 bundle patch 和内进程执行 |
| qoli/codex-disable-escape-tweak `241f066ab315c98ff1df15a884f50d72328c8630` | [index.js](https://github.com/qoli/codex-disable-escape-tweak/blob/241f066ab315c98ff1df15a884f50d72328c8630/index.js) | 单一 tweak 的监听注册和释放 |

## 当前宿主的静态观察

用 PlistBuddy 读取公开 bundle 元信息，宿主为 `/Applications/ChatGPT.app`、`com.openai.codex`、26.1103.60933，内部 `Codex Framework.framework` 版本 157.0.8103.39。以 Python 读取 `app.asar` 的 header 和 JS 资源作为数据，搜索并追踪 Project 顺序/时间的结构。

| 资源和模块 | 观察 |
| --- | --- |
| `webview/assets/async/499225.6d2e47bea2.js` | Rspack ESM chunk；React sidebar 消费 projectOrder、项目分组和 layout |
| `webview/assets/async/182735.7f13786b92.js`，`DZgh` | 读取持久化 PROJECT_ORDER，产生项目组，按有效任务时间排列组内任务，生成 layout 和导航键 |
| 同资源 `r6TF` | 原生有效时间部分分支使用 recencyAt、updatedAt 和 createdAt 回退；云来源转换秒时间 |
| 同资源 `aDVs`、`SIT2` 与 global-state 读取模块 | 项目顺序 setter、query cache 乐观更新/失败恢复、projectPresentation.readOrder |

这些是静态观察。当前宿主的 CDP 参数接收、app:// Script 拦截、React 活动投影、后台覆盖及恢复均等待方案阶段 A 的运行实证。

## 公开控制面与安装版检查

`mcp__codex_app__list_threads(limit=3)` 回读 sidebarPreferences 中 chats/projects 为 updated_at；`update_sidebar_preferences` 工具 schema 指出 projects 是 chats 的别名。官方 Computer Use 检查“Project sidebar options → Sort chats by”，Last updated 已选中。单次项目排序工具为 `mcp__codex_app__reorder_sidebar_projects`。

本轮没有变更宿主安装包、签名、启动参数、排序设置或正在运行的任务。产品功能和安装版本保持原状态；本轮仓库交付为 AGENTS、设计与评审文档。
