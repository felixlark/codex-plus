# SmartShadow 管理接缝 v1

独立管理 App 提供设置和组件状态；Plus 原生运行体保留 controller、手机网关、窗口路由和现有增强。管理 App 退出只取消自己的连接，不停止运行体或手机宿主。

## 当前源码合同

复用原 `0600 tool-control.sock` 和 `ToolControlServer`，一连接一个 JSON 行。`management-v1` 仅接受：

- `status`：返回真实 native PID、bundle、全局安装路径、版本、实例 UUID、权限及组件状态。controller/mobile 未知版本为 null，不冒充 iOS 安装版本。
- `settings.read`：返回原五个设置及其规范化 SHA-256 revision。
- `settings.write`：校验当前实例、原 revision、严格类型和字段范围，沿既有偏好与回调写入并读回。冲突或实例变化不写入。

已删除完整工作台操作、查询字段、空状态回执及专用恢复。不能从未知操作拒绝推断历史开窗结果。小看板是独立 SwiftUI 窗口，经正式 taskd inspect 返回的 `mcp.executable/arguments` 启动原 LocalMcpClient，以 `tasks_read` 读取配置登记范围；不预留上一版工作台协议或 HTTP 适配器。

管理客户端校验 socket/父目录所有者与权限、peer UID，以及返回 PID 对应的真实签名、bundle 和路径。取消只 shutdown 本连接，由原 worker 关闭 fd；没有自动重发写入或重启运行体的回退。未知设置写入只读核对实际值。

## 仍有消费者的设置与状态

用户菜单和页面设置入口打开已核签名的全局 SmartShadow 管理 App。Agent 设置页仍被 ToolWindowRouter 的显式入口消费，底层 SettingsModel 仍为管理协议提供偏好读写和回调。本轮保留，不把重复界面当作长期要求；唯一入口的迁接尚待决定。

管理产品为独立 `SmartShadowManager` target，只依赖 Core 数据和客户端；通过已安装 `ss-service` 读取组件状态，小看板仅为只读视图，不引入业务存储或另一套发布器。薄生命周期采用情况由 #613 另证。`build-manager`/`install-manager` 与 Plus/手机构建安装边界保持。

## 精简后恢复边界

用户2026-11-15已批准恢复开发、相称检查、合并、既定安装和真实验收。管理App最小启停/状态由#613交付，服务安装切换保持唯一操作者。现役 Plus74、iOS53、原窗口、草稿及历史未知结果保持。未来获准切换前按[精简交接](workbench-simplification.md)核对旧完整工作台，不能用删除后的源码接管或结算旧请求。

## 薄生命周期管理

管理App启动只读三服务状态，不自动启动interactiond。各模块的启动/停止按钮调用同一正式 `ss-service`，读取 `smart-shadow.service-inspect/v1`；未安装模块明确显示且按钮禁用。interactiond设置连接失败不影响taskd/contextd。取消窗口只取消只读子请求，不中断已发出的生命周期操作；未知结果只读核对，不自动重发。原设置身份/revision核验保持。

## 小看板

每次打开或手动刷新，创建一个只读 MCP 连接，完成 initialize 与 tasks_read 后关闭。HMAC 和凭据只在原 LocalMcpClient/Vault 内处理；Swift 不读取密钥、不写业务状态。关闭看板只取消本次只读客户端，不停止 taskd、手机宿主或 Codex Run。

以 repository/number 标识事项；重复身份拒绝显示，输入版本变化后仍保留明确绑定的在途尝试和成果，标注“输入版本已更新”，避免成果评论更新 Issue 后隐藏原 Run。任务完成只认 coordination.status，finished Run 仍显示“运行结束”，不计已完成任务。首版明确标注仅覆盖 taskd 登记范围，独立 Codex 任务尚未计入。界面只提供原案和成果链接。

安装版 4101 已经由正式 taskd 入口读到 #611 的真实执行中任务。任务数仅覆盖登记范围，成果回执仍须单独核验。

管理主窗口具有稳定的场景标识。关闭全部窗口后再次打开 App，应用委托重开管理场景；该操作不重新启动服务。4102 安装版已验证同一进程无窗口后正常重开，原手机宿主和后台保持。看板也已显示真实同次成果回执；完整范围见[验收记录](acceptance.md)。
