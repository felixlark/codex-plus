# Codex 原前端移动原型

交付原案：[SmartShadow #578](https://github.com/felixlark/smart-shadow/issues/578)。

本模块把当前安装版的原网页资源装进 iOS App，在 WKWebView 本地运行。
Mac 的 Codex Plus 沿原 preload 和 MessagePort 连接现役 Electron 后台与既有会话。
不创建另一执行器，不重做聊天界面。当前资源适配准确绑定 26.1111.21308。
资源、构建和实际交互的证据见 [安装版验收](../docs/acceptance.md#codex-原前端移动原型2026-11-15)。

## 接入边界

- 原厂网页资源只提取到个人 Library/Caches，按 ASAR 声明摘要逐文件校验，不入 Git。
- iOS 在原页面启动前注入兼容 preload；同步 getter 来自已取得的原宿主快照。触摸输入控件保留至少16px字号以避免聚焦缩放；横屏键盘占用后的短视口在编辑期间收起原标题栏并将原输入父框与编辑区收为一行，保留父框滚动，保留用户缩放和原输入事件；原错误边界仅追加静态代码位置诊断，不记录异常正文或页面内容。
- 原 app-host RPC 的结构化帧由有类型的 carrier 搬运，保持端口、回调、二进制、关闭和顺序。
- 独立原生宿主窗口作为手机锚点；不能在人工窗口第二次注册 AppView。
- 创建前先读取原宿主 `startup.whenReady()` 的真实就绪状态；等待沿既有 controller tick，不把单向 IPC 返回当作窗口创建回执。
- 创建路由包含配置 nonce 和本 controller 新生成的 instance；捕获后固定原生 target ID，不认领旧实例遗留页面。同一原生窗口导航 `about:blank` 以释放原界面，再核实新 loader、原 preload、无 script、CSP 和双标记。现役 Electron 的应用主文档不触发 Fetch Request/Response 暂停，原应用来源方案已在安装版失败关闭，不作为能力保留。
- 在该准确主框架的既有 preload isolated context 中，仅修正原 Git 端口消息的无效 `targetOrigin='null'`：原 open（一个真实端口）与 closed（零端口）消息自投本空白窗口，其余调用保真。主 world 的 postMessage 和厂商文件不改；按来源、原 requestId 和当前 connection 转发。上下文失效关闭本 target；真实端口、会话读发与流式仍须安装版证明。
- Plus 既有 controller 是唯一 CDP owner，移动接入模块不另起 App Server、不公开 CDP。
- 原生 WSS gateway 是该 controller 的子进程，只处理传输。专用 TLS 私钥留 Keychain；模拟器固定证书摘要，Tailscale 身份绑定指定 node/user。
- 本机 Network.framework 直接接收 utun TCP 的隔离对照失败；gateway 内用固定 BSD 入口承载原始 TLS 字节，再接同进程的 loopback TLS 层，按独占四元组、一次领取和连接代际保持原 peer。它不提供通用代理，也不终止第二次 TLS。iOS 用 Network 的连接级固定证书校验，保留证书有效期、签名、serverAuth 和准确 IP SAN 校验，不改变系统信任库或全局 ATS。
- 监听仅绑定指定 Tailscale IPv4，不启 IPv6、代理、Serve 或 Funnel。模拟器沿 Mac 网络栈访问私网地址，不能作为另一台物理节点或公网漫游证据。
- 断线不重发操作；原端口失效后关闭连接，重新启动页面前重新取快照。发送回执未知需读同一原会话对账。
- 手机草稿、项目选择和页面偏好独立存入本 App 的 Application Support，原持久化协议收到原子写入回执后才发布更新，不读取或覆盖 Mac 草稿/窗口布局。允许的键随准确原前端登记；未知键明确报告页面状态失败，附件引用使用独立回执。
- 账户摘要沿原后台 `accountInfo.readAccountInfo()` 读取；`accessInputs.readLocalChatGptAuth()` 不开放给手机，Mac 访问令牌不随摘要转发。
- 原设置初始化所需的 `readAll` 和 `subscribe` 只读转发；手机原渲染器的 `renderer_ready` 在本地确认，不写入 Mac 窗口启动阶段或伪造宿主计时。
- 权限默认值就绪沿原 `statsigEvaluations.subscribe()` 的真实 publication 三态与可释放订阅确定，发送链只读查询 `hasReadyExecutionAssignments()`；不以空对象替代快照、不开放评估写入。缺少该订阅会使原界面停在配置延迟队列，Mac 投递函数返回不能证明消息已提交。
- 原 Codex 项目展开偏好保留普通项目 ID 与原 `executor-folder:[environmentId,path]` 身份缩减格式，不补入原实现已去掉的账户字段。
- 原模型缓存只允许 `chatgpt-work-models-v1/` 后两个非空编码身份段；输入历史、会话活动时间与摘要按准确静态键登记，均留手机私有原子文件。身份段和缓存值不进诊断日志。
- 原会话页的输入自动解决服务以可传值对象提供真实 `snooze`，不声明两个平台可选的 Mac surface/focus 方法。手机展示与输入不冒充 Mac 专用窗口焦点；Mac 原自动解决时序保留，手机活动抑制定时器尚未接入。
- 原 query warm seed 只登记仓库 metadata 的身份/仓库 JSON 三元组和两类 Space metadata 的身份双段；沿原投影移除 `checkpoint`，不开放通用 query key。最近个人文件只存原列表元数据，不下载正文。原 `heartbeat-thread-permissions-by-id` 保存真实权限投影，参与恢复 fallback，保留原真实权限优先与服务端默认分支，不生成新授权或提升权限。
- 原网页请求使用现役 `httpFetch`，身份注入仍留 Mac；返回体在手机本地会话逐块建立流归属，消费或取消后释放原租约，只取消本手机仍持有的请求。
- iOS 资源适配移除原前端的旧 `hatch-pet` 桌面迁移触发钩子，避免手机初始化重复写 Mac 技能配置；Mac 原厂资源不变。手机缓存可包含身份 ID、页面预览和 profile 业务数据，不把这些缓存当作账号访问令牌。

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

已完成首批验收覆盖原会话读取、单次发送、文本流式、Mac 同会话对账和断线不重发。后续完整功能增量仍需以对应安装版逐项验收，首批证据不代表新候选全覆盖。
原前端的其他宿主功能与物理 iPhone 跨节点访问尚未验收；更换原 Codex 版本时须重新核对准确版本和资源摘要。
