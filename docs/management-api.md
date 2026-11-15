# SmartShadow 管理接缝 v1

#613 管理 App 只持设置和组件控制客户端。#578 interactiond 保持原 Plus native、controller、移动网关、增强与窗口生命周期。退出管理 App 只取消自己的 IPC，不能调用 launcher.stop/observer.stop/toolWindows.stop，也不能删除虚拟屏。

复用原 0600 tool-control.sock 和现有 ToolControlServer。一连接一个 JSON 行；原 tool-* 与只读 status.sock 保持原合同。新增 Core 类型不自动装入 handler，不代表新接口已经运行。

## 运行侧接入

仅 command=management-v1 进入 ManagementProtocol.Request.parse。实例启动时生成一次真实 UUID；每次响应用 RuntimeIdentity 写准确 native PID、bundle、全局路径、版本/build，未知 controller/mobile 协议或版本为 null。用 response factory 返回 protocol/request_id/runtime/capabilities/result 或 error；capabilities 只列实际支持项。

build68候选补充实际组件身份：controller启动时读取自身文件计算SHA-256；移动接缝在核验网关签名后，计算实际mobile-access源码与网关二进制的组合SHA-256。管理响应只在当前controller PID与其快照匹配时读取这些版本，尚未启动的移动网关版本仍为null。这里的移动版本指Mac移动适配器和网关，不冒充iOS安装版本。安装采用另验。

- status 返回无正文、凭据和环境的运行元数据。query_request_id 必须带当前已核验实例的expected_runtime；查询 workbench request_id/origin_runtime/nonce/target/window/phase。跨实例只读恢复核原origin_runtime和真实终态，无关联记录保留unknown。
- settings.read 的 result 为 settings、settings_revision。Settings 仅含原五个设置，revision 由实际规范化设置对象计算 SHA256。
- settings.write 先校验 expected_runtime 与 expected_settings_revision，再用 Settings.applying 校验完整差量，沿原 SettingsModel/偏好与回调写入，最后实际读回 settings/revision。冲突返回 conflict 与当前快照；实例变更不写。原验收模式等运行侧限制继续适用，不能把请求值冒充实际读回。
- workspace.open 只调用新 launcher.openWorkbench(requestID)，发送一次 controller workbench-open。禁止复用人工 F6 的 launcher.open/place/humanWindows.open，不碰 mobile anchor 或人工窗。同步 handler 仅返回 requested/accepted 与 request_id；原 controller 将同 ID 贯穿 nonce/target/window/phase，status 再读真实状态。pipe write 不代表窗口 ready。

build72候选接入此入口：同一运行内每个request_id关联同一准确工作台；重复ID不重发，新的显式ID可复用同窗。已经登记/可能发出后只报accepted或unknown，不以workspace_unavailable清除请求。原controller state.json原子保存nonce/target/CG及origin_runtime；创建IPC前保存nonce，布局前先identify CG并持久化dispatched，再发一次place，重启只读inspect。关闭target须native再核CG消失，无法确定保留unknown，原宿主退出才可结算未捕获target的旧创建。管理端实例改变后先读新身份，再以新expected_runtime查询原ID，只有origin_runtime与原请求一致的真实终态才能清pending。详见[工作台设计](designs/interaction-workbench.md)。

Plus菜单/页面的用户设置入口改打开准确签名的全局SmartShadow管理App。仍被正式tool-open消费的Agent设置窗与SettingsModel内部偏好回调暂保留，随#613准确消费者迁接后退役，不冒称全部设置代码已零消费者。

权限状态带准确主体 bundle/path/pid；原 native 检查 Plus AX。按钮由该主体处理或打开系统设置中 Plus 条目，Manager 不请求自身 AX 冒充 interactiond 权限。

## 客户端与验收

ManagementConnection 是客户端，校验 socket/父目录本 UID 与权限、peer UID；取消只 shutdown 本连接，由原 worker 唯一 close fd，避免 fd 复用误关。没有 launch/reopen/retry fallback。写响应丢失只读实际设置；工作台响应丢失只读同query_request_id，并核当前实例和原origin_runtime，不换键补发。Manager 还必须核响应 PID 对应 NSRunningApplication 的准确 bundle/path，不能只凭自报身份认领运行体。

当前单元覆盖严格类型、未知字段、运行实例和 revision 必填、原屏幕选择合同、规范化摘要、未知后端版本、连接前取消。实际 handler、安装版 IPC、I/O 中途取消、设置冲突、F6 并发丢回执和退出 Manager 后原运行体持续运行，仍须真实接入后另验。

## 管理产品的独立构建与安装

Package 的 SmartShadowManager 是独立 executable/target，ManagerInfo.plist 保留 me.longbiaochen.smart-shadow.app，版本4.0.0/build4001。仅加载 Core 数据与客户端，不创建旧 native delegate/launcher/controller/observer/ToolWindowRouter。首次启动附着准确 Plus 实例，不存在时只打开已核签名全局路径一次，启动回执后再读实际状态。

管理侧通过正式安装 ss-service 的只读 inspect 分别显示 contextd/taskd job、配置、选择、报告及源码版本；任何未支持/不明确结果如实显示，不合并为业务已采用或 ready。新角色启停仍待准确既有 lifecycle operation 接口采用，不能在 App 内另建发布计划或调度器。

管理UI当前消费 status.result.permissions.accessibility 的 trusted/bundle_id/path/pid，以及 workspace_request 的 request_id/phase/nonce/target/window；无 query 返回原 native 最近一次管理工作台请求，人工F6不能覆盖该关联，重开 manager 先拾起 pending/unknown。设置 result 固定 settings/settings_revision。

scripts/build-manager 仅 release 构建管理产品并沿已有 Developer ID 签名，不构建手机或 Plus controller。scripts/install-manager 接受准确签名候选，原安装存在时保留到 Library/Caches/codex-plus/manager-installs；实际安装前须交清旧客户端，不按进程名杀、退出 Plus 或解除虚拟屏托管。唯一 Release build 和安装/GUI writer 沿原安全点。当前只有 Debug 编译准备，尚未签名新管理包、安装或进行真实三模块控制/退出隔离验收。
