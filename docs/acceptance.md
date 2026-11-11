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
