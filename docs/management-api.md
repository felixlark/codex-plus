# SmartShadow 管理接缝 v1

#613 管理 App 只持设置和组件控制客户端。#578 interactiond 保持原 Plus native、controller、移动网关、增强与窗口生命周期。退出管理 App 只取消自己的 IPC，不能调用 launcher.stop/observer.stop/toolWindows.stop，也不能删除虚拟屏。

复用原 0600 tool-control.sock 和现有 ToolControlServer。一连接一个 JSON 行；原 tool-* 与只读 status.sock 保持原合同。新增 Core 类型不自动装入 handler，不代表新接口已经运行。

## 运行侧接入

仅 command=management-v1 进入 ManagementProtocol.Request.parse。实例启动时生成一次真实 UUID；每次响应用 RuntimeIdentity 写准确 native PID、bundle、全局路径、版本/build，未知 controller/mobile 协议或版本为 null。用 response factory 返回 protocol/request_id/runtime/capabilities/result 或 error；capabilities 只列实际支持项。

- status 返回无正文、凭据和环境的运行元数据。query_request_id 必须带 expected_runtime；查询同运行实例对应 workbench request_id/nonce/target/window/phase。无关联记录或实例变更保留 unknown。
- settings.read 的 result 为 settings、settings_revision。Settings 仅含原五个设置，revision 由实际规范化设置对象计算 SHA256。
- settings.write 先校验 expected_runtime 与 expected_settings_revision，再用 Settings.applying 校验完整差量，沿原 SettingsModel/偏好与回调写入，最后实际读回 settings/revision。冲突返回 conflict 与当前快照；实例变更不写。原验收模式等运行侧限制继续适用，不能把请求值冒充实际读回。
- workspace.open 只调用新 launcher.openWorkbench(requestID)，发送一次 controller workbench-open。禁止复用人工 F6 的 launcher.open/place/humanWindows.open，不碰 mobile anchor 或人工窗。同步 handler 仅返回 requested/accepted 与 request_id；原 controller 将同 ID 贯穿 nonce/target/window/phase，status 再读真实状态。pipe write 不代表窗口 ready。

权限状态带准确主体 bundle/path/pid；原 native 检查 Plus AX。按钮由该主体处理或打开系统设置中 Plus 条目，Manager 不请求自身 AX 冒充 interactiond 权限。

## 客户端与验收

ManagementConnection 是客户端，校验 socket/父目录本 UID 与权限、peer UID；取消只 shutdown 本连接，由原 worker 唯一 close fd，避免 fd 复用误关。没有 launch/reopen/retry fallback。写响应丢失只读实际设置；工作台响应丢失只读同实例、同 query_request_id 的状态，不换键补发。Manager 还必须核响应 PID 对应 NSRunningApplication 的准确 bundle/path，不能只凭自报身份认领运行体。

当前单元覆盖严格类型、未知字段、运行实例和 revision 必填、原屏幕选择合同、规范化摘要、未知后端版本、连接前取消。实际 handler、安装版 IPC、I/O 中途取消、设置冲突、F6 并发丢回执和退出 Manager 后原运行体持续运行，仍须真实接入后另验。
