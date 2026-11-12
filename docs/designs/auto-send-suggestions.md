# 建议提示词自动发送

2026-11-12，Sol，chat 01a1ce59-86c7-7be3-b6f5-2594bff9b46f。用户要求同案依次完成：方案评审 → 开发和真实验收 → 做好后发推。开发 push 沿既定授权，X 按 @felixlark 身份及已授权范围办理。默认关闭，用户可从统一设置随时开关。

## 事实、取舍与集成

规范仓 /Users/longbiao/Projects/codex-plus，已取得 0.4.1 writer 释放，从 f456ef4 接续。正式 /Applications/Codex Plus.app 的 CodexLauncher 单独管理 controller.mjs，本机已连接官方 Codex 26.1106.51428。官方应用包和签名保持。已有控制器通过本地 CDP（浏览器调试协议）读取和适配经摘要审核的 renderer 脚本，正常退出 Plus 保留 Codex。

官方资源 webview/assets/async/864380.74f4445879.js，sha256 63ad0177e7b2d888cbf80db7ed6167c73f0012a652fc6ecd10f34052a1e87ff0，TBBz/dlg1 模块已读取。原生预测在完成且非 automation 的 turn 后产生，prediction.sourceTurnId 与 scope 的 latestTurnId 可匹配。widget 位于空白且非组合输入、非 mention 菜单的编辑器，data-cumberbatch 标记。原生 Tab 插入预测的 ProseMirror doc 并登记 accepted；随后通过原生 Send 按钮调用原提交路径。

选择控制器串行执行采纳与提交两个动作，页面仅提供读取/校验函数，不自行定时发送。相比全局模拟按键，局部 KeyboardEvent 定位同一个原生编辑器；相比重写提交 API，继续使用官方 handler、校验和权限流程。提交选择原生 Send 按钮，避免依赖用户可改的 Enter 快捷键；按钮必须由已审核结构精确定位到相同 composer，存在歧义则跳过。控制器崩溃或断线后没有页面自主执行器，Tab 后中断保留草稿。

## 精确改动和通道

- Sources/CodexPlus/Resources/suggestion-auto-send.mjs：独立原生资源定义、摘要/结构校验适配函数、浏览器 snapshot/action 函数和纯协调状态类。资源适配只在原 widget 中增加 data-codex-plus-suggestion，含 hostId/threadId/sourceTurnId、预期 doc.textContent；排除有 kind 的预填，核 sourceTurnId===scope.ww.latestTurnId。同文 prediction 更新时，必须让 sourceTurnId 或 kind 改变也重建 widget，避免官方同文复用分支保留旧元数据；仅这两个身份条件补入既有优化分支。脚本前缀设置 __codexPlusSuggestionHost 协议标记。所有提示词内容仅在页面及控制器操作内存短暂经过，状态与日志均省略正文。
- controller.mjs：把该已审核资源加入现有 Fetch 响应适配列表，以已审核的路由/排序适配可用为先决条件；新/已连接窗口接入读取函数。在现有 monitor 中串行驱动单一协调状态，跨 session 的相同 hostId/threadId/sourceTurnId 认领共享；只允许一个在途动作。新增自有 suggestion-attempts.json（与 state.json 同目录），只保存已尝试标识。原子落盘成功后才执行 Tab，恢复载入该文件；读写失败时停用本项。退出时无需向页面撤销自主发送器。状态增加 suggestionAutoSend={enabled,supported,phase,attempted,accepted,submitted,unknown,reason}，不含正文/任务身份。
- CodexLauncher.swift：UserDefaults 键 autoSendSuggestions，默认 false；startController 参数 --auto-send-suggestions（仅 true 时附加）；设置变化经现有 stdin 下发 {type:'suggestion-settings',version:1,enabled:Boolean}。恢复创建 controller 时总是从该键读取当前值；@Published suggestionSummary 与现有 status() 读回新状态。
- CodexPlusApp.swift：SettingsModel 新增 @Published autoSendSuggestions，持久化并触发 onSuggestionChange；连接到 launcher.setAutoSendSuggestions。设置「自动发送建议提示词」和说明「当前聊天出现新的建议后自动采纳并发送，可能连续开启后续轮次。关闭可随时停止。」展示运行状态。更新版本、AppInfo.plist、README.md、docs/acceptance.md、设计/评审记录。
- scripts/build 已自动复制 Resources/*.mjs；无需新打包机制。scripts/test 自动运行 Tests/*.test.mjs。新增 Tests/suggestion-auto-send.test.mjs（真实 host 结构/摘要、协同状态、读写失败、跨窗口/恢复/取消），临时 Electron 场景沿现有已安装工具运行真实页面动作路径。

## 状态与关键不变量

开关关闭时没有动作。每次开启和每次新控制器连接，先对已显示建议建立基线，旧建议不追发。页面此前没有建议时记已建立基线，后续新 suggestion 可执行；来源相同的建议即使换文本也最多认领一次。

monitor 单次遍历所有主页面只读快照。仅 /local/<threadId> 或 /remote/<threadId> 的已审核、可见、document.hasFocus 的唯一主聊天编辑器，metadata 的 threadId 与路由一致，原生建议 widget 存在、空白、无组合输入、无附件/批准对话框、输入焦点在该编辑器或 body 时允许采纳。相同聊天多窗口由单一 controller 队列和持久化已尝试键去重；后台快照仍用于基线。主页面/侧聊天依原生容器结构与路由匹配筛选，歧义跳过。

采纳前先持久化已尝试键，再检查当前 enabled/settingsRevision/connection/route/source/widget/焦点/空白和无人工干预，向同一个编辑器发 Tab。采纳后等待原生 widget 消失、编辑器文档文本精确等于预期、原生发送可用，提交前再次核以上状态及无任何用户输入/对话框，点击同一原生 composer 的 Send 按钮。页面记录 trusted 键盘、指针、输入、composition、focus、route 变化的 revision；两动作之间人工事件或任何条件改变即取消，保留采纳草稿。事件记录器只记计数，不读键值/文本。

控制器变更开关立即增加 settingsRevision；任何 await 之后和下一个动作前重核。关闭后不自动恢复 pending；下次开启建立新基线。切换聊天/窗口后取消 pending，即使回到原聊天也不自动发送已采纳草稿。提交后仅观察原生开始工作或编辑器清空，确认则 submitted；结果未知标 unknown，永不自动重试。同一控制器异常退出后由现有 Swift 生命周期恢复，持久化标识和新基线共同防重放。

状态不声称 UI 发送等于后端任务成功；真实验收读取原生会话中新用户消息和下一轮 started/completed。未知版本显示待适配；已加载旧资源显示需重载，该项失配时停用建议自动发送，既有入口照常工作。

## 顺序、验收与恢复

先完成独立方案评审及有效 Major 修订复审，再等共享 writer 释放、核 git status、新基线和真实安装版。实施后跑 scripts/test、单 release 签名构建；从菜单正常退出 Plus，安装脚本备份旧安装并重连现有 Codex。

资源增补需要 renderer 执行时接入。对本任务页面在核对原生草稿已保存且无待批准对话框后保留路由重载；不结束任何后台任务。首先在独立真实官方宿主验收，再核正式安装版设置与实际启用状态。原始输入/聊天仍归 Codex；自有状态仅含开关和去重标识。回退正常退出 Plus、恢复安装脚本保留的旧包，保留官方宿主和所有证据。

必要验收：默认关闭、设置保存重启；真实原生 turn 产生新建议后自动 Tab+原生 Send 一次，下一轮可继续；无建议不动作；关闭后建议保持；人工草稿/输入法/附件/对话框不误发；切换/多窗口/Tab 后关闭或控制器崩溃取消；重连/重载不重放。确定性回归覆盖竞态；真实原生建议未出现时调查官方生成条件并继续，fixture 单独标识，禁止宣称真实通过。

完成开发、安装及真实验收后提交 push 到既定分支，跟踪 CI，用户最终接受的 Issue 保持开放。最后拟定推文并通过 X 技能做事实、身份和使用路径检查；若该技能要求最终正文确认则只在功能完成、具体成稿可审阅时请求该最后步骤。第三步在实际发布并读回前保持待完成。
