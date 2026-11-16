# Codex Plus

原 Codex 的独立 Mac 增强工具：原生菜单和设置、F6 人工窗口、工作区自动展开、侧栏独立布局与窗口编号、任务排序、带风险审查的建议续轮，以及准确 Agent 窗口的右屏路由。

各项目内先按 **总监 → 经理 → 专员 → 未标职级** 排序；同职级内按 **需输入/批准/错误 → 未读 → 进行中 → 其余** 排序，同档保留原顺序。项目间顺序沿现有状态与活动规则。

本仓按本人批准的 [v4 决定](https://github.com/felixlark/smart-shadow/issues/483#issuecomment-6909898465)恢复独立人工增强，替代此前融合后仅保留历史的范围。手机原前端、Swift 网关、TLS 身份、专用宿主及管理看板继续归 SmartShadow；本仓不再包含这些产品代码。

## 本批交付状态

当前批次为独立源码及签名候选交付。**尚未启动、注入或安装独立 Plus，也未完成双产品运行验收。** SmartShadow 需提供签名状态中的准确目标用途和人工增强交接证明；该生产接口尚待其独立迁接。缺失接口时 Plus 等待，不猜测或接管窗口。

[完整边界、接口和文件清单](docs/designs/standalone-enhancements-v4.md) · [检查与未完成项](docs/acceptance.md) · [自身管理协议](docs/management-api.md)

唯一 Delivery-Issue 为 [SmartShadow #578](https://github.com/felixlark/smart-shadow/issues/578)，安装和共享现场切换由 #613 负责。

## 开发入口

```sh
./scripts/test
./scripts/build
```

构建输入必须已提交，输出只在 Library cache。构建不安装、不运行。准备好的安装脚本仅作文件替换，由 #613 在接口和资源交接就绪后采用；原件留回退，替换不启动任何服务。

产品路径为 `/Applications/Codex Plus.app`，bundle 为 `me.longbiaochen.codex-plus`；私有运行文件在 `~/Library/Application Support/codex-plus/enhancements/`。手机旧数据、草稿、配对和 unknown 均留原处；旧建议尝试日志只读导入去重，无法读取则暂停自动续轮。

## 历史资料

其余设计、研究和旧验收按原版本作为历史证据，不能证明本次独立产品的运行状态。旧融合入口见 [固定历史版本](https://github.com/felixlark/codex-plus/tree/b879019b55dcbca7ded7440fe4b06b2e20bf5576)。
