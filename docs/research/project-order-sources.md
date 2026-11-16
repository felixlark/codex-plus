# Project 自动排序：公开来源与证据范围

本页是迁移保留仓库的公开来源索引。原先附在仓库中的本机缓存、研究脚本、补丁与运行记录已从当前公开文件中移出，完整原件保存在受控档案中。已有固定源码移交保持原输入；本次清理不要求下游改取新的 HEAD。实际安装、验收和旧产品退役仍按[迁移记录](../retirement.md)办理。

## 公开源码

通过 GitHub 官方连接器 `mcp__github__get_file_contents` 读取以下固定候选。复核时使用固定 commit URL；本机缓存属于可丢弃资源。

| 来源 | 具体代码 | 相关事实 |
| --- | --- | --- |
| qqheling/codexplusplus `a114ae5ca7a6ca4e798482fc943848df0ccffabb` | [cdp.rs](https://github.com/qqheling/codexplusplus/blob/a114ae5ca7a6ca4e798482fc943848df0ccffabb/crates/codex-plus-core/src/cdp.rs)、[launcher.rs](https://github.com/qqheling/codexplusplus/blob/a114ae5ca7a6ca4e798482fc943848df0ccffabb/crates/codex-plus-core/src/launcher.rs)、[renderer-inject.js](https://github.com/qqheling/codexplusplus/blob/a114ae5ca7a6ca4e798482fc943848df0ccffabb/assets/inject/renderer-inject.js) | loopback CDP target 发现、调试启动参数、renderer 注入、资源链接发现及动态 import |
| b-nnett/codex-plusplus `13d0c2421cc4258565710910ca8dfe60344c027e` | [SidebarAdapter.swift](https://github.com/b-nnett/codex-plusplus/blob/13d0c2421cc4258565710910ca8dfe60344c027e/Sources/CodexPPCore/SidebarAdapter.swift)、[sidebar-adapter.js](https://github.com/b-nnett/codex-plusplus/blob/13d0c2421cc4258565710910ca8dfe60344c027e/Sources/CodexPPCore/Resources/sidebar-adapter.js)、[shell-adapter.js](https://github.com/b-nnett/codex-plusplus/blob/13d0c2421cc4258565710910ca8dfe60344c027e/Sources/CodexPPCore/Resources/shell-adapter.js)、[renderer-runtime.js](https://github.com/b-nnett/codex-plusplus/blob/13d0c2421cc4258565710910ca8dfe60344c027e/Sources/CodexPPCore/Resources/renderer-runtime.js)、[better-sidebar](https://github.com/b-nnett/codex-plusplus/tree/13d0c2421cc4258565710910ca8dfe60344c027e/extensions/better-sidebar) | AST 结构发现、独立佐证、版本化能力接口、初始化/清理；当前 README 描述签名 bundle patch 和内进程执行 |
| qoli/codex-disable-escape-tweak `241f066ab315c98ff1df15a884f50d72328c8630` | [index.js](https://github.com/qoli/codex-disable-escape-tweak/blob/241f066ab315c98ff1df15a884f50d72328c8630/index.js) | 单一 tweak 的监听注册和释放 |

## 本机证据范围

本机静态观察与交互记录只说明当时所核版本的行为。原始实现摘录、复现脚本、证书及本机路径不在本公开索引中；不能以公开来源链接代替本机运行验收，也不能以历史验收代替当前迁移结果。第三方作者、许可证及固定版本链接保持原归属。
