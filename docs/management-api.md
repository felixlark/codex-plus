# SmartShadow 管理接缝 v1

#613 管理 App 只持设置和组件控制客户端。#578 interactiond 保持原 Plus native、controller、移动网关、增强与窗口生命周期。退出管理 App 只取消自己的 IPC，不能调用 launcher.stop/observer.stop/toolWindows.stop，也不能删除虚拟屏。

复用原 0600 tool-control.sock 和现有 ToolControlServer。一连接一个 JSON 行；原 tool-* 与只读 status.sock 保持原合同。新增 Core 类型不自动装入 handler，不代表新接口已经运行。

## 运行侧接入

仅 command=management-v1 进入 ManagementProtocol.Request.parse。实例启动时生成一次真实 UUID；每次响应用 RuntimeIdentity 写准确 native PID、bundle、全局路径、版本/build，未知 controller/mobile 协议或版本为 null。用 response factory 返回 protocol/request_id/runtime/capabilities/result 或 error；capabilities 只列实际支持项。

build68候选补充实际组件身份：controller启动时读取自身文件计算SHA-256；移动接缝在核验网关签名后，计算实际mobile-access源码与网关二进制的组合SHA-256。管理响应只在当前controller PID与其快照匹配时读取这些版本，尚未启动的移动网关版本仍为null。这里的移动版本指Mac移动适配器和网关，不冒充iOS安装版本。安装采用另验。

- status 返回无正文、凭据和环境的运行元数据。旧query_request_id仍校验expected_runtime，但精简后的运行侧不再拥有完整工作台请求，workspace_request为null；不能将null解释为旧操作未执行或已关闭。
- settings.read 的 result 为 settings、settings_revision。Settings 仅含原五个设置，revision 由实际规范化设置对象计算 SHA256。
- settings.write 先校验 expected_runtime 与 expected_settings_revision，再用 Settings.applying 校验完整差量，沿原 SettingsModel/偏好与回调写入，最后实际读回 settings/revision。冲突返回 conflict 与当前快照；实例变更不写。原验收模式等运行侧限制继续适用，不能把请求值冒充实际读回。
- workspace.open保留旧wire解析以明确返回unsupported，capabilities不再宣告该能力。管理App删除打开/核对按钮与请求恢复状态，只显示“小型任务看板尚未实现”。不创建完整Codex窗口，不把手机宿主作为看板，不以占位success冒充新产品能力。

完整工作台的controller建窗/注入/nonce定位/CG恢复和专用测试已在源码精简中删除。现役build74及其原state.json、窗口和unknown不由本次源码改动切换或清理；未来获准切换前须由原owner按冻结记录核对，不能直接把仍存在的旧工作台交给新人工窗口识别。小看板未开始实现。

Plus菜单/页面的用户设置入口改打开准确签名的全局SmartShadow管理App。仍被正式tool-open消费的Agent设置窗与SettingsModel内部偏好回调暂保留，随#613准确消费者迁接后退役，不冒称全部设置代码已零消费者。

权限状态带准确主体 bundle/path/pid；原 native 检查 Plus AX。按钮由该主体处理或打开系统设置中 Plus 条目，Manager 不请求自身 AX 冒充 interactiond 权限。

## 客户端与验收

ManagementConnection 是客户端，校验 socket/父目录本 UID 与权限、peer UID；取消只 shutdown 本连接，由原 worker 唯一 close fd，避免 fd 复用误关。没有 launch/reopen/retry fallback。写响应丢失只读实际设置；历史工作台unknown保留冻结运行记录，不换键补发。Manager 还必须核响应 PID 对应 NSRunningApplication 的准确 bundle/path，不能只凭自报身份认领运行体。

当前单元覆盖严格类型、未知字段、运行实例和 revision 必填、原屏幕选择合同、规范化摘要、未知后端版本、连接前取消。实际 handler、安装版 IPC、I/O 中途取消、设置冲突、F6 并发丢回执和退出 Manager 后原运行体持续运行，仍须真实接入后另验。

## 管理产品的独立构建与安装

Package 的 SmartShadowManager 是独立 executable/target，ManagerInfo.plist 保留 me.longbiaochen.smart-shadow.app，版本4.0.0/build4001。仅加载 Core 数据与客户端，不创建旧 native delegate/launcher/controller/observer/ToolWindowRouter。首次启动附着准确 Plus 实例，不存在时只打开已核签名全局路径一次，启动回执后再读实际状态。

管理侧通过正式安装 ss-service 的只读 inspect 分别显示 contextd/taskd job、配置、选择、报告及源码版本；任何未支持/不明确结果如实显示，不合并为业务已采用或 ready。新角色启停仍待准确既有 lifecycle operation 接口采用，不能在 App 内另建发布计划或调度器。

管理UI消费 status.result.permissions.accessibility 的 trusted/bundle_id/path/pid；不再消费workspace_request或发送workspace.open。设置 result 固定 settings/settings_revision。只读TaskWorkspaceClient保留固定本人HTTPS/Origin、GET与分页/响应校验，目前没有UI或controller运行消费者，不自动连接网络；待新小看板方案获准实施后再接入。

scripts/build-manager 仅 release 构建管理产品并沿已有 Developer ID 签名，不构建手机或 Plus controller。scripts/install-manager 接受准确签名候选，原安装存在时保留到 Library/Caches/codex-plus/manager-installs；实际安装前须交清旧客户端，不按进程名杀、退出 Plus 或解除虚拟屏托管。唯一 Release build 和安装/GUI writer 沿原安全点。当前只有 Debug 编译准备，尚未签名新管理包、安装或进行真实三模块控制/退出隔离验收。
