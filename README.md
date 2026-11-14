# Codex Plus

0.9.1 在每个窗口左下角的 Codex Plus 圆形按钮中央显示窗口编号（1、2……），点击仍打开设置。编号跟随窗口，切换聊天、移屏、页面重载或重启 Plus 时保持；关闭窗口后编号可以供新窗口使用。无需新增侧栏按钮或重载已有页面。设计见[窗口编号](docs/designs/window-number.md)。

0.10.0 将 Agent 专用工具窗口隔离到不可见虚拟屏。中间与右侧两个人工 Codex 窗口、X 和 X Chat 始终保留原位置与输入焦点。右屏归集、专用应用整进程规则、旧显示器偏好和物理屏恢复入口均已移除。只认领明确文件或准确 PID/窗口 ID；人工设置与 Agent 设置使用不同窗口。

```sh
"/Applications/Codex Plus.app/Contents/MacOS/CodexPlus" --tool-status
"/Applications/Codex Plus.app/Contents/MacOS/CodexPlus" --tool-open --app-path /System/Applications/TextEdit.app --url file:///absolute/path/preview.txt
"/Applications/Codex Plus.app/Contents/MacOS/CodexPlus" --tool-open --app-path "/Applications/Codex Plus.app"
```

浏览器等已有正式窗口提供方返回准确窗口身份后，可明确隔离或恢复该 Agent 窗口：

```sh
"/Applications/Codex Plus.app/Contents/MacOS/CodexPlus" --tool-place --pid PID --window-id ID
"/Applications/Codex Plus.app/Contents/MacOS/CodexPlus" --tool-restore --pid PID --window-id ID
```

命令要求 Plus 已运行，连接失败不启动或重放工具；`requested` 只表示接收请求，须从状态确认 `parked`。虚拟屏不可用时不回退物理屏；`--tool-open` 对外部 App 要求实际本地文件，非文件窗口使用准确窗口 ID。暂停取消尚未认领的请求，已隔离窗口继续保留；正常退出会无激活地恢复仍受管的窗口。恢复失败时保留虚拟屏并报告状态。设计见[Agent 窗口隔离](docs/designs/quiet-tool-windows.md)。

0.8.0 为每个 Codex 窗口独立保存侧栏展开与折叠状态，覆盖自定义分区、Projects 等内置分区和项目内聊天列表。一个窗口收起 Smart Shadow，不会影响另一个窗口；原生项目与聊天内容仍然共享。

布局按屏幕自动记忆：把窗口移到另一块屏幕或新开窗口时，采用该屏幕最近保存的布局；同屏已有窗口保持各自状态。窗口在同一屏幕重载时恢复自身布局。首次使用的新屏幕延续当前窗口布局，显示器断开后保留记忆；屏幕不可识别时继续窗口独立状态、暂停屏幕保存。布局只存在本机，设置页可查看接入状态。升级后在 Plus 设置中关闭自动发送、点击“重新接入页面增强”，接入完成后按原偏好恢复自动发送。设计与审查见 [窗口布局方案](docs/designs/window-sidebar-layout.md)和[审查记录](docs/reviews/window-sidebar-layout.md)。

0.7.0 的「自动发送建议提示词」支持后台聊天并先做风险审查，默认关闭。开启后，Plus 在后台加载任务历史、审查新的原生建议，再通过原生会话接口续轮，无需打开聊天或保持窗口聚焦。普通且范围明确的建议可自动发送；微信、邮件、对外操作、财务及其他敏感事项不自动发送。含糊的“继续”按任务上下文判断；已识别敏感的任务不会因下一条建议换成普通措辞而自动放行。审查失败、上下文不足或权限未知时不发送。

从页面左下角 Codex Plus 或菜单栏打开设置，在「页面增强」中切换「自动发送建议提示词」。设置页不展示待审列表或审批按钮；敏感或无法确认范围的建议不会自动发送。重启、重载和重新开启不补发旧建议。建议正文只留内存，不写状态或诊断日志。

目标有草稿、附件、其他运行轮次或状态未知时跳过，保留输入框。每个来源 turn 只尝试一次，未知结果不重放；原生没有生成建议时不补造。当前适配官方 Codex 26.1106.51428，旧页面需重载。状态命令的 `launcher.suggestionAutoSend.review` 返回审查阶段、待审数量与原因，不输出正文。设计与边界见[后台建议审查方案](docs/designs/suggestion-review.md)。

Codex Plus 是独立的 macOS 菜单栏应用，为官方 Codex 提供统一增强入口、F6 启动、Project 活动排序和工作区自动展开。官方 Codex 安装包及签名保持原样。

Projects 先显示需要输入／批准或报错的任务所属项目，再显示未读、进行中、其余项目；同类项目按最近活动时间排列。项目内任务也按这四类前移，同类保留原生时间或手动顺序；排序发生在“Show more”截取之前，显示和键盘导航共用同一顺序。升级后在 Plus 设置点击“重新接入页面增强”，将旧页面升级到当前排序协议；接入前会检查未提交内容。

0.5.1 将页面入口、App 与菜单栏图标统一为圆形标识：Plus 使用圆环加号，贪吃蛇采用同族圆环；App 使用深墨绿与薄荷绿，菜单栏使用系统着色的矢量模板。图形和尺寸见 [图标规范](docs/visual-identity.md)。Codex Plus 保持最左侧导航条的左下角第一项，打开与菜单栏共用的原生设置窗口；贪吃蛇保持左上按钮组末尾、紧接“项目”下面。两个入口复用原生按钮外观、尺寸、悬停与分组间距。悬停显示名称，两个按钮也支持键盘访问。游戏支持方向键／WASD、空格暂停／继续、Esc 关闭及按钮操作；关闭、切换任务和退出 Plus 会释放本局。现有原生按钮保持相对顺序，收起项目侧栏后两个入口继续可用。增强功能统一由本仓和同一个 Plus 运行实例管理。

页面接入适配 Codex 26.1106.51428。设置显示页面入口与项目排序各自的接入状态；普通方式已运行的 Codex 需要保存工作、正常退出后经 F6 启动。Plus 安装和已有普通宿主的首次页面接入分别验收。实现与验收见[统一入口方案](docs/designs/unified-feature-entry.md)及[验收记录](docs/acceptance.md)。

0.3.0 通过现有 Karabiner 的 F6 规则打开 Codex Plus，再启动或激活官方 Codex。Codex Plus 不显示 Dock 图标；官方 Codex 仍有自己的 Dock 图标。项目按任务活动自动置顶，后台完成也会参与排序；手动重载可恢复所选聊天、原生草稿及活动顺序。当前真实验收覆盖本地 Codex 项目，远程和 ChatGPT 来源保留未验收。

已有官方 Codex 若以普通方式运行，F6 会激活它；正常退出后再从 F6 启动，增强才会装入。启动器不会关闭已有任务，也不自动重载页面。0.5.2 起，每次打开时从 Dock Switch 安装版的已保存配置读取 ChatGPT 的定位规则，按实际宿主 PID 交给 Dock Switch 执行。更改 Dock Switch 定位设置后，下次打开即可生效；配置缺失或不可读时保留窗口位置，状态显示 `configuration-unavailable`。状态中的 `launcher.placementSource` 和 `placementRule` 可核对本次使用的规则。

在 Codex 视图新建任务或切换任务时，仍会展开已收起的右侧栏。ChatGPT 视图保持收起。已展开的工作区保留现有标签页，当前任务手动收起后保持收起。

0.2.0 增加“适用屏幕”：默认所有屏幕，也可勾选实际连接的多块屏幕。选择自动保存，下一次新建或切换任务时生效；移动当前窗口时保留工作区状态。屏幕断开后保留已选条目，相同身份重连后恢复适用。所选屏幕为空时暂停自动展开。

需要 macOS 13 或更新版本，以及用户为 Codex Plus 单独授予的辅助功能权限。当前页面入口已在 Codex 26.1106.51428 的英文界面及浅深色主题核验。界面结构变化、未知模式或读取失败时跳过对应增强。

## 开发与安装

```sh
./scripts/test
./scripts/build
./scripts/install
./scripts/codex-plus --status
```

构建使用 Xcode Command Line Tools，自带 Swift Package Manager。构建物和缓存位于 `~/Library/Caches/codex-plus/`。签名默认使用本机 Longbiao 的 Developer ID，可通过 `CSC_NAME` 指定已安装的签名身份。普通 CI 运行单元测试，签名安装在用户自己的 Mac 上完成。

安装后从菜单栏打开设置，启用“自动展开 Codex 工作区”，授予辅助功能权限，并按需启用“登录时启动”。

在“适用屏幕”切换到“所选屏幕”后逐屏勾选。首次自选会勾选当前可识别的在线屏幕；此后接入的新屏幕保持未选。屏幕身份读取失败或窗口归属有歧义时，自选模式跳过动作，并在只读状态中返回原因。设置窗口支持调整大小和滚动。

状态命令通过当前用户的本地只读接口查询应用运行状态。接口位于 `~/Library/Application Support/codex-plus/status.sock`，返回模式、权限、订阅与动作计数，排查时不需要读取聊天内容。

屏幕诊断包含 `displaySelectionMode`、`selectedDisplayCount`、`connectedSelectedDisplayCount`、`focusedDisplayName`、`displayEligible` 和 `displayDecision`。屏幕归属按当前 Codex 窗口中心判断，偏好使用系统 ColorSync UUID 保存，状态输出省略完整硬件标识。

## 验收与跟踪

本次拆分在 [Issue #1](https://github.com/felixlark/codex-plus/issues/1) 跟踪。

验收步骤见[验收清单](docs/acceptance.md)。

Project 活动排序的[设计与接缝记录](docs/designs/project-activity-order.md)和 [EGM 评审记录](docs/reviews/project-activity-order-egm.md)保留了原型失败及后续修订。运行时只适配已审核的 26.1103.60933 资源路径与源码摘要；未知版本正常打开官方应用并报告增强暂不可用。实际接入发生在首个页面脚本执行前，后续窗口及重载沿同一控制器接入。

本机 F6 配置由 Dock Switch 的独立 Karabiner 配置生成器维护；F6 及既有硬件别名均调用 Codex Plus 的 `--open-codex`，不会抢先直接启动官方宿主。仅配置生成工具改变，Dock Switch 安装包保持不变。冷热启动共用同一入口，可通过状态中的 `launcher.entryRequests`、`lastEntrySource`、宿主 PID 与控制器 PID 核对；注册或配置本身不等于实体按键验收。

开发依赖为精确锁定的 Acorn 8.15.0 和 Electron 45.2.3，保存在本机缓存；产品只打包 Acorn 与许可，使用已验签官方应用内的 Node 运行控制器。隔离 fixture 及原文恢复检查：

```sh
./scripts/setup-project-order-probe --fixture
node scripts/probe-project-order.mjs --mode fixture --scenario all --out "$HOME/Library/Logs/codex-plus/project-order/fixture.json"
```

生产启动使用安装版入口。`probe-project-order.mjs` 的旧 host 模式是历史接缝诊断工具，不应与产品控制器同时运行。关闭 Codex Plus 会移除自有页面按钮和游戏，官方 Codex 继续运行；已执行的排序适配保留到页面重载。重新打开 Plus 可对既有自有调试实例恢复连接。扩展仅保存自己的任务活动时间及路由所有权标记，原生项目手动顺序、聊天与草稿由 Codex 继续管理。

核心逻辑源自 [dock-switch #49](https://github.com/felixlark/dock-switch/issues/49) 和 [PR #50](https://github.com/felixlark/dock-switch/pull/50)，保留 MIT 许可。Codex Plus 独立维护源码、配置、权限、启动与运行状态。Codex 提供原生的同等自动展开设置后，可停用此适配器。

Codex Plus 是独立工具项目。
