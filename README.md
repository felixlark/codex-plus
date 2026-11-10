# Codex Plus

Codex Plus 是独立的 macOS 菜单栏应用，为 Codex 提供工作区自动展开。

当前版本支持在 Codex 视图新建任务或切换任务时，展开已收起的右侧栏。ChatGPT 视图保持收起。已展开的工作区保留现有标签页，当前任务手动收起后保持收起。

0.2.0 增加“适用屏幕”：默认所有屏幕，也可勾选实际连接的多块屏幕。选择自动保存，下一次新建或切换任务时生效；移动当前窗口时保留工作区状态。屏幕断开后保留已选条目，相同身份重连后恢复适用。所选屏幕为空时暂停自动展开。

需要 macOS 13 或更新版本，以及用户为 Codex Plus 单独授予的辅助功能权限。当前适配已在 Codex 26.1103.60933 的英文界面上核验。界面结构变化、未知模式或读取失败时跳过动作。

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

核心逻辑源自 [dock-switch #49](https://github.com/felixlark/dock-switch/issues/49) 和 [PR #50](https://github.com/felixlark/dock-switch/pull/50)，保留 MIT 许可。Codex Plus 独立维护源码、配置、权限、启动与运行状态。Codex 提供原生的同等自动展开设置后，可停用此适配器。

Codex Plus 是独立工具项目。
