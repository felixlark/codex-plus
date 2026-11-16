# interactiond 历史事项与过程材料审计（2026-11-16）

本档是历史归档，不是新产品方案或重新启用命令。依据 [#578 模块决定](https://github.com/felixlark/smart-shadow/issues/578#issuecomment-6905265797)、[已批准总案](https://github.com/felixlark/smart-shadow/issues/483#issuecomment-6905260670)及[先行实施记录](https://github.com/felixlark/smart-shadow/issues/578#issuecomment-6905273827)。结果负责人仍是 #578 原线程；#613 负责全量归属、Issue 元数据与最后清理；#611 负责实际 thread/project/cwd 投递验证。

## 覆盖和结论

读取时全仓快照为 186 Issues，12 open / 174 closed。按 [#613完整分配](https://github.com/felixlark/smart-shadow/issues/483#issuecomment-6905359002) 及 [#417转入](https://github.com/felixlark/smart-shadow/issues/578#issuecomment-6905365297)，本模块分配20项已全部读完；额外复核 #339/#374/#219 三项，共23项，全部正文及可见评论（含0评论）共152条。其余163项语义审计不在本报告覆盖内。#219另读最终PR220。GitHub 历史正文中仍写“进行中”时，以后续明确决定和实际 PR 为依据，不删除原记录。

| Issue | 全部评论数 | 语义处置及证据 |
| --- | ---: | --- |
| [117](https://github.com/felixlark/smart-shadow/issues/117) | 5 | 保持 completed。真实 question reply 已收到并用于续办，[实际回复](https://github.com/felixlark/smart-shadow/issues/117#issuecomment-6208834065)、[最终三项验收](https://github.com/felixlark/smart-shadow/issues/117#issuecomment-6335677119)。仅证明提问流程修复，平台卡片消失根因仍未知。 |
| [276](https://github.com/felixlark/smart-shadow/issues/276) | 24 | 保持 not_planned。PR279/280 的部分源码与“官方对话、四屏只读”历史有效；登录/AASA/生产配置恢复失败、统计原件、unknown 均保留。11月15日正文明确取消四屏与旧 App 安装；只将原前端会话能力归 #578，不补做旧四屏。 |
| [333](https://github.com/felixlark/smart-shadow/issues/333) | 3 | 保持 not_planned。[PR334 候选验收](https://github.com/felixlark/smart-shadow/issues/333#issuecomment-6494045429)仅证明模拟器四 Tab 与未登录状态，未证明真实历史/目录；后续取消优先，不重开 Draft。 |
| [339](https://github.com/felixlark/smart-shadow/issues/339) | 3 | 保持 not_planned。PR348 已合源码与本地快照预览，不是生产监测验收；[明确缺口](https://github.com/felixlark/smart-shadow/issues/339#issuecomment-6502974034)。最新正文取消九席/监测页，仅保留 #611 已有真实健康与 unknown，不能塞入当前小看板。 |
| [354](https://github.com/felixlark/smart-shadow/issues/354) | 1 | 保持 not_planned。只针对旧 PR334 的更新任务，随四屏取消；旧 owner 评论不构成恢复指令。 |
| [357](https://github.com/felixlark/smart-shadow/issues/357) | 4 | 保持 not_planned。最初 grok.com 未登录观察不等于 Grok Bot；后续纠正对象但未完成真实对标。取消独立旧 App 对标，保留研究来源。 |
| [374](https://github.com/felixlark/smart-shadow/issues/374) | 1 | 保持 not_planned。定期蒸馏/自学习没有转移到 #578 或后台服务；本轮不恢复收集。 |
| [406](https://github.com/felixlark/smart-shadow/issues/406) | 0 | 保持 not_planned。旧文件链接修复只有候选/技术检查，未证明真机接受；当前原前端手机不是旧私有文稿目录解析器，不追加原范围。 |
| [417](https://github.com/felixlark/smart-shadow/issues/417) | 40 | 保持 not_planned。旧网页/目录/多阶段 PR479 记录不等于当前采用。暂停、短暂文稿恢复及[停止独立开发](https://github.com/felixlark/smart-shadow/issues/417#issuecomment-6881711878)保留；移交的三份文稿已由 #578 [PR625 接收](https://github.com/felixlark/smart-shadow/issues/578#issuecomment-6882570960)，不复活旧 UI。 |
| [425](https://github.com/felixlark/smart-shadow/issues/425) | 0 | 保持 not_planned。Cindy 属历史 HOW 参考，未授权多 Harness/Companion 实施；取消决定不扩入 #578。 |
| [432](https://github.com/felixlark/smart-shadow/issues/432) | 0 | 保持 not_planned。11月3日已废止 DSH/第二 Agent Loop，后续旧正文不是新指令。 |
| [469](https://github.com/felixlark/smart-shadow/issues/469) | 0 | 保持 not_planned。旧 20 项目录、批量更名、禁拆批、自制页面取消；仅同一原会话读取/单次发送/流式/防重与 #578 重合。 |
| [352](https://github.com/felixlark/smart-shadow/issues/352) | 8 | 保持 completed。PR343 已同步 main，16文件410项检查及最终[合入/结案](https://github.com/felixlark/smart-shadow/issues/352#issuecomment-6509630540)有据。多个失败/误取消 execution 不合并或重放；本案仅重放目标完成，不证明宿主权限全链路。后续归 #611。 |
| [324](https://github.com/felixlark/smart-shadow/issues/324) | 3 | 保持 not_planned。初始候选两项CI失败已由[后继核收](https://github.com/felixlark/smart-shadow/issues/324#issuecomment-6601321574)解释，PR343合入不等于真实权限生效。旧PR271重放取消；当前权限/模型/cwd核验归 #611，安装归 #613。 |
| [237](https://github.com/felixlark/smart-shadow/issues/237) | 3 | 保持 completed。[PR240合入及两项签名夹具通过](https://github.com/felixlark/smart-shadow/issues/237#issuecomment-6362595180)，没有放宽生产签名、没有改正式安装包。归 #613签名/安装测试历史。 |
| [217](https://github.com/felixlark/smart-shadow/issues/217) | 1 | 保持 completed。[完整检索零命中与范围说明](https://github.com/felixlark/smart-shadow/issues/217#issuecomment-6335853255)完成称谓任务；未因纯文稿重跑全量。后续文稿规范归 #613，不改旧历史措辞。 |
| [207](https://github.com/felixlark/smart-shadow/issues/207) | 4 | 保持 completed。[满24小时无直推](https://github.com/felixlark/smart-shadow/issues/207#issuecomment-6356754721)及[结案](https://github.com/felixlark/smart-shadow/issues/207#issuecomment-6356982844)有据。旧 codex_decision 停用/原target保留，当前官方队列不是恢复旧直推；建议归 #611。 |
| [222](https://github.com/felixlark/smart-shadow/issues/222) | 8 | 保持 completed。[正式r6.4.58公开四路径200及helper ready](https://github.com/felixlark/smart-shadow/issues/222#issuecomment-6356381919)补齐Mac中继；旧blocked是防回退，不装旧候选。后加iOS五文件已拆 #406 且取消，不由Mac完成外推手机通过。建议归 #613。 |
| [206](https://github.com/felixlark/smart-shadow/issues/206) | 2 | 保持 completed。[10分钟528条采样](https://github.com/felixlark/smart-shadow/issues/206#issuecomment-6335802054)证明当时不抢前台，原PR209同步状态是另层事实，不重跑旧取样。建议归 #611后台项目/线程访问。 |
| [203](https://github.com/felixlark/smart-shadow/issues/203) | 6 | 保持 not_planned（重复跟踪合并），不误写已验收。[最新决定](https://github.com/felixlark/smart-shadow/issues/203#issuecomment-6889277940)明确转 #611并保留未勾选真实后台登记验收；旧正文“保持开放”已被该决定替代。原治理thread/暂停仍保留，不重启。 |
| [193](https://github.com/felixlark/smart-shadow/issues/193) | 5 | 保持 not_planned。单角色实验没有验收证据，旧治理thread明确暂停。正文取消独立CODEX_HOME/SQLite信箱/control socket路线；正式队列仅归 #611，不新建旧角色守护器。 |
| [578](https://github.com/felixlark/smart-shadow/issues/578) | 30 | 保持 completed。初读29条，补读全量分配评论6905365297；原手机原前端、宿主、小看板和生命周期验收分别保留。最终 [acceptance](../../acceptance.md) 的 c8ce400 基线已记录 TF374、30分钟资源观察；真机连接未验收。 |

> 评论数量以本轮本地读取快照为准，后续评论不计入。#578 补读的全量分配评论是整理指令，不是新增手机验收。

[219](https://github.com/felixlark/smart-shadow/issues/219) 单独复核：旧正文/评论写未修复，但 [PR220](https://github.com/felixlark/smart-shadow/pull/220)最终于2026-10-22合入，正文给出事件循环/React Query 通知竞态、未改生产调度的修复、默认参数三轮161/161与回归前后证据。保持 completed，不为已删除旧 UI 重跑全量测试。

分配修订建议：#193/#203/#206/#207/#324/#352 归 #611；#217/#222/#237 归 #613。本次只完成阅读和建议，不写owner字段、不唤醒原线程；原业务owner、暂停、unknown与旧execution记录保留。额外 #339按取消决定归 #611健康读取，#374取消自学习不再分派，#219归 #613测试历史。

交叉线索（非本模块完整评论审计）：#247 属线程能力归 #611；#204/#238/#239 属安装及release绑定归 #613；#199/#544/#571 属微信来源归 #610；#243 入口推荐归 #611。#247 的 available 不等于线程能用 IAB、#239 的源码合入不等于现场 web_root 已切换，仍须保留原边界。

## 本次持久化的工程结论

17 份原文/历史源码逐字节进入本目录；[cache-manifest.json](cache-manifest.json)记录58个明确路径的原 SHA256、落点、消费者范围和保留理由。原文保留当时的候选/未知/限制，不能当成现行规范。

- `frontend-boot-trace--FINDINGS.md`、`host-port-trace--REPORT.md`：26.1111.21308 的启动需要原 app-host services；MessagePort RPC 带回调、流、导入/释放及结构化值，普通 JSON 中继有损。独立已登记 sender 的宿主窗承载手机口；同 renderer 第二次注册会替换 appView，不是无副作用旁路。invoke 成功不是业务完成，reload 会关闭 port。两份只是局部静态证据；后续真实原型见 PR18/23 与验收，不能外推全宿主能力。
- `mobile-kv-review--*`：手机 opaque atoms/application 单独进本机 Keychain，提交后才 ACK；不可写 Mac UI KV，不用明文降级。保留原 reducer、任意合法字符串 key、原不写字段及云端 revision 守卫。早期 -34018 是模拟器签名 entitlement 缺失；bootstrap 字符串编码修复已有定向测试。具体运行结论仍以对应 iOS 候选为准。
- `agent-display-review*`、`geometry-consumer-review*`、`ocu-startup-provider--pr3-final-body.md`：保存当时的窗口身份、完整 frame、失败查询不是空列表、异步回执与 unknown 不重放等审查发现。**虚拟屏、persistent-display、自动停放/恢复已于11月15日退役**；旧启用配置、安装和恢复步骤均不再执行。当前只认原[右物理屏合同](../../designs/agent-windows-right-screen.md)。
- `tool-window-migration-sources--quiet-tool-windows.md`：保存迁入 Plus 前的 Dock Switch 设计/验收。所有 DockSwitchCore 路径、旧手动恢复和旧版本仅是历史；当前实现与入口见现行设计/源码。
- 两份 release INSTALL 保存旧0.5.1/0.6.0真实安装/签名/适用范围，不把旧宿主版本、订阅资格描述当当前事实，不据此重新发布。
- `f6-foreign-preservation--source.patch` 与两个 `.txt`：旧单writer交接保全。5个patch目标中有3个目标blob已在Git历史；`CodexLauncher.swift`和`controller.mjs`两个中间目标blob未找到，不能断言整个patch重复。完整patch及两份伴随源码原样归档；后者与本地canonical副本字节一致。**不 apply，不构建，不恢复旧行为**；正式后续 F6 实现见 PR16/17。
- `final78-docs.patch` 内容进入 PR36/37；逆向 apply 因文稿后续增加/调整不能通过，不将此失败当遗漏。目标blob及其修改链已用 Git 对象/历史核对。

## 消费者与保全

只读检查进程参数没有发现 Cache 绝对路径直接消费者；该结果不能证明惰性脚本、App打包资源或将来的构建不消费它。源码仍明确读取 `mobile/connection.json`、`mobile/frontend`、`mobile/bin`、`project-order-probe/node_modules/acorn`，构建/测试使用 swift、manager、npm 等缓存。所有这些保留。

本轮未删除任何本地文件。私密连接配置、原会话数据、日志/录屏、原版厂商资源、old unknown、安装回滚包、工具修复/第三方源码均不上传；manifest仅给脱敏类别和路径。58项是人工筛出的工程文稿/patch/伴随文件范围，不是整棵 Cache 的安全删除白名单，也不声称全部缓存已去重。#613 才能结合全量消费者清单及归档读回逐项决定最终清理。`docs/designs/compact-task-board.md` 原未跟踪讨论稿未改、未暂存。

## 验证

文稿与17份历史文件 SHA256 核对；README本地链接、manifest路径/哈希及敏感字段检查通过。常规文稿 diff 检查排除原样保存的 patch：该历史patch有5行仅含上下文前缀空格，属于原补丁语法，保留字节不清洗。没有改运行代码、创建窗口、发送聊天、重新上传TF或切换服务。远端采用与内容读回在本次PR及#578结果评论记录，不以本地文件存在代替。
