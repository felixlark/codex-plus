# 独立人工增强 v4：源码与采用合同

文中的 `LOCAL_*` 与 `PRIVATE_EVIDENCE_PATH` 表示受控记录中的本机兼容值或证据位置，不是新的运行默认值；历史验收结论仍对应原记录版本。

## 已批准范围与结果

本人批准 [v4](https://github.com/felixlark/smart-shadow/issues/483#issuecomment-6909898465)，经理在 [原任务](https://github.com/felixlark/smart-shadow/issues/578#issuecomment-6910253612)明确独立源码先交付、SmartShadow安全点另接。这里记录已实现接缝及生产依赖，不新增产品架构。

| 产品 | 负责内容 | 本批状态 |
|---|---|---|
| Codex Plus | 人工窗口、F6、侧栏/编号、职级后状态排序、工作区、风险审查建议、准确工具窗路由 | 独立源码和候选，不运行 |
| SmartShadow interactiond | 官方后台宿主、准确目标用途、手机原前端/网关/TLS与专用目标 | 对接生产合同待实现 |
| SmartShadow runtime | 管理界面、小看板、三模块生命周期 | 本批不改 |

不会创建第二个官方后台、profile或账号；原Codex及其Run不由Plus退出关闭。手机代码已移出本仓产品树，现役SmartShadow源码与85项既有非GUI测试不改。

## 路径与写入责任

| 项目 | Plus 独占位置 |
|---|---|
| 安装 / 签名 | `/Applications/Codex Plus.app` / `LOCAL_PLUS_BUNDLE_ID` / team LOCAL_PUBLISHER_TEAM_ID |
| 运行锁 | `~/Library/Application Support/codex-plus/enhancements/runtime.lock` |
| controller状态/建议尝试 | 同根 `launcher/state.json`、`launcher/suggestion-attempts.json` |
| 状态 / 控制socket | 同根 `status.sock`、`tool-control.sock` |
| 偏好domain | `LOCAL_ENHANCEMENT_PREFERENCES_DOMAIN` |
| 构建/依赖缓存 | `~/Library/Caches/codex-plus/standalone/` |
| 日志 | `~/Library/Logs/codex-plus/` |

旧 `codex-plus/launcher/suggestion-attempts.json` 只读，与独立日志取并集防重发。必须在生产方确认旧人工增强writer已停后导入；缺失/损坏时自动续轮保持不可用，人工聊天不受此日志影响。旧偏好只读复制已知五项且不覆盖新值，不修改SmartShadow偏好、TLS、配对、草稿或unknown。

## 受信目标用途：生产合同

Plus是SmartShadow的**只读状态客户端**，不是其管理服务器。连接未来独立 `~/Library/Application Support/SmartShadow/interactiond/management.sock`，请求 `management-v1` 的 `status`。验证目录/socket权限、同UID、内核返回peer PID、peer实际安装路径/bundle/Developer ID签名，再校验响应request_id与同PID。缺少生产接口只会等待。

响应 `result.codexTargetOwnership` 的结构如下；这里是合同示例，不是当前健康证明：

```json
{
  "schema": "codex-target-ownership/v1",
  "enhancementsOwner": "codex-plus",
  "host": {
    "pid": 123,
    "start_seconds": 1000,
    "start_microseconds": 100,
    "appPath": "/Applications/ChatGPT.app",
    "endpoint": "ws://127.0.0.1:12345/devtools/browser/original"
  },
  "targets": [{
    "targetId": "exact-cdp-target",
    "purpose": "human",
    "windowID": 123,
    "browserWindowId": 1,
    "webContentsId": 1,
    "instance": "producer-claim-instance",
    "frameId": "exact-main-frame"
  }]
}
```

生产方负责维护准确原生BrowserWindow/webContents/CG/CDP映射，给专用目标标 `mobile`，未知/不完整目标不给人工权。`enhancementsOwner=codex-plus` 只可在旧SmartShadow人工增强writer真实停止并保全旧尝试日志后授予，不能仅因配置改名授予。目标用途应在其原生生命周期内固定，不能把已注入人工页面原地变成手机宿主；需要变更时先撤权与清理，再由生产方完成已批准的原操作对账。不能靠本合同为绕过unknown建替代窗口。

Plus再次核官方bundle/路径/PID出生、厂商签名及IPv4 loopback监听，读取CDP目录后只显式attach正面人工claim；不对全页自动attach，不按标题/URL/坐标猜用途。手机/未知用途拒绝；重复、不完整和损坏scope整体不授予。原生AX和人工窗布局同样只接受准确授权PID及CG ID。

## Swift ↔ Node 与撤权

使用现有子进程stdin/stdout JSON行管道。Node请求 `target-ownership-request` / version1 / UUID requestId，Swift返回同requestId的 `target-ownership-result`、ok和scope；失败不返回可用scope。只接受当前controller的准确请求，超时/断线/关闭后迟到响应丢弃，不自动恢复旧授权。Node与原生只读连接都用整体10秒期限，沿既有CDP请求预算；原生socket以nonblocking/poll贯穿connect/write/read，超时/取消后不应用结果。暂停、恢复和停止会使Launcher生命周期epoch变化，observer也拒绝停止前回调。该期限避免等待失联生产方，不是资源/并发限制。

scope按host出生和准确claim规范化。每次attach、修改/执行页面或原生人工布局前刷新；变化后递增epoch，取消待审/待确认，停自动续轮，释放自有session。异步完成后再次核epoch；旧结果不形成新权、不重发。页面执行绑定捕获的默认context及frame，等待授权期间换文档则拒绝；不注册持续到未来文档的脚本，不恢复用户调试器。导航后须重新确认当前文档。

撤权/退出只清理自己捕获world中的hook、binding与Fetch并detach；不关闭vendor target/后台，不改手机、不把全局AXEnhancedUserInterface恢复为false。已经加载的资源改写不承诺可凭detach逆转，因此生产方不能原地复用曾增强的人工作为手机目标。原建议风险审查、attempt去重和未知发送保留，不将超时解释为未发送。

## 文件交付清单

| 动作 | 路径 / 用途 |
|---|---|
| 新增 | HostOwnershipClient.swift、Core/HumanTargetScope.swift、EnhancementPaths.swift、CodexPlusInstallation.swift、PlusPreferences.swift；原生设置SettingsModel/View；Resources/target-ownership.mjs与attempt-ledger.mjs；对应隔离/日志/Core测试 |
| 修改 | CodexPlusApp/Launcher、HumanWindows、WorkspaceObserver、ToolWindowRouter、Management/Status/Lifecycle；controller/page-session/launch-host；任务排序适配器与测试；单产品Package/AppInfo；build/install/manifest/CLI/test |
| 移动 | 图标生成器从scripts移入resources/brand，成品沿原Plus视觉身份 |
| 删除 | SmartShadowManager产品树、mobile产品树、mobile-*资源、RuntimeBootstrap、手机/管理专用Core模型与测试、手机/manager构建和安装脚本、旧融合入口测试 |
| 保留 | 人工增强风险审查及现有行为测试、历史文稿、foreign compact-task-board.md / __pycache__、SmartShadow全部源码与原测试 |

删除测试仅对应移出的产品功能，不构成本批通过证据。排序复用SmartShadow固定7902fdd8中的protocol10，先职级后状态、预览截断前排序；原PR765的有效真实样本证据复用，本批不重复创建/改名业务任务。

## 采用与验收

1. 原#578交付固定源码、定向检查、独立审查与签名不可变候选；不运行。
2. SmartShadow安全点由经理安排原#578迁接手机/宿主与用途生产合同。#613核原生身份/TLS原件、unknown和旧人工增强writer交接。
3. #613唯一安装/切换，读回两产品配置/文件/socket隔离及同一个官方后台；Plus只能人工目标，手机只能原专用目标。
4. 真实安装版用官方OCU后台准确窗口验人工变化；手机复用有效证据，只验本次变化。实际一像素或不可见宿主及手机读取/唯一发送/流式恢复另证，最小化不作验收。

源码/测试/签名均不能替代上面生产合同和真实采用。当前手机原target absent/terminal及unknown按[固定故障表](https://github.com/felixlark/smart-shadow/issues/578#issuecomment-6910209609)继续，不能借本批结算或重放。
