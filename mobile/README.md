# Codex 原前端移动原型

交付原案：[SmartShadow #578](https://github.com/felixlark/smart-shadow/issues/578)。

本模块把当前安装版的原网页资源装进 iOS App，在 WKWebView 本地运行。
Mac 的 Codex Plus 沿原 preload 和 MessagePort 连接现役 Electron 后台与既有会话。
不创建另一执行器，不重做聊天界面。当前资源适配准确绑定 26.1111.21308。
资源、构建和实际交互的证据见 [安装版验收](../docs/acceptance.md#codex-原前端移动原型2026-11-15)。

## 接入边界

- 原厂网页资源只提取到个人 Library/Caches，按 ASAR 声明摘要逐文件校验，不入 Git。
- iOS 在原页面启动前注入兼容 preload；同步 getter 来自已取得的原宿主快照。
- 原 app-host RPC 的结构化帧由有类型的 carrier 搬运，保持端口、回调、二进制、关闭和顺序。
- 独立原生宿主窗口作为手机锚点；不能在人工窗口第二次注册 AppView。
- 创建前先读取原宿主 `startup.whenReady()` 的真实就绪状态；等待沿既有 controller tick，不把单向 IPC 返回当作窗口创建回执。
- 从原 nonce 路由捕获后固定该原生 target ID，仅导航同一个已登记窗口到原后台明确接受的准确 `about:blank`。等待新主帧 context，并在同次检查中确认原 preload、加载完成、无 script 后追加隔离标记和 CSP；失去原 ID 就关闭接入，不认领其他空白窗口。本地端口交接仅在该 host 空白页 origin 为 `null` 时向同一个 window 使用 `*`，仍由原 preload 校验 `event.source === window`。空白页的 preload 和原会话读、发、流须由安装版另行证明，不推定全部 host services 可用。
- Plus 既有 controller 是唯一 CDP owner，移动接入模块不另起 App Server、不公开 CDP。
- 原生 WSS gateway 是该 controller 的子进程，只处理传输。专用 TLS 私钥留 Keychain；模拟器固定证书摘要，Tailscale 身份绑定指定 node/user。
- 本机 Network.framework 直接接收 utun TCP 的隔离对照失败；gateway 内用固定 BSD 入口承载原始 TLS 字节，再接同进程的 loopback TLS 层，按独占四元组、一次领取和连接代际保持原 peer。它不提供通用代理，也不终止第二次 TLS。iOS 用 Network 的连接级固定证书校验，保留证书有效期、签名、serverAuth 和准确 IP SAN 校验，不改变系统信任库或全局 ATS。
- 监听仅绑定指定 Tailscale IPv4，不启 IPv6、代理、Serve 或 Funnel。模拟器沿 Mac 网络栈访问私网地址，不能作为另一台物理节点或公网漫游证据。
- 断线不重发操作；原端口失效后关闭连接，重新启动页面前重新取快照。发送回执未知需读同一原会话对账。
- 手机草稿、项目选择和页面偏好独立存入本 App 的 Application Support，原持久化协议收到原子写入回执后才发布更新，不读取或覆盖 Mac 草稿/窗口布局。允许的键随准确原前端登记；未知键明确报告页面状态失败，附件引用使用独立回执。
- 账户摘要沿原后台 `accountInfo.readAccountInfo()` 读取；`accessInputs.readLocalChatGptAuth()` 不开放给手机，Mac 访问令牌不随摘要转发。
- 原设置初始化所需的 `readAll` 和 `subscribe` 只读转发；手机原渲染器的 `renderer_ready` 在本地确认，不写入 Mac 窗口启动阶段或伪造宿主计时。

## 当前可执行增量

```sh
node scripts/prepare-mobile-frontend.mjs
node --test Tests/mobile-codec.test.mjs Tests/mobile-frontend.test.mjs
bash scripts/build-mobile-gateway
bash scripts/build-mobile-simulator
```

本模块源码归 Codex Plus；产品模块与最终验收记录回写 #578。

启动原型前，在 Mac 配置已有验收会话，下一次 Plus 启动才创建专用原生窗口：

```sh
node scripts/configure-mobile.mjs --thread <existing-thread-uuid>
```

窗口创建可能短暂置前；本次已获许可，创建后由 OCU 按准确窗口身份停放到 Agent 隐藏屏并最小化。
网关启动后写入本机 `connection.json`，再构建、安装模拟器 App；每次网关端口变化都需重新打包此连接配置。
断线时保留未知结果并到原会话核对；使用壳内“重新连接”会撤销旧连接代际并恢复手机原路由，不重放业务操作。普通切后台／回前台不会刷新已断开的页面。
结束一次原型运行后可关闭下一次自动创建，当前已建立的会话在本次 Plus 进程退出前继续有效：

```sh
node scripts/configure-mobile.mjs --disable
```

当前验收只覆盖原会话读取、单次发送、文本流式、Mac 同会话对账和断线不重发。
原前端的其他宿主功能与物理 iPhone 跨节点访问尚未验收；更换原 Codex 版本时须重新核对准确版本和资源摘要。
