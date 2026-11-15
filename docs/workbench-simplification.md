# 完整工作台源码精简

本批仅执行用户已批准的全仓精简中codex-plus切片，不实现小看板，不合并、不安装、不启动任务。基线72f7dd2；同分支未跟踪的compact-task-board方案草稿保持原样，不随本批提交。

| 处置 | 路径/能力 | 理由与剩余依赖 |
| --- | --- | --- |
| 删除 | Resources/workbench.mjs、workbench-view.mjs | 完整原Codex工作台建窗、DOM侧栏、任务跳转及专用生命周期已被否定 |
| 删除 | CodexLauncher、controller、HumanWindows、ToolWindowRouter内专用建窗/nonce/target/CG恢复接线 | 无新工作台消费者；手机mobile-window接缝原样保留 |
| 删除 | ManagementWorkspaceRequest及专用测试；ManagerModel开窗/恢复流程 | 管理App只显示小看板未实现，不再操作旧工作台 |
| 删除 | 完整工作台设计、workbench专用测试 | 旧实现可从Git/PR25追溯，不维持活动实现合同 |
| 保留并抽取 | task-workspace.mjs、独立task-workspace.test.mjs | 固定GET/Origin/本人身份、分页、HTTP/响应范围校验；无运行消费者，不自启、不建第二账本 |
| 保留 | 手机本地原前端、mobile-access/endpoint/local-state、原宿主/网关、草稿与附件 | 已验证手机路径；文件内容与本批前一致 |
| 保留 | 原Plus增强、F6人工窗、右屏工具路由、设置与管理/服务状态 | 本轮不在无关功能上扩删；用户设置入口仍指向已签名的管理App |
| 保留wire拒绝 | ManagementProtocol的workspace.open/query解析 | 对旧请求明确unsupported/null，不宣告能力，不执行、不伪造成功；旧unknown不据此结算 |
| 切断打包残留 | scripts/build移除缓存包内两份旧工作台模块后复制当前资源 | 避免复用构建目录将已删模块带入新包；本批不运行签名构建/安装 |

## 运行保全与未来切换前置

本批只改源码。现役Plus74（冻结e3c9d8e）、iOS53、官方Codex及手机连接继续运行；75缓存候选不安装。原工作台CG9785及其request/nonce/target记录、历史未知发送与未发O草稿保留原owner，不能由删除代码推断关闭或迁接完成。冻结信息归本机既有mobile-complete-20261115证据；不复制凭据或私密会话入Git。

未来若获准安装精简版，先在旧运行体按原身份对账并关闭/迁出旧完整工作台，确认无在途窗口动作，保护人工窗口和手机草稿，再切换。旧界面标记排除代码已删除，因此未完成这一步时禁止把精简源码当作可直接覆盖现役的安装包。此处仅记录依赖，不新增自动迁移或恢复机制。

小看板、任务跨源归并、全任务状态采集和独立daemon/薄生命周期均仍未交付。源码编译与定向测试只证明精简后剩余组件的覆盖范围，不等于新产品运行验收。

## 本批定向核验

- Node语法检查通过；只读适配、手机宿主、人工窗路由共20项已有/迁移检查通过。
- Swift管理协议和人工窗13项定向检查通过；同次Debug编译成功生成CodexPlus及SmartShadowManager产品，未启动它们。
- 手机源码与原生18条受控路径相对72f7dd2全部一致；6份移除工作台接线的文件与已验证手机基线89867f4逐字节一致。
- Sources/Tests中完整工作台实现标记、专用请求恢复和注入消费者搜索为0；保留的任务只读适配没有controller/UI消费者。
- Info.plist源码build76仅用于区分删除后的后续候选；本批未签名构建或安装，不能声称build76运行通过。未跟踪方案草稿保持原样。
