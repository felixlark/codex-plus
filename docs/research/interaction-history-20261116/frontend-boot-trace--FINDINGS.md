# 原 Codex 前端启动静态追踪

目标只读 `/Applications/ChatGPT.app/Contents/Resources/app.asar`。未执行包内代码、连接 CDP、操作 GUI 或业务写。提取复用 repo `scripts/inspect-sidebar-model.mjs` 的 `openAsar`；只选 index、五入口及其明确启动依赖中的相关文件。源码身份见 manifest.json、startup-chunks.json、app-startup-selected.json；准确片段位置（Unicode 与 UTF-8 字节偏移）见 anchors.json。不存在完整 ASAR 分析或运行验收结论。

复用 REA preload 证据：`mobile-port-study-20261114/rea-preloads.json` 中完整静态分析 `ev_c0c6ebe4b3ea454750359d237dc0c918594179bdd3f6f977c92f8650c063d792`，摘要 `ev_a602af40b1978c7903a31e9e2379814b6d6a412cdf9bd0f8c2da72def8ca131b`。其 graph coverage 为 partial；动态 IPC 配对与运行可达性未知。preload.js SHA256 `1ab4e9d411aac47d5c38daf91077563001596bf392bd38e24f01f8f7e7860527`。

## 启动链

- index.html 的五入口以 `/assets/<file>.js` 加载。903838 为 Zod locale；203305 为代码生成 helper；727403 为 React；936243 为 Zod；348410 为 Rspack runtime+入口。
- 348410 的 R2r9 首先装 AbortSignal 与 disposable 等兼容库、消息总线 TL6G，然后装 GaA7（全局 appHost/appServices 存储）及初始 React 支持块。
- 31059 的 r0vO 建立 React root，再按 window route 分支装载真正 initializeApp（LxTx，757723 包）。普通主窗并非 dictation route。
- initializeApp 的 ym 在 render 前 `await wRZ2.Y()`。wRZ2.Y 创建 app-host 双向 RPC，`setAppHost(connect(X))`，`setAppServices(await appHost.services)`，初始化 remoteConnections，调用 executionHosts?.getDefaultHost()，可选初始化 threadReadState、statsig、clientCoordination、terminal，然后返回。之后启动数据预取/根页面。列表和聊天能力依赖原 services，不能用空对象占位。
- 前端暴露给宿主的根对象 X 包含 services callbacks（browserAnnotation、appActions、appUpdates、clientCoordination、downloads、dotBrowser、notificationAudio、windowCloseConfirmation、managedWorktrees、dynamicAppTools）、threadReadState 和 ping。应保留原 RPC 的回调与 release 生命周期。

## connect-app-host 的精确传输合同

- ay3C（98815）创建 `new MessageChannel`；`window.postMessage({type:'connect-app-host',port:port2}, location.origin,[port2])`；port1 交给 ZG9f.ab(port1,X,undefined)。
- preload 接收到同 window 的此事件后，`ipcRenderer.postMessage('codex_desktop:connect-app-host', undefined,[port])`，是 MessagePort 转交；不是字符串调用。
- ZG9f（648541）Q transport 明确 `encodingLevel='structuredClonable'`；发 `port.postMessage(frame)`，不含 transfer list；收 `event.data` 原值；null 表示 peer closed。
- 上层 frame 为数组协议：push、stream、pipe、pull、resolve、reject、release、abort；方法调用 pipeline 含导入对象编号、属性路径、参数。对象/函数/RPC promise/stream 经自定义导入导出编号编码；禁止把 services 展平成普通 JSON 对象。
- structuredClonable 模式保留原生 bigint、Date、undefined、非有限 number；bytes 为 `['bytes',Uint8Array,optionalTypeName]`。Blob 转为 type+arrayBuffer RPC promise，ReadableStream/WritableStream 转 RPC pipe/stub。普通 JSON.stringify/parse 中继会损坏这些值。MessagePort transport 本身没有每帧转交 MessagePort、VideoFrame、transfer array 的证据。
- 可选实现路径：保留前端原 ZG9f、MessageChannel，把 port2 接入透明传输；远端还原结构化 frame 后发给真实 Electron app-host port。中继自身须对 undefined、Date、bigint、nonfinite number、Uint8Array 等进行无损编码；保持顺序、关闭与双向 callback。

## electronBridge 最小兼容表

这是 preload 的兼容面，并非全部同步 getter 都是硬启动门。

- 同步/值接口：window.codexWindowType='electron'；electronBridge.windowType='electron'；usesStagingWidgetSandbox；getPreloadStartedAtMs；getSystemThemeVariant；getSentryInitOptions；getBuildFlavor；getDesktopUserAgent；getAppSessionId；getInitialSidebarBootstrap；isDeviceCheckSupported；isIntelMacBuild。应在 documentStart 注入，需 Mac 启动值的内容先通过外层连接取得再导航。iOS 设备属性不冒充 Mac 硬件能力。
- theme：subscribeToSystemThemeVariant(cb) 返回取消订阅函数；主题变化缓存 getter 同步可读。getter 缺失有 matchMedia fallback。
- 普通消息：sendMessageFromView(object)->Promise<void> 对应 message-from-view invoke；消息总线 SITX 同时 dispatch CustomEvent('codex-message-from-view',{detail:object})，已有 bridge 时带 forwarded marker，避免重复转发。
- 宿主消息：原 preload `window.dispatchEvent(new MessageEvent('message',{data:message}))`；保留原 structured object，而非字符串。TL6G 使用 message.type 分派。三种消息可缓冲：mcp-request-delivery、mcp-response、personal-workspace-access-blocked。
- 分块：acknowledgeChunkedMessage(transferId,sequence) 对应 chunked-message-ack。348410 会恢复 marker=codex-host-chunked-message-v1 的 start/chunk/end token 流，然后业务分派，按每段 ack；若 Mac 已负责完整组装，需明确桥的边界，不能双方重复组装。
- 原生后台 worker：subscribeToWorkerMessages(workerId,cb)、sendWorkerMessageFromView(workerId,object)->Promise、connectGitWorker(requestId)->Promise。git 特殊：返回 window message `codex_desktop:git-worker-port`、requestId/closed，并带 MessagePort；此口同样使用 ZG9f。它们是 Mac 后台工具 worker，不能误替换成手机浏览器 Worker。
- 非核心增强：showContextMenu、getPathForFile、startFileDrag、startLinkDrag、getFastModeRolloutMetrics、triggerSentryTestError。触控列表/聊天首次可不暴露可选的桌面 drag/file/contextmenu 能力，以原前端 fallback 为准，不返回虚假成功。
- 独立高级通路：mcp-app-sandbox-host-message 可转交 ports；remote-hosted-pip-video-frame 使用 VideoDecoder/EncodedVideoChunk/VideoFrame transfer；codex-shared-texture-create 转交 port。它们不应和基础 app-host 口合并；本次未证明基础聊天会调用。

getInitialSidebarBootstrap 仅作为 query cache 的初始数据，源码为 `bridge?.getInitialSidebarBootstrap?.() ?? null`；缺失不直接 throw。原完整快照结构与是否会影响首屏速度仍须由原 Mac getter 读取或运行观察确认。

## app://-/ 与 WKURLSchemeHandler

- UI 资源可原样以 `app://-/index.html?initialRoute=/` 加载。注册公开 WKURLSchemeHandler for 'app'，把 URL path 映射到已导出的 webview 目录，按原 MIME 返回文件（HTML、JS module、CSS、font、wasm、binary）。绝对 /assets 路径、动态 import('../'+p.u(id)) 与 p.b=new URL('../',import.meta.url) 因此保持原目录结构；无需重写 React UI。
- initialRoute 来自 meta[name=initial-route] 或 URL query。原前端自身路由逻辑可继续使用；不要将文件目录路径当成业务 route。
- Apple 公共文档只证明自定义 scheme 资源 handler 能力，不证明会复制 Electron 将 app 注册为标准/安全 origin 的行为。WK 下 location.origin 是否为非 null、window.postMessage(target=location.origin) 是否可用、history/storage/crypto 是否可用，仍是必须实际 probe 的阻点。
- 若 location.origin='null'，原 ay3C 的 targetOrigin 不能直接照搬；可以在 documentStart 的宿主桥里捕获自身 connect-app-host 消息并接通端口，但这属于桥接兼容而非 UI 重写。不得用私有 WebKit scheme 注册 API 冒充公开能力。原型主执行者需以实际 simulator probe 决定。
- index CSP 为 default-src none；script-src self（含特定 inline hash，无 unsafe-eval）；worker-src self blob；connect-src 只许原 API 域名，没有任意 Tailscale ws/http。经原生 URLSession/Tailscale + WK message handler 的桥不会依赖网页放宽 connect-src；若直接网页 WebSocket 到 Mac，须准确修改 CSP 且登记偏移，不能假定原样可连。
- 官方来源：https://developer.apple.com/documentation/webkit/wkurlschemehandler ; https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/seturlschemehandler(_:forurlscheme:)

## Worker 与 WebKit 待核 API

- 真正 browser Worker 使用存在：257719 的 700732 module worker（失败有主线程 fallback）、238393 的 266731 regex worker（失败返回 regex-unavailable）；405559 的 113397 pages bootstrap worker；516427 的 494938 shader warmup worker；658267 Blob worker（压缩库）；673156 Blob Worker（监控压缩）。不是 SharedWorker 业务依赖；所见 SharedWorker 唯一命中为 Sentry API 名称表。
- module Worker 的 new URL(...,import.meta.url)、Blob URL、CSP 同源及 custom scheme Worker loading 必须在 simulator 验证。未证明所有 worker 在会话列表/基础聊天都运行。
- 启动兼容库已 polyfill AbortSignal.any、AbortSignal.timeout、Symbol.dispose、Symbol.asyncDispose、Promise.withResolvers（ZG9f 也补后3项）；不要盲目重复实现。
- 至少 probe：ES module dynamic import from app scheme、MessageChannel+ports、structuredClone 与 typed arrays、Readable/Writable/TransformStream、URL/Headers/Request/Response/Blob、crypto.randomUUID、local/sessionStorage、history.replaceState、matchMedia、Resize/MutationObserver。VideoDecoder/EncodedVideoChunk/VideoFrame/共享纹理属于独立增强路径，不能将缺失这些能力误报为基础聊天必然不可运行。

本次没有运行 WKWebView 或原 Codex renderer；“可运行”仍需主执行者原型真实证据。没有核实的 WebKit API 缺失均保留 unknown。
