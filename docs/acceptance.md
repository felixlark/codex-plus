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
