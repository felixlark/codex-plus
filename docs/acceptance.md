# Codex Plus 验收

跟踪事项为 [Issue #1](https://github.com/felixlark/codex-plus/issues/1)。


## 0.9.1 build 29 窗口编号（2026-11-14）

实现候选 b98896d，最终签名候选 7aa8028（同步状态/帮助版本号），安装到 `/Applications/Codex Plus.app`。Developer ID、Hardened Runtime、安全时间戳及严格验签通过；安装可执行文件 SHA256 `0b6c44b507cd0f30786fbdc62fb2f42a048faf2d3512b8f2ccddd0cd678957be`，构建/安装包及三项变更资源逐文件一致。

- [x] 68 项 Node、51 项 Swift 检查通过；新分配器覆盖乱序、保存/恢复、关闭/新增、异常/重复编号。独立 EGM readiness 复核未发现阻断，提醒的失败查询保留映射和宿主身份验证后恢复均已采用。Impeccable 局部检测无发现。
- [x] 正式两个真实主窗口的现有 Plus 圆环中央分别可见 1、2；沿用24px图形、36px点击区和原生页脚位置。官方 OCU 截图与只读 target/DOM 互证，两个页面 feature protocol2、排序 protocol8；点击数字2后的原生设置页可见，settingsRequests 0→1。
- [x] 正常退出并从正式路径重启 Plus，controller 77809→79163，宿主 PID64999 保持；同一两个 target/pageId 编号不变，无页面重载。验收期间窗口交换了屏幕，编号仍随原 target 保持，两个布局值与各自目的屏幕先前模板逐项一致，符合窗口标识与屏幕布局两套既有语义。
- [x] 最终状态 0.9.1/build29，页面入口、排序、侧栏布局均 active，自动发送 true；原所选 DELL 屏幕设置保留。正式 Plus 保持运行，没有发送验收聊天或改写原生分区数据。

本机证据 `~/Library/Logs/codex-plus/window-number-20261114/`：readiness.md、tests29.log、build29-final.log、install29-final.log、identity29.json、signing29.txt、number1-final29.png、number2-final29.png、settings-final29.png、final-installed29.json、after-click29.json、restarted29.json、final-status29.json、verification29.txt。最初按“同窗口布局完全不变”的比较因现场跨屏而失败；随后按目的屏幕模板核对，两屏逐项一致，原失败未当作通过。窗口关闭后数字可复用；宿主重开后的新窗口重新分配。

## 0.8.0 build 23 窗口独立侧栏与屏幕记忆（2026-11-14）

安装版 `/Applications/Codex Plus.app`，官方宿主 26.1111.21308 (27194)，宿主 PID64999 全程保持。实现候选 4006a80；Developer ID、Hardened Runtime、安全时间戳及严格验签通过，安装 Mach-O UUID `CB728328-B9F6-3F55-98E9-A4142E152B78`。安装的 controller、sidebar-layout 与其依赖资源摘要逐文件匹配实现候选。

- [x] 59 项 Node、42 项 Swift 全部通过；push 与 PR CI 均通过。独立设计/代码审查及两项实质修订复核见 [审查记录](reviews/window-sidebar-layout.md)。
- [x] 安装版 Plus 设置显示“每窗口独立，按屏幕记忆”；原生设置按钮触发重新接入，两个已有后台 protocol5 窗口都实际重载并加载 sidebar protocol1/bound/configured。既有开发任务继续运行。
- [x] 官方 OCU 操作两个真实窗口，读回外屏 Smart Shadow 展开、Projects 折叠，右屏反向；原生 `aria-expanded` 与各自快照吻合，没有跨窗口同步。页面内容和原生账号分区元数据继续共用。
- [x] 用既有安装版 Dock Switch `move --pid` 窗口定位控制面，把右屏同一个窗口移至 DELL，再移回 Mi Monitor (2)，其 Projects 状态依次采用目的屏幕模板、恢复右屏模板；另一已有窗口保持自身状态。未修改保存的定位规则。OCU 可见截图及只读几何/UUID/原生 aria 补充取证。
- [x] OCU 在原生聊天标题菜单选择“Open in new window”，新增真实窗口15317及主 target。其页面独立 sidebar protocol1，自动采用 DELL 已保存模板，原窗口状态保留。
- [x] 在新增主 target 上调用安装版既有 guarded recovery helper：document ready、11个编辑器长度均0、无附件/对话框、inputRevision=0 才触发重载。新 pageId、同 target、同路由、相同分区布局、configured=true 均读回；没有强制 Page.reload 绕过保护。先前被输入变化拒绝的恢复尝试保留并清理本轮监听器，不当作成功。
- [x] 自动发送建议的原开启偏好已通过原生设置恢复，并读回 enabled=true；两个屏幕模板文件可写且状态 active。新增原生窗口随后交已有项目登记 owner 复用，未关闭他人现场；窗口/安装/源码 writer 按实际安全点释放。

证据留在本机 `~/Library/Logs/codex-plus/window-sidebar-20261114/`：tests23.log、build23-final.log、installed23.json、signing23.txt、opposite-layouts23.json、right-layout23.png、moved-to-external23.json、moved-external23.png、moved-back-right23.json、new-window-ready23.json、guarded-reload23.json、guard-refusal23.json、final-status23.json。只有实际观察的截图用于可见证明；默认 focused-window 的 OCU 返回不冒充指定窗口证据。新窗口身份另由原生窗口列表差量与 CDP target 差量共同核对。

当前主张覆盖本机现行英文 Codex UI 的分区、项目列表与物理双屏；未来宿主资源变更沿源码守卫降级。原 F6 硬件路径与未改的右侧工作区 Cmd+N/模式行为复用既有候选有效证据，本项没有重做硬件发键或发送验收消息。

## 0.7.0 build 21 项目行新建任务展开（2026-11-14）

项目悬浮信息卡也可暴露为 `AXApplicationDialog`。此前观察器不区分模态状态，会将信息卡视为阻塞对话框并清空任务基线，使项目行新建页跳过展开。现在读取公开 `AXModal` 属性：明确非模态的卡片不再阻塞；真正模态及模态状态不可读取的对话框沿用原保护。

- [x] 47 项 Node、42 项 Swift 检查通过，新增回归覆盖非模态悬浮卡、真正／未知对话框及重复事件；原对话框重建基线检查保留。
- [x] Developer ID 签名构建、正式安装及严格验签通过；构建与安装可执行文件 SHA256 均为 `f15505b2923755930e1b0f00c6db3a49b9b545fc05615cb3160f0d8feb443a8c`。
- [x] 从正式安装版运行：手动收起新建页后返回已有聊天，再点击项目行 `Start new chat in codex-plus`，新建页右侧自动恢复；动作计数 1→2。OCU 控件树确认 `Chat tabs`、`Hide tabs` 和 New tab 内容可见。手动收起当前页保持，切换已收起聊天也能展开。
- [x] 恢复原活动列表开启及本案聊天，窗口从 OCU 辅助屏恢复；宿主 PID 64999 保持，未发送验收消息。安装保留旧版回退包。
- [ ] 带真实指针悬浮卡的点击路径未单独取得截图；该分支由结构回归覆盖。
- [ ] Longbiao 最终接受；Issue #1 保持开放。

证据：`~/Library/Logs/codex-plus/project-new-chat-20261114/`，含 tests.log、build.log、install.log、installed-hashes.txt、project-new-result.json、final-ocu.txt 及 final.png。OCU 在退出 Plus 后自动重新打开了旧版；最终通过公开 `NSRunningApplication.terminate()` 正常退出自有 Plus 后完成安装，未强制结束或重启宿主。

## 0.7.0 build 20 设置页移除待审建议（2026-11-14）

- [x] 移除设置页待审列表、空状态、批准／拒绝／重审按钮及对应原生界面数据处理；提示文案不再引导到待审列表。后台审查规则保持，敏感或范围不明的建议不自动发送。
- [x] 47 项 Node、40 项 Swift 检查通过；Developer ID 签名构建、正式安装及严格验签通过。构建与安装可执行文件 SHA256 均为 `fe9ff6ba40a9ad33b1ac5382621adedc862b9348e0fc4ca3ab1514e0ccf9c7ba`。
- [x] 从 `/Applications/Codex Plus.app` 启动设置页，OCU 截图及完整控件树确认建议开关之后直接进入工作区设置，无待审区块或审批按钮。自动发送保留开启，宿主 PID 64999 未重启；页面入口、项目排序及连接均 active。
- [ ] Longbiao 最终接受；Issue #1 保持开放。

证据：`~/Library/Logs/codex-plus/settings-cleanup-20261114/`，含 tests.log、build.log、install.log、signing.log、settings-ocu.txt 及 final.json。安装脚本保留旧安装包供回退。本次只验收设置页变化，未重复后台发送或硬件快捷键验收。

## 0.7.0 build 19 工作区展开适配（2026-11-14）

宿主 `/Applications/ChatGPT.app` 26.1111.21308 (27194) 将收起时的入口改为 `AXCheckBox`「Show tabs」。旧适配仅识别「New tab」，使收起状态变成未知，任务切换无法触发展开。本版识别新版入口并保留旧版按钮／弹出按钮；沿用任务身份、屏幕范围及手动收起保护。

- [x] 47 项 Node、40 项 Swift 检查通过；新增回归覆盖新版收起结构，以及不把 Hide tabs、菜单或文本当作展开入口。
- [x] Developer ID 签名构建、正式安装及严格验签通过；构建与安装可执行文件 SHA256 均为 `74f8e8ddb19e46d5f06df6109a3f47a7a94751d7b97d151239ecd324ebceed0c`。
- [x] 在真实安装版收起本案工作区，切到已有验收聊天再返回，右侧工作区可见恢复；动作计数 0→1。
- [x] 当前任务手动收起后保持收起；通过 OCU 的应用内 ⌘N 新建 Codex 页，工作区展开，动作计数 1→2。此项验证应用快捷键，不声称硬件 HID 路径。
- [x] 切到 ChatGPT 模式，收起后应用内 ⌘N，保持收起，动作计数仍为 2。
- [ ] Longbiao 最终接受；Issue #1 保持开放。

证据：`~/Library/Logs/codex-plus/workspace-fix-20261114/`。既有用户偏好及未发送草稿保留，宿主进程未重启。旧安装包由安装脚本保存在 Library/Caches 下供回退。

## 0.6.0 后台原生建议（2026-11-12）

Sol 正式安装版 `/Applications/Codex Plus.app` 0.6.0 build13；Mach-O UUID `443A8B04-FEA3-35EF-92E8-7F44FB205A9B`，安装版与构建缓存的可执行文件SHA256同为`c889c83e556d5c5d7b46a81cd43d961162d06a9a3aa00187cdbc72268d1a2055`，安装版严格验签通过。build12的UUID为`CAA6708B-4AC6-3DA6-AB6C-98449F774272`；build13因嵌入的Info.plist版本号变化重新链接。原记录误将build12 UUID沿用于13，发布前已按安装包、缓存及保留备份核正。官方宿主 `26.1106.51428` 的包未修改。JS资源安装与源码SHA256一致。开关通过原UserDefaults保留true，原生设置窗实际显示“无需打开会话”“已开启 · 前后台聊天的新建议将自动发送”。

- build12真实后台发送：保持其他聊天选中，官方send_message_to_thread只给既有测试chat `01a1ce66-e97c-73c1-abdc-1a523ff783aa` 发送无工具/文件的seed；原生live建议触发。自动产生用户消息“只回复 CP-BACKGROUND 自动续轮完成，本轮到此结束”，下一轮 `01a1cf4a-8ecc-7260-968d-d1e64d0ca886` completed，官方read_thread读回。整个发送前未导航到目标chat；用户期间可自行切换其他chat。随后另一原生建议也自动续轮，证实可能连续执行。
- 草稿保护：上述成功后才打开测试chat，填入36字未发送的本案终止验收草稿，再切走。后台seed轮 `01a1cf4b-f131-79a2-bd5e-093f95051183` completed并实际生成新的live候选；target probe为false，协调器显示draft-or-state-changed，后续官方read_thread仍停在该轮，未自动发送。草稿保留，开关始终true。检查覆盖切走后的原生保留composer节点。
- 最终build13只移除候选条数的硬上限，发送与检查链路未变化；复用build12真实发送/保护证据，7项定向Node测试重跑通过。原候选完整scripts/test为17 Node +35 Swift全部通过。签名build/install后主页面重载，bridge protocol2/registered3、mode background-native、pageReady true已读回。重启恢复不重放来源轮。
- 已核代码接缝：原生J8Ro后台live缓存写入，GNwQ原生scope包装及retainedScopeEntries生命周期；独立复审见[评审记录](reviews/background-suggestions-egm.md)。关闭/持久化故障/跨窗口重复/晚期许可拒绝有确定性测试；本轮保持用户开启偏好，没有为验收临时关闭总开关。原生未生成或过滤的场景不声称覆盖。

证据：`~/Library/Logs/codex-plus/background-suggestion-20261112/`，含official-thread-readback.json、seed-route.jsonl、after-background.jsonl、draft-block-candidate.jsonl、tests.txt、build13.txt及运行状态。运行态以该目录RESULT.md的最新读回为准。

0.5.2的F6定位基线沿用：另一owner已通过NanoKVM真实USB键盘完成热启动entry6→7和正常退出后的冷启动，旧Plus4922/host5156退出，新Plus41501/controller41502/host41520；DELL外屏external_fill正确，autoSend true与三项增强恢复，按键释放。该证据绑定0.5.2 build11，未声称build13重新做了KVM冷启动。原始记录 `~/Library/Logs/codex-plus/kvm-acceptance-20261112/`。

## 0.5.2 F6 沿用 Dock Switch 定位（2026-11-12）

Sol 正式安装版 `/Applications/Codex Plus.app` 0.5.2 build 11。每次打开从 Dock Switch 安装配置读取 ChatGPT 的 `placement`，当前为 `external_fill`；定位由 Dock Switch 按实际宿主 PID 执行。配置修改下次打开生效，读取失败保留窗口位置。构建与安装 Mach-O UUID 同为 `414C2C9A-79BC-382B-BDC9-F8B9A81FCFDC`，Developer ID Team HJG65XBC25、Hardened Runtime 和安全时间戳有效，安装版严格验签通过。旧版备份在 `~/Library/Caches/codex-plus/previous-install.jkIOi7/Codex Plus.app`。

- [x] 16 项 Node、35 项 Swift 检查通过。新增回归覆盖 ChatGPT 与 Codex 规则区分、设置更改后重新读取、铺满／半屏透传、不可读／缺失配置保持原位。
- [x] F6 对应的实际启动命令在安装版上将既有窗口从右屏移回主外屏；状态为 `placementSource=dock-switch`、`placementRule=external_fill`、`placement=placed`。
- [x] Longbiao 按一次实体 F6 后，入口计数 5→6，Plus PID4922、宿主 PID5156 保持；真实窗口 w-11718 从右屏 `(2022,-1050,1920,1050)` 回到 DELL U3219Q 工作区 `(-538,-1410,2560,1410)`，官方 Computer Use 可见确认。
- [x] 最终页面入口与项目排序 active，自动建议 enabled=true、pageReady=true、unknown=0；工作区观察正常。现场保留主外屏正常运行，既有用户设置沿用。
- [ ] Longbiao 最终接受；Issue #1 保持开放。本次实体 F6 覆盖已运行宿主的打开路径。

证据：`~/Library/Logs/codex-plus/dock-placement-20261112/` 的 tests.log、build.log、install.log、installed-signing.log、dock-switch-rule.json、displays.json、before-physical-f6.json、after-physical-f6.json 和 physical-f6-windows.json。

- [x] 独立安装版能启动，菜单栏可打开设置、关闭窗口和退出。
- [x] Codex Plus 的辅助功能权限已授权，状态显示正在观察 Codex。
- [x] Codex 视图按 ⌘N 后自动展开右侧工作区。
- [ ] ChatGPT 视图按 ⌘N 后保持收起，动作计数保持稳定。
- [ ] 在已展开任务间切换时保留现有标签页。
- [ ] 手动收起当前任务后保持收起，切换到另一个已收起任务时展开。
- [x] 关闭设置中的自动展开后停止动作，重新启用后恢复任务切换展开。
- [x] 登录启动设置能保存，状态命令可回读系统注册状态。
- [x] Dock Switch 安装版已移除对应设置、观察器和旧状态入口。
- [ ] Longbiao 完成最终验收。

运行记录保存在本机日志目录。GitHub 只记录脱敏结果、候选与安装身份。

## 回退

退出 Codex Plus，并关闭它的登录启动。需要回退到旧实现时，恢复本次切换前保留的 Dock Switch 安装包，保证只启用一个观察器。用户偏好和聊天保持在各自应用中。


## 交付验证

2026-11-09 在 Sol 上完成。源码候选为 af634325757c92af2c482de5ac7e3c631c685b25，
Codex Plus 版本为 0.1.0，签名使用 Developer ID Application、Team HJG65XBC25、
Hardened Runtime 和安全时间戳。构建与安装的 Mach-O UUID 相同。

本地与 GitHub Actions 的 21 项核心测试均通过。Dock Switch 的 102 项 Node 测试和
55 项剩余 Swift 测试通过。安装版设置页、权限状态、登录启动、开关停启、退出与重新打开
已通过官方 Computer Use 和状态回读检查。

最终任务展开与模式切换请按上方未勾选项验收。迁移中的运行记录保留在本机日志目录。

[源码候选的 CI 记录](https://github.com/felixlark/codex-plus/actions/runs/42586989496)

[Dock Switch 移除变更 PR #58](https://github.com/felixlark/dock-switch/pull/58)

## 0.2.0 按屏幕选择

设计见[按屏幕自动展开方案](designs/screen-aware-workspace-auto-expand.md)，Longbiao 于 2026-11-10 批准实施。

- [x] 安装版列出当前实际屏幕，支持多选和所有屏幕模式。
- [x] 取消当前屏幕勾选后，真实 ⌘N 保持收起，动作计数维持。
- [x] 重新勾选当前屏幕时，当前收起任务保持；下一次真实 ⌘N 展开一次。
- [x] 关闭 pane 后当前任务保持收起。
- [x] 自选空集显示暂停；重启应用后空集继续保留。
- [x] 仅选一块屏幕，重启应用后仍仅该屏幕勾选，状态回读一致。
- [x] 动态接入的工具显示器自动出现在列表，自选模式中初始未勾选。
- [x] 已恢复自动展开开启、所有屏幕、登录启动开启的正常现场。
- [x] 33 项核心测试通过，包括屏幕几何、身份异常、持久化、配置变化的基线与生命周期。
- [ ] 实体屏幕拔插、换接口和整机重启后核对身份恢复。
- [ ] 真实镜像模式与全部跨屏布局现场验收。
- [ ] Longbiao 最终接受屏幕选择功能。

0.2.0（build 2）使用 Developer ID Application、Team HJG65XBC25、Hardened Runtime 和安全时间戳签名。
构建与安装的 Mach-O UUID 均为 `28E0E98E-613D-3AF4-BF0B-1AEB94D0CFD7`。
本次先通过 Open Computer Use 插件执行按键与 header 控件检查，后通过 Codex 内置 Computer Use 完成保存、重启与设置恢复。
本机证据位于 `~/Library/Logs/codex-plus/screen-design-20261110/`。

ChatGPT 模式切换后已观察到动作计数保持。此次在该模式发送 ⌘N 后，宿主新窗口实际进入 Codex 模式，
因此上方“ChatGPT 视图按 ⌘N 后保持收起”保留独立待验收状态。


## 0.3.0 Project 活动排序与 F6 入口（2026-11-11）

执行电脑 Sol。安装候选 0.3.0 build 4，Developer ID Team HJG65XBC25、Hardened Runtime、安全时间戳 2026-11-11 13:21:57；构建与安装 Mach-O UUID 同为 `1B48616F-C393-332B-AF49-AEB7ED5F2336`。官方宿主为原签名 Codex 26.1103.60933（本机包名ChatGPT.app，bundle com.openai.codex，Team 2DC432GLL2）。前后验签通过，供应商文件未改写。

- [x] 普通启动器与官方应用各有Dock item的实验已确认；最终Plus为LSUIElement/accessory，无自己的Dock item，官方Codex保留Dock item。
- [x] 查实生效的Default Karabiner profile；仅四处Codex入口命令改到Plus，F3、普通F5、CapsLock、右Command及其他字段保持。配置备份及生成器check通过。
- [x] 安装版冷启动参数--open-codex打开独立测试资料的官方宿主；两个已审资源在首次执行前适配，无额外Page.reload。
- [x] 相同Karabiner命令重复打开走reopen；入口计数增加，Plus及宿主PID不变，右侧布局按已存在PID完成。
- [x] Longbiao按实体F6后，入口计数由2增至7；仍为同一Plus与官方宿主，没有重复启动。
- [x] 同一安装候选：折叠B执行sleep120；后来在C取得CP-C FINAL FOREGROUND OK并保留未发送草稿。B完成后置顶，B仍折叠、C仍选中、草稿完整。随后查看B，存在CP-B FINAL BACKGROUND OK及Worked for 2m 5s。
- [x] 手动重载同一聊天后，所选C、原生草稿及B/C/A顺序恢复；活动时间与原生时间均参与。
- [x] 新聊天重载保持新聊天，不错误打开此前C聊天或其草稿。DOM占位文字探针不可靠的一次失败保留；最终以AX的Do anything空输入及路由/旧内容缺席联合核验。
- [x] 终止自有controller后，Swift自动重连；Plus PID84332、宿主PID84870不变，controller由84442变99173；没有强制刷新或关闭宿主，C及草稿保持，后续重载继续适配。
- [x] 原生File → New Window创建第二真实窗口，首次执行即协议6；两个窗口均显示B/C/A，控制器无拦截错误。
- [x] 33项Swift核心测试、3项活动时间/多窗口/路由回归、4类动态Electron fixture通过；Dock Switch全套Node及55项Swift测试通过。
- [ ] Longbiao最终接受此功能；Issue #1保持开放。

独立测试资料、三个本地项目和证据保留；覆盖为本地Codex项目。远程Codex/SSH及ChatGPT来源未作真实账号交互验收；不据本地结果外推。既有原生导航的消费者链及Pinned/自定义区回归复用对应未变接缝和fixture证据。

正式入口恢复时保留已运行的生产Codex（PID2355及其任务）；该旧实例尚无启动调试通道。当前运行实例由F6激活，下次正常退出后再经F6启动才会加载自动排序；不为测试关闭已有任务。关闭Plus只断开自有控制器，正常退出官方宿主后调试监听关闭。回退0.3需同时恢复Plus旧安装及所保留的F6配置，保持Dock Switch旧观察器停用。

本机候选证据：`~/Library/Logs/codex-plus/launcher-20261111/`，包括installed-reload.json、installed-new-chat-reload.json、installed-multiwindow.json、installed-acceptance-status.json、karabiner-migration.json、installed-final-reload.png。历史实验与未通过记录继续保留，未冒充当前通过证据。


共享宿主协调收尾：已正常退出测试Plus84332及controller99173，先回读确认官方测试宿主仍运行，再正常退出84870及其backend85608，59068监听不再可达。生产2355/2425保留原启动时间，未启动生产CDP控制器或重载生产；未修改其他任务的全局并发设置。由于既有“调查cloudd卡顿原因”任务正在核验生产宿主，本任务保存安全点并不再激活/启动生产App。已安装正式候选和F6配置保留，下一次F6冷启动不带验收参数，将使用正式资料；不把独立测试实例写作生产重开或全局配置生效证据。

## 0.4.0 统一入口与贪吃蛇（2026-11-12）

用户批准修正后的 GSE 方案：左下角按钮区第一项为 Codex Plus，末项为贪吃蛇；菜单栏程序保留。执行电脑 Sol，官方宿主 26.1106.51428，安装版 `/Applications/Codex Plus.app` 0.4.0 build 6。Developer ID Team HJG65XBC25、Hardened Runtime、安全时间戳 2026-11-12 13:34:48；构建与安装 Mach-O UUID 同为 `81F8BBC9-82AF-3626-9D0F-84613E6A0D56`。官方宿主前后验签通过，Team 2DC432GLL2，供应商安装包保持原样。

- [x] 真实导航条底部为 Plus、Usage、Profile、贪吃蛇；Plus 第一、蛇最后，原有操作顺序保持。
- [x] 页面 Plus 打开原生设置，`settingsRequests` 增加；菜单栏“设置…”打开同一窗口；窗口清单只有一个 Plus 设置窗口。
- [x] 设置显示页面接入与项目排序的独立状态。登录启动、原有开关、屏幕选择及辅助功能授权保持。
- [x] 游戏在当前页以原生 dialog 居中显示，标题、棋盘、状态及按钮可读；浅色、深色主题均保留截图，临时主题恢复 System。
- [x] 实际空格键开始／暂停，Esc 关闭；同页新建聊天的 ⌘N 关闭游戏，原草稿 `jk` 保留；重开从待开始进入。移动、增长、碰撞、暂停、重置、填满胜利用确定性逻辑检查补充验证。
- [x] 收起项目侧栏后两个入口继续在左下角可见，恢复展开后仍各一份；Settings 往返后入口恢复。
- [x] 从安装版入口冷启动官方宿主；两个已审核资源装入，`adaptedScripts=4`、页面入口和项目排序均 active。File → New Window 创建第二真实主窗口，两个窗口入口各一份。
- [x] 终止自有 controller 86463 后，Swift 恢复为 88182；Plus 86141、官方验收宿主 86486 保持，旧游戏销毁、入口各一份、草稿保留。未结束日常宿主 46366。
- [x] 正常退出 Plus 后控制器记录 stopped；先前真实卸载检查显示按钮／游戏移除，官方窗口和草稿保留。重新打开 Plus 可恢复既有自有实例。
- [x] 10 项 Node、33 项 Swift 检查通过。4 类隔离 Electron fixture 分别通过：late-attach、response-disconnect、source-mismatch、window-recreate；退出后调试监听清理由 fixture 检查。
- [ ] 日常普通启动实例的首次 F6 冷启动接入。该实例正在执行其他任务，保留至用户正常退出后再从 F6 启动。
- [ ] 更新版上的直接主页面重载，以及真实后台任务完成后排序的完整场景；结构检查、纯逻辑、fixture 与前版未变行为证据分别保留。Cmd+R 实际调用“Reload Browser Page”，本次未记作主页面重载通过。
- [ ] Longbiao 最终接受；Issue #1 保持开放。

界面工具：官方 Computer Use 用于 Plus 设置与菜单退出。它按 bundle ID 选中日常实例，独立实例选择受限；按用户对原生控制的既有授权，使用 agent-desktop 1.2.0 的窗口编号 `w-8692`／`w-8750` 做验收，必要按键走 `--headed press --window-id`。公开 CoreGraphics 窗口清单与只读 CDP 状态作辅助证据。GUI 操作由主 Agent 单 writer 执行。独立资料沿用现有 acceptance-20261110，保留已有测试项目与草稿。

证据位于 `~/Library/Logs/codex-plus/unified-entry-20261112/`：tests-final.log、build.log、install.log、installed-acceptance-status.json、fixture-*.json、installed-snake-final.png、installed-snake-light.png；早期不通过记录保留。正式现场恢复到默认启动参数的菜单栏 Plus，日常 Codex 与任务保留；独立测试实例正常退出，独立验收与日常首次冷启动分别报告。

## 0.4.1 导航位置与图标修正（2026-11-12）

按用户最新纠正：贪吃蛇移到左上导航按钮组 Projects／项目正下方，Codex Plus 保持左下角第一项并重设计图标。执行电脑 Sol，正式安装版 0.4.1 build 7；Developer ID Team HJG65XBC25、Hardened Runtime、安全时间戳 2026-11-12 14:05:08。构建与安装 Mach-O UUID 同为 `9598A7F8-F549-3AEA-8E71-8B12FCD42CAA`，安装版严格验签通过。

- [x] 官方 Computer Use 截图与可访问性树确认 Projects 后紧接贪吃蛇，底部顺序为 Plus、Usage、Profile，入口各一份。
- [x] 只读页面尺寸核对：Projects、贪吃蛇、Plus 均为 36×36，SVG 均为 20×20，颜色相同；上方组间距为原生 8px，现有分隔线保留。Plus 使用侧栏窗口加号，蛇使用同线宽轮廓。
- [x] 通过页面 Plus 实际打开安装版原生设置，`settingsRequests=1`，页面接入提示正确；关闭设置后通过蛇按钮打开游戏，真实关闭按钮返回原聊天。
- [x] 替换 Plus 后接入已运行的日常官方宿主 40564，未退出或重载宿主；Plus 81083、controller 81102，页面与项目排序 active，现有任务继续。前版日常实例尚未接入的历史边界由本次当前运行态接入证据补充。
- [x] 10 项 Node、33 项 Swift 检查通过；签名构建、安装与 `git diff --check` 通过。图标静态检查无发现。小范围位置与样式修正复用前版游戏逻辑及生命周期验证。
- [ ] Longbiao 最终接受；Issue #1 保持开放。

官方 Computer Use 为本次 GUI 取证与点击主工具；菜单栏退出无窗口的旧 Plus 使用已授权的原生菜单工具。agent-desktop 截图因缺 Screen Recording 权限未成功，未新增权限，最终保存官方 Computer Use 实际返回的截图。证据：`~/Library/Logs/codex-plus/entry-refinement-20261112/`，含 installed-navigation.png、installed-snake.png、installed-layout.json、installed-status.json、tests.log、build.log。最终设置和游戏窗口关闭，菜单栏 Plus 与日常官方宿主正常运行。


## 0.5.0 建议提示词自动发送（2026-11-12）

执行电脑 Sol，基线 f456ef4。最终安装版 `/Applications/Codex Plus.app` 0.5.0 build 9，Developer ID Team HJG65XBC25、Hardened Runtime、安全时间戳 2026-11-12 14:19:53；构建与安装 Mach-O UUID 均为 `92D67DC7-3145-3A31-95BF-89219FAC7013`。官方宿主 Codex 26.1106.51428、PID 40564，全程保留进程与已有任务。

- [x] 两位独立方案初审及一次 fresh-context 定向复审完成；修订后零 Blocker/Major。候选代码独立审查完成，状态显示及路由支持意见已落实。
- [x] 16 项 Node、33 项 Swift 全测通过；最终结果观察分支的 6 项建议专项回归通过。隔离 Electron fixture 的 12 项页面动作/输入法/草稿/附件/卸载检查通过。
- [x] 官方 Computer Use 核验真实安装版开关默认关闭、开启/关闭、状态变化；重装/重启保持关闭值，原有工作区、屏幕选择和登录启动保持。
- [x] 从原生 File → New Window 新建独立验收窗口，当前 renderer 的原生预测资源被适配；既有日常窗口继续运行。当前已加载旧资源的页面需重载或新窗口接入。
- [x] 原生验收聊天「验收 Codex Plus 建议提示词」中，第一轮结束后原生建议「继续无副作用验收」出现，关闭时保持；开启后旧建议作为基线跳过。第二轮完成后新 sourceTurnId 的同文建议被自动采纳并通过原生 Send 提交，下一轮真实完成为 `CP-SUGGESTION 第三轮完成`。第三轮 id 为 `01a1ce68-b9f1-79f0-87bb-8556e5e16db6`，官方 read_thread 读回 completed。
- [x] 该原生采纳/提交接缝在 build 8 验收；最终 build 9 保持同一接缝和页面脚本，提交后焦点/输入 revision 变化的结果观察使用最终专项回归验证，复用未变接缝证据。最终 build 9 中人工草稿保持且零尝试，开关关闭和页面接入读回通过。
- [x] 控制器层确定性覆盖：默认关闭、旧建议基线、跨窗口同 turn 单次认领、关闭发生于落盘等待期间、落盘失败停用、用户事件/焦点/路由取消、结果未知不重试、重连持久化防重放。原生读取函数的组合输入与附件保护由 fixture 补充。
- [ ] 远程 Codex、更多界面语言和跨设备来源真实验收；当前原生验收覆盖本机英文界面。
- [ ] Longbiao 最终接受；Issue #1 保持开放。

本机证据 `~/Library/Logs/codex-plus/auto-suggestion-20261112/`：tests.log、tests-final-suggestion.log、dom-fixture.json、build-final.log、install-final.log、native-auto-send.json、build9-native-observations.json、final-disabled-status.json。原生测试模型实际 GPT-6.1 Sol / High，未改变其他任务设置。界面由官方 Computer Use 和 agent-desktop 1.2.0（精确窗口 w-9427）操作；只读 CDP 和官方 read_thread 辅助核验。验收窗口关闭，原生草稿保留，正式 Plus 恢复默认关闭的正常运行状态。

同案三步：方案评审完成，实施与上述范围验收完成，X 推文待最终正文确认/发布。

## 0.5.1 圆形图标（2026-11-12）

用户要求页面图标统一圆形，并设计 App 和菜单栏图标。以 3dc4bc9 为集成基线，采用 Impeccable 的局部图标精修流程。Sol 正式安装版 `/Applications/Codex Plus.app` 0.5.1 build 10；Developer ID Team HJG65XBC25、Hardened Runtime、安全时间戳 2026-11-12 14:25:20。构建与安装 Mach-O UUID 均为 `B6B4216D-5ABD-37A2-97C0-36F932F41FA8`，严格验签通过。

- [x] Plus 为圆环加号，蛇为同族圆环；安装版实际页面截图及只读几何核对确认入口各一份、按钮 36×36、SVG 20×20、圆环半径 7.25、线宽 1.4、fill=none，位置及原生展示属性保持。
- [x] App 使用深墨绿圆底和浅薄荷标识，透明图形导出完整 16…1024 像素 ICNS；Finder 中的安装版图标已实际显示并保留 OCU 截图。
- [x] 菜单栏使用自有 18pt 矢量 PDF，NSImage 读回为 NSPDFImageRep；设为 template，由系统处理颜色。实际展开菜单并进入设置成功。页面 Plus 也实际打开相同设置；自动建议开关保持关闭、原有屏幕和登录启动保留。
- [x] 圆形蛇入口实际打开游戏，关闭回到原聊天；最终游戏和 Plus 设置关闭，本轮打开的 Finder Applications 验收窗口已关闭，原有 Finder 窗口保留。
- [x] 16 项 Node、33 项 Swift 通过；Impeccable 图标静态检查无发现；签名构建、安装、plist 与 diff 检查通过。图标改动复用未变游戏和建议功能验收，未重复发送聊天测试消息。
- [x] 原正式宿主 PID40564 全程保留，未退出或重载；新 Plus PID2438、controller2446，页面和排序 active。建议功能保持 disabled，既有旧页面的 page-reload-required 状态原样保留。
- [ ] Longbiao 最终接受；Issue #1 保持开放。

证据：`~/Library/Logs/codex-plus/circular-identity-20261112/`，包括小尺寸浅深色预览、installed-navigation.png、installed-finder.png、installed-settings.png、installed-snake.png、installed-layout.json、installed-final-status.json、tests.log、build.log、signing.log。OCU 用于截图及页面/原生设置；无窗口的菜单栏由已授权原生工具操作。菜单图标的全屏像素截图未取得：OCU 无可选 key window，CUA 同样超时，原生截图工具缺 Screen Recording 权限；未新增权限，菜单可用性与安装包矢量资源分别取证，不将预览冒充实际菜单截图。

## 0.7.0 后台语义审查与敏感建议待审（2026-11-14）

正式安装 `/Applications/Codex Plus.app` 0.7.0 build17，bridge protocol5。Mach-O UUID `696EB81E-74F4-3C49-92EB-E4F8E96D2AA5`，严格验签通过；安装的 controller、发送桥、审查策略、LaunchServices helper 与源码逐文件摘要相同。宿主 PID1605 保持运行。

- [x] 43 项 Node、39 项 Swift 通过，签名构建/安装及 diff 检查通过；方案、风险粘连、升级接入、验收范围及关闭路径独立审查的适用发现均已修复和复核。
- [x] OCU 在真实安装版点击“重新接入页面增强”，四个原生主页面全部 protocol5、registered>0、legacyPages=0、pageReady=true，无需用户手动刷新或退出 Codex。
- [x] 未选中的旧验收任务通过 readonly preview 原生加载完整历史并完成 thread/sample 语义审查，`sourceUnchanged=true`、`historyComplete=true`；保留已有36字符草稿，preview 不批准、不捕获、不认领、不发送。
- [x] OCU 新建无副作用夹具“确认 CP17 夹具就绪”（`01a1d886-6519-7290-a6d0-54044b800712`），随后切回本开发聊天。Plus 以仅此 UUID 的 RAM-only 验收范围启用自动发送。原生新建议经审查后后台提交一次，官方 read_thread 确认续轮 `01a1d888-4a8d-7391-b376-cc9db550c62e` completed，回复 `CP17 后台续轮完成`；未切目标任务。
- [x] 含邮件/微信的纯字符串夹具停在待审列表，OCU 读回具体行动、对象、范围和单次批准说明；提交数保持1。OCU 点击“批准本次”后，原生后台续轮 `01a1d889-220d-7d82-aac1-d36e4751c74a` completed，提交数变2。夹具禁止工具和实际通信，未执行真实敏感操作。
- [x] 第二条敏感字符串建议进入待审后，OCU 点击“拒绝”，列表清空且 submitted 保持2，没有对应新增续轮。关闭验收开关并退出范围会话，正常重启后 scoped=false、日常自动发送仍关闭。
- [x] 安装版无效 acceptance UUID 立即退出2，拒绝无范围启动；日常偏好不受验收开关影响。父进程退出后 controller 9.8秒内自行退出，宿主仍存活。
- [ ] Longbiao 最终接受；Issue #1 保持开放。

本轮 Codex GUI 由已安装官方 OCU 原生 MCP/CLI 控制；连接器 transport 关闭时恢复同一 OCU 的 stdio MCP 会话。另一套统一 CUA 的拒绝不作为 OCU 拒绝证据。生产版本没有 Reload Window，未要求用户执行不存在的菜单。CDP 仅用于产品接入、只读观察及产品定义恢复动作；不以它代替 GUI 输入。

证据：`~/Library/Logs/codex-plus/suggestion-review-20261114/`，含 tests17.log、build17.log、installed17-identity.json、native-thread-evidence.json、pending-sensitive-ocu.txt 及最终状态。宿主冷启动/截图责任归属尚未在本轮验收；helper 的源码和单元检查不能替代该结果。原生采样每条建议增加一次模型调用，固定宿主资源变更后关闭发送等待重新审查。

### 更新后兼容复验：build18

桌面更新至 Codex 26.1111.21308（27194）时，build17 的固定资源守卫按预期停用。对新 host907538、route757723、scope956370、bootstrap631 完成源码核对后适配；明确 `allowInProgressTurn:false`，并将二进制守卫从 shell wrapper 改为真正 arm64 Mach-O。独立源码复核零 P1/P2。

- [x] 47 Node / 39 Swift 通过；签名 build18 安装及严格验签通过。Mach-O UUID `C9BE294C-42E3-3BE4-B61B-341B9D11E5E7`，安装源码逐文件一致。
- [x] OCU 点击产品重新接入，protocol5 registered2、pageReady=true、legacyPages=0；原生 preview 再次 `historyComplete=true`、`sourceUnchanged=true`。
- [x] 只绑定原验收 UUID，保持当前路由 `/`，原生自动提交一次 `只回复 CP18 后台续轮完成，不使用工具，回复后结束。`，官方 read_thread 读回 turn `01a1d894-7317-7fc2-8dce-83856c069eaa` completed。

本候选同时集成既有界面任务的 footer 尺寸与先清理界面再等待在途请求补丁；可见退出/尺寸验收归原任务，不以本次建议续轮代替。宿主为更新后 PID64999，未为本次验收强退。

- [x] build18敏感字符串建议停在待审，展示行动/对象/范围；OCU拒绝后submitted保持1。已退出仅测试UUID会话并正常重启，保留更新后检测到的日常偏好；未将测试开关写回日常偏好。


## 0.9.0 build 25 状态优先排序（2026-11-14）

原排序只按最近活动时间排列项目，项目内沿用原生时间顺序，导致较新的闲置任务穿插在旧的进行中任务前面。现在项目与完整任务列表都优先显示需要输入／批准／报错、进行中、未读、其余；项目同类按活动时间，任务同类保留原生排序。投影位于原生预览截取和导航生成之前。

- [x] 排序候选 `0211af6` 的64项Node、42项Swift检查及远端CI通过；与布局验收文档集成后的候选树保持不变。PR #8以保留祖先的merge方式合入，merge为 `df94e81b515ca02ad216b24edd87df95d2810da0`。
- [x] build24签名构建通过但未单独安装；实际验收使用统一安装版 `/Applications/Codex Plus.app` 0.9.0 build25、Plus PID16753、controller17096，宿主PID64999保持。安装版排序脚本SHA256 `07da289a5052b6da345989d3d35b4320520efcbb56608038258f14e14d8412ec`，与候选源码一致。
- [x] OCU在设置页临时关闭自动发送并执行重新接入。首次因当前聊天有输入而拒绝；通过原生导航切至本案空编辑器后，所有页面安全检查通过并完成接入。随后恢复自动发送true、watching、pageReady=true、unknown=0，并返回先前聊天。验收没有编辑或发送输入内容。
- [x] 两主窗口排序协议均为7、projectOrder及sidebarLayout均active；每窗57个项目的优先级倒置均为0，旧现场有3处。OCU可见error项目quant-trading位于Projects第一，smart-shadow中的两个Working任务先于闲置任务，wechat-use中的旧Working任务也移到闲置任务之前。Pinned和自定义分区继续显示。

本次证明本地Codex项目；不外推远程或ChatGPT来源。证据目录：`~/Library/Logs/codex-plus/sidebar-priority-20261114/`，包括tests.log、build.log、signing.log、candidate-hashes.txt、merge-tree.json、pr-merge.json、before-order.json、after-order.json、after-ocu.png/txt及final-status.json。


## 0.9.0 build 27 未读优先于进行中（2026-11-14）

用户明确对调原“进行中→未读”的顺序。项目和完整任务列表现为：需输入／批准／错误 → 未读 → 进行中 → 其余；同类原生顺序保留。当前排序协议8，旧协议7须沿既有guarded reconnect接入。

- [x] 候选933b860，64 Node与51 Swift检查通过；项目、完整任务列表和状态转换断言均明确验证未读先于active。Developer ID签名构建build27并通过scripts/install正式安装，旧版保留回退备份。
- [x] OCU从正式设置页临时关闭自动发送、点击重新接入，安全检查通过并显示已重新接入；随后恢复自动发送true。Plus PID46103、宿主PID64999保持，两个主窗口均protocol8、projectOrder active；最终autoSend enabled=true/pageReady=true。
- [x] 只读原生模型运行证据：两窗均有unread=2、active=13，按新优先级的项目倒置均为0。OCU确认新设置文案与原生侧栏正常；未读标签在截图采样时未稳定出现，不将截图外推为未读行视觉证明。
- [x] 通过原生Mark as unread尝试对已完成本项目聊天取样，随后官方list_threads对账中间按钮任务与设置清理任务isUnread均false，未遗留测试标记；没有编辑或发送输入，也未操作X Chat草稿。

证据：~/Library/Logs/codex-plus/unread-priority-20261114/，含tests.log、build.log、install.log、before-reconnect.json、reconnected.json、final-status.json、after-order.json；源码PR12。安装与GUI已交还迁移owner，后续编号/工具窗口功能仍由其各自负责人办理。


## 0.9.0 build 28 工具窗口迁移（2026-11-14）

工具窗口管理从 Dock Switch 迁入 Codex Plus；原案转为 Codex Plus #10。正式 `/Applications/Codex Plus.app` 0.9.0 build28，Plus PID62464、宿主64999保持，包含已验收的protocol8排序。Dock Switch正式1.1.1，清扫PR65已合并。

- [x] 移入精确文件/窗口认领与右屏归集，复用Plus显示器目录。Dock Switch的旧源码、菜单、策略、测试及工具CLI移除；直接向旧control.sock请求tool-status返回Unsupported command。两项偏好仅在Plus未设置时迁入，随后清除旧域对应键；其他设置和安装备份保留。
- [x] 迁移64项Node/51项Swift通过，Dock最终105项Node/56项Swift通过。独立定向审查确认原始PID溢出、可用工作区缺失、暂停后迟到请求、已消费文件认领及socket关闭生命周期修补完成。
- [x] 安装交互发现并修复非阻塞listener的accepted socket继承问题，以及冷启动AX不能立即完成的问题。真实安装版延迟分片请求及连续100次tool-status通过；冷CLI在Plus未运行时失败且未启动应用。AX只为同一明确资源短暂重试，暂停/stop使原请求失效，不重放open。
- [x] 官方OCU在新独立X Chat的空Message输入框放入未发送临时标记。连续激活通知和前台采样覆盖冷TextEdit文件A、暖文件B及Plus自身设置打开；全程无激活事件，前后台快照均为同一X Chat PID49764的AXTextArea、17字符标记及同一鼠标位置。文件A/B均实际placed，观察错误为空。
- [x] 公开窗口几何确认主Codex窗口13524仍在中间DELL屏；A/B为右屏Mi Monitor (2)内的656×422，Plus设置为右屏内560×548。另一既有Codex辅助窗口15317保留其原右屏位置，没有把用户既有窗口强行重排。
- [x] 再开已打开A返回opened-in-existing-window；暂停observer计数归零，恢复正常。原人工窗口/标签复用保护沿用未改变的原算法真实证据及策略测试，新AX重试的单调消费边界独立复核通过。
- [x] OCU清空临时标记且未发送消息，关闭A/B与本轮Plus设置，TextEdit恢复原先未运行状态。Plus保持正常运行、既有自动发送true和页面增强接入保留。新X Chat的独立bundle已加入保护名单，产品入口实测拒绝认领。

证据：`~/Library/Logs/codex-plus/tool-window-migration-20261114/`，含interaction28.json、focus28.jsonl、geometry28-*.json、regression28.json、socket28-acceptance.json、textedit28-ocu.png/txt、cold-cli.json、installed-identity*.json、测试/构建/安装日志。原人工窗口验收保留于`~/Library/Logs/dock-switch/quiet-tools-20261114/`。物理热插拔和实体F6未在本轮重复验证。
