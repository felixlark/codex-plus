# SmartShadow 管理接缝 v1

独立管理 App 提供设置和组件状态；Plus 原生运行体保留 controller、手机网关、窗口路由和现有增强。管理 App 退出只取消自己的连接，不停止运行体或手机宿主。

## 当前源码合同

复用原 `0600 tool-control.sock` 和 `ToolControlServer`，一连接一个 JSON 行。`management-v1` 仅接受：

- `status`：返回真实 native PID、bundle、全局安装路径、版本、实例 UUID、权限及组件状态。controller/mobile 未知版本为 null，不冒充 iOS 安装版本。
- `settings.read`：返回原五个设置及其规范化 SHA-256 revision。
- `settings.write`：校验当前实例、原 revision、严格类型和字段范围，沿既有偏好与回调写入并读回。冲突或实例变化不写入。

已删除完整工作台操作、查询字段、空状态回执及专用恢复。小看板尚未实现，管理界面明确显示该状态；不能从未知操作拒绝推断历史开窗结果。小看板的数据接口和打开方式待需求确定后再实现，不预留上一版协议或网络适配器。

管理客户端校验 socket/父目录所有者与权限、peer UID，以及返回 PID 对应的真实签名、bundle 和路径。取消只 shutdown 本连接，由原 worker 关闭 fd；没有自动重发写入或重启运行体的回退。未知设置写入只读核对实际值。

## 仍有消费者的设置与状态

用户菜单和页面设置入口打开已核签名的全局 SmartShadow 管理 App。Agent 设置页仍被 ToolWindowRouter 的显式入口消费，底层 SettingsModel 仍为管理协议提供偏好读写和回调。本轮保留，不把重复界面当作长期要求；唯一入口的迁接尚待决定。

管理产品为独立 `SmartShadowManager` target，只依赖 Core 数据和客户端；通过已安装 `ss-service` 读取组件状态，不引入业务看板或另一套发布器。新薄生命周期仍未交付。`build-manager`/`install-manager` 与 Plus/手机构建安装边界保持。

## 精简阶段边界

本批仅改源码并做定向检查，不合并或安装。现役 Plus74、iOS53、原窗口、草稿及历史未知结果保持。未来获准切换前按[精简交接](workbench-simplification.md)核对旧完整工作台，不能用删除后的源码接管或结算旧请求。
