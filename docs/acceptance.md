# Codex Plus 验收

跟踪事项为 [Issue #1](https://github.com/felixlark/codex-plus/issues/1)。

- [x] 独立安装版能启动，菜单栏可打开设置、关闭窗口和退出。
- [x] Codex Plus 的辅助功能权限已授权，状态显示正在观察 Codex。
- [ ] Codex 视图按 ⌘N 后自动展开右侧工作区。
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
