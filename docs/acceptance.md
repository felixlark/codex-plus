# Codex Plus 验收

跟踪事项为 [Issue #1](https://github.com/felixlark/codex-plus/issues/1)。

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
