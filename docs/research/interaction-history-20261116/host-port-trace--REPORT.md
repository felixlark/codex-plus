# Host / MessagePort 静态处理端合同

目标：`/Applications/ChatGPT.app` build 26.1111.21308；提取自 `.vite/build/`。本次未执行目标代码、未连 CDP、未操作 UI、未写仓库/业务。源哈希、UTF8 字节/Unicode 偏移、选定源片段见 `evidence.json`。原 preload REA 正本复用 `mobile-port-study-20261114/rea-preloads.json`，未重复全 ASAR REA。

## 结论

1. 原 `window.electronBridge.sendMessageFromView({type:"open-in-new-window",path:"/local/<existing-thread-id>"})` 通过 `ePk`，调用 `createFreshWindow` → `createPrimaryWindow` → 官方 `BrowserWindow`。创建路径携带官方 preload、登记 `registeredWebContentsIds`、关联 host，再加载原 renderer。该处理端本身没有 `thread/create` / `thread/start`。`/local` 是 route helper 明确接受前缀。
2. 该入口不暴露 `show:false`，由进程 `CODEX_ELECTRON_START_IN_BACKGROUND === "1"` 选择 `showInactive()`，否则 `show()/focus()`。本次未读取运行进程环境，不能断言现役值。
3. 在已选主 chunk 的 `createPrimaryWindow`、`createAppView`、`createFreshWindow` 全部调用链，未找到供 renderer 创建独立隐藏主窗口的通用 API。`windowNavigation.navigateInOwnerWindow` 最后抢焦点；`pageWindows.openNewPage` 创建新 Page 后抢焦点；top-level tabs 本 build 配置 `topLevelTabsEnabled:!1`。dictation/avatar/hotkey 的隐藏 prewarm 是别的专用共享生命周期，不能当独占手机锚点。`window.open('about:blank')` 特例为 presentation audience（明确 `preload:""`）与 browser comment popup，均不能证明通用后台锚点。
4. `codex_desktop:connect-app-host` 验证 sender，然后按 sender 创建 `createAppHost`，用 `29232.L(port, localRoot)` 建 RPC，再 `registerAppView(sender, remoteRoot)`。一个 sender 可发多个 port，但 `registerAppView` 对 `appViewsByWebContentsId` 是 `set(sender.id,root)`；第二条完整注册会替换该窗口的 view 服务，移除旧 client coordination handlers，并发布 app update/downloads 初始化。不能把它当同一窗口内无副作用的旁路。
5. 可以将未启动原前端的独立已登记 renderer 作为手机 MessagePort 的承载端；要由首载控制阻止本机原前端先注册，并保持这个 renderer 的 native preload。如何在运行现场既不抢焦点又建立该登记 renderer 仍 unknown，须真实验证。CDP `Target.createTarget` 的普通 Chromium target 不满足“已登记 sender”静态合同，不能仅凭 app URL 推断可用。
6. app-host/generic 两入口都由 `isTrustedIpcSender` 限制到未被 account cover 覆盖的已登记 webContents、其 mainFrame，以及 app/file/dev-origin/about:blank。已登记是独立必要条件。origin、账号和旧窗口生命周期不因转发而绕过。
7. Generic `sendMessageFromView` 的 Promise 只等待 Electron invoke 处理，不是业务请求结果。`mcp-request` 封套中的 `request.id/method/params` 送至现役 host connection；结果另外从 `codex_desktop:message-for-view` 回来，封套 `{type:"mcp-response",hostId,message:{id,result|error},...}`。Generic 与 MessagePort RPC 是不同承载，不能混淆。
8. Generic pending map 用 `String(request.id)` 作 host 范围 key，记录 sender `originWebContentsId`，没有为 webContents 自动增加 ID 命名空间。正常响应按 pending destination 精确发回源 renderer；源 renderer 已销毁时有 broadcast fallback。原前端生成 ID 应原样转发；自制附加请求必须避免与所有 renderer 重号。响应 unknown 时不得换 ID 重发。
9. `ehU` 在 destroyed、render-process-gone、主 frame navigation/did-navigate 关闭 port；因此锚点 reload 会打断手机 RPC，应按真实断线重连，不伪装现有端口仍活着。

## 证据局限

静态分析只确证合同和调用关系，未观察本轮运行态注册、未创建窗口、未建立实际 RPC，也未证明 iOS 能完整使用所有 host services。原生权限、页面源、文件路径/媒体、webview、MCP App 等服务需按实际消费者逐项验收。未扩成私有数据库或另一 app-server 方案。
