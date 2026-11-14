# Codex 原前端移动原型

交付原案：[SmartShadow #578](https://github.com/felixlark/smart-shadow/issues/578)。

本模块把当前安装版的原网页资源装进 iOS App，在 WKWebView 本地运行。
Mac 的 Codex Plus 沿原 preload 和 MessagePort 连接现役 Electron 后台与既有会话。
不创建另一执行器，不重做聊天界面。当前资源适配准确绑定 26.1111.21308。
资源、构建、运行证据各自登记；此文件不表示已经接通或验收通过。

## 接入边界

- 原厂网页资源只提取到个人 Library/Caches，按 ASAR 声明摘要逐文件校验，不入 Git。
- iOS 在原页面启动前注入兼容 preload；同步 getter 来自已取得的原宿主快照。
- 原 app-host RPC 的结构化帧由有类型的 carrier 搬运，保持端口、回调、二进制、关闭和顺序。
- 独立原生宿主窗口作为手机锚点；不能在人工窗口第二次注册 AppView。
- Plus 既有 controller 是唯一 CDP owner，移动接入模块不另起 App Server、不公开 CDP。
- 原生 WSS gateway 是该 controller 的子进程，只处理传输。专用 TLS 私钥留 Keychain；模拟器固定证书摘要，Tailscale 身份绑定指定 node/user。
- 监听仅绑定指定 Tailscale IPv4，不启 IPv6、代理、Serve 或 Funnel。模拟器沿 Mac 网络栈访问私网地址，不能作为另一台物理节点或公网漫游证据。
- 断线不重发操作；原端口失效后关闭连接，重新启动页面前重新取快照。发送回执未知需读同一原会话对账。

## 当前可执行增量

```sh
node scripts/prepare-mobile-frontend.mjs
node --test Tests/mobile-codec.test.mjs Tests/mobile-frontend.test.mjs
bash scripts/build-mobile-gateway
```

本模块源码归 Codex Plus；产品模块与最终验收记录回写 #578。
