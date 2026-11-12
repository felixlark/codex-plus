# 后台建议提示词自动发送

2026-11-12，Sol，0.6.0 build13。用户要求在后台新建议产生后立即发送，不必先打开聊天。此方案替代 auto-send-suggestions.md 中要求前台焦点、Tab和Send按钮的执行路径；开关与历史去重记录沿用。

## 原生接缝

官方 Codex 26.1106.51428 的已审核资源 `webview/assets/async/739301.37a39f26d6.js`（SHA256 `acc2174e4ed3d2068af26c1731f08e8978c853864aea9c0a917ae9d246885058`）包含 J8Ro 全局 host turn-completed 监听。完成普通本机聊天后，原生后台调用 cumberbatch.requestUserMessagePrediction(live)。保持原生功能开关、采样、身份、原生代际、owner、automation/ephemeral等过滤。只在原生成功且仍属于同一 sourceTurnId 的缓存写入分支内捕获非空建议，catch_up 旧建议不追发。该事件同时覆盖当前选中的聊天。

与现有侧栏适配组合为同一次经摘要校验的内存响应替换，不修改官方包、签名或认证资料。未知摘要/结构停用自动发送，其他增强仍按原能力运行。

## 单一执行器

suggestion-auto-send.mjs 的页面桥只接收新live结果、保留60秒内的新候选，每个聊天只保留当前来源轮并提供检查/动作；不含自主发送timer。提示正文留在renderer内存。Node控制器一秒内发现候选，单一协调器按host/thread/sourceTurnId在自有suggestion-attempts.json原子认领后才调用原生client.startTurnWithOutcome。每个来源只尝试一次；accepted才计submitted，rejected或unknown均不重放。旧DOM自动Tab/Send路径移除。

发送只给原生输入、threadId和本次clientUserMessageId；原生继承会话模型、推理强度、协作模式、工作区和权限，沿既有准备和请求流程。禁止通过本项设置覆盖模型/权限。无需选择聊天、聚焦窗口、读取或清空输入框。

## 检查与取消

每页通过原生TSib.lD检查V3rO.JJ当前alias及s8历史alias的草稿，沿现有root.retainedScopeEntries只读遍历原生保留的Route/Composer节点，匹配目标别名，并用已审核原生GNwQ.GB临时重建读取包装，通过TSib.rD检查附件等未提交内容。不会创建、mount或额外保留scope。该依赖资源514766.2d2f1ddc86.js另核SHA256 943016fbef25cbfe62703ea7ab5ee7d2e9971b8db3681147fb983e7bd12e6f39。没有对应host上下文或窗口状态未知则阻断。native client验证最新真实轮完成且仍为来源轮、owner、已恢复、普通非durable/plan聊天、无其他工作；原生发送准备后允许唯一对应本次clientUserMessageId的无turnId乐观轮。

每次原生assertRequestCurrent均通过Runtime binding向当前controller申请新的许可。controller核当前连接、开关代际、唯一持久认领的在途操作、全部主页面窗口集合和目标草稿/输入版本。检查期间窗口或输入版本变化即拒绝。页面许可请求超时取消；租约仅用于候选接收，不可独立授权发送。关闭通过stdin立即增加代际并向各页撤销许可，不等待monitor。新控制器、重新开启均清空旧候选。控制器无响应时晚期检查拿不到新许可。

最终许可是检查时快照，不能锁住许可之后的人类输入；本项始终保留所有草稿。关闭停止尚未获得最终许可的动作，已经提交的请求无法撤回。不以原生返回accepted代替下一轮真实完成。

## 评审、验证和恢复

候选A经两个独立只读评审发现跨窗口旧快照、旧租约两项Major；候选B通过每次原生晚期检查的新许可协议和统一执行路径解决。fresh-context定向复审0 Blocker/Major。记录见 docs/reviews/background-suggestions-egm.md。

测试覆盖实际原生资源组合解析、跨窗口去重/重启、持久化失败、关闭/晚期许可拒绝、native自身与其他乐观轮、草稿/附件及设置继承。正式安装后以现有无副作用测试聊天发送seed，另一个聊天保持打开，官方read_thread验证真实自动续轮。关闭和草稿阻断另验；原生未生成不冒充通过。

安装保留旧包，官方宿主保持原签名。重载先协调共享GUI与已保存现场，不结束原有任务。回退旧Plus包并保留attemptStore，不自动重放。用户最终接受前原Issue仍开放。
