# 后台建议与敏感事项审查

2026-11-14；用户已批准讨论方案并授权实施。沿当前分支和唯一 controller，保留开关偏好；不自动发送旧建议，不更改会话模型或执行权限。

## 实现合同

- 原生 host turn-completed/live prediction 不依赖选中聊天。现有 validate 只读已加载历史，改为在审查前通过原生 ensureConversationFirstPage 后台加载；不 mount 路由，不聚焦、不更改草稿。保留原生预测过滤及固定资源摘要校验。记录阶段计数与原因，不记录正文。
- bridge 中建立不可变快照：账户/上下文代际、host/thread/source turn、建议正文、已加载历史、follow-up mode/settings、current permissions、sandbox policy 和审查策略版本。摘要仅用于绑定，不代替状态重读。正文及审批均只在内存；重启/重载/开关变化清空。
- 语义审查复用现有 renderer manager.sendRequest('thread/sample')，沿原生连接和源任务模型上下文，不创建 app server、独立可见聊天或外部服务，不覆写模型/权限。使用 expectedTurnId，disableMcp；严格解析纯 JSON。官方实现说明 sample 在响应交给执行器前截获、工具调用返回空、临时 fork 清理；安装版仍需用专用无副作用任务验证源 turn 不变。超时、空文本、错误格式、上下文不足均待审，禁止以规则未命中作为放行依据。
- 建议正文确定性敏感匹配可直接待审；其他候选做语义审查，涵盖微信/邮件操作、对外发送/发布/承诺、财务/交易/支付、认证/新增敏感权限/协议和不可逆删除。必须解释本次准备动作、对象、范围；助手说已授权不能替代原用户授权；敏感任务后续含糊“继续”继承风险。曾识别敏感的 thread 本连接内保持敏感，不由后续普通提示清除。
- 模型判定仅明确低风险且上下文充分才自动发送。敏感/不确定/服务不可用进入独立待审状态，不占 durable attempt。设置窗口显示任务标题、原建议、来源输入、动作/对象/范围与原因，用户可批准本次或拒绝；批准仅准本提示词、不替代实际敏感动作的授权/工具审批。
- 待审生命周期独立于原 60 秒即时候选；本轮采用 15 分钟可见有效期（用户审查新鲜度策略，不用于限制后台并发），到期删除，重新生成的新建议重新审查。批准后重读同源同文及权限快照；变化/不明失效，不复活旧候选。
- 单一协调器先原子持久认领，再以唯一 operation 保留许可。原生同 operation 的多次 assert 可复验相同批准，其他 operation 不可复用。全部窗口草稿/输入版本仍须通过，关闭即撤销尚未提交动作，unknown 不自动重试。结果/计数之外正文不入 state.json、attempt store 或诊断日志。
- Plus 拦截提示词，不宣称执行工具级保证。官方动作审批未证明覆盖微信/邮件等，敏感任务没有无人值守放行；人工逐条检查准确行动后才能续跑，原任务对实际操作的确认仍有效。

## 验收

真实安装版保持另一聊天打开，给既有无副作用验收任务发种子，验证 native live → 后台加载 → 语义审查 → 后台续轮，全程不切目标聊天。另验证敏感/间接表达/上下文不足待审、拒绝、单次批准后复验、来源/正文/权限变化失效、关闭/断线/重启/多窗口不重放、草稿保留。纯测试不替代安装版原生 sample 不写源 turn 的对账。

来源：仓库 background-suggestions.md、安装宿主固定资源及其导出 ThreadSampleParams/Response；[OpenAI sample 实现](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/thread_sample.rs)。源码远端版本不直接充当安装版验收证据。

## 接口、状态和实施门槛（评审修订）

修改范围：`suggestion-review.mjs` 定义严格审查策略，`suggestion-auto-send.mjs` 持有背景快照及待审/许可状态，`controller.mjs` 协调跨窗口认领并通过内存 pipe 传待审内容，`CodexLauncher.swift` 接收及提交决定，`SuggestionReview.swift` 展示审查，`CodexPlusApp.swift` 接入设置；`Tests/suggestion-auto-send.test.mjs` 回归状态交错。版本为 0.7.0 build17。

原生请求精确为 `{threadId,expectedTurnId,prompt,disableMcp:true,threadSource:'composer_predictions',turnTrigger:'composer_predictions'}`，不设置 effort/model/permissions。prompt 来自 `createSuggestionReviewPolicy().prompt()`；返回解析使用 `{sourceTurnId,text}`，text 必须是纯 JSON、恰有 `decision:'low-risk'|'sensitive'|'uncertain',contextSufficient:boolean,action:string,target:string,scope:string` 五个字段。未知枚举、缺/多字段、空动作范围、源轮不符或工具调用产生的 null 一律不可自动放行。原生 sample 本身有 30 秒超时；bridge 的异步评估不阻塞 controller 许可心跳。Native请求失败不会自行改走外部服务。

后台先 ensureConversationFirstPage，再 ensureConversationHistoryLoaded(threadId,[],{force:true})；读取完整历史的 isComplete 和权限/sandbox，任一未知即待审且不能批准。首屏加载并不等于历史充分。sample 还继承原生完整模型上下文；若上下文已压缩而关键前因不明，模型须报 uncertain。重启不把风险判为低；每条新候选重建历史和语义判断。已明确敏感 thread 的标记在本 controller 连接内只增不减。

状态转换：captured → reviewing → allowed 或 needs-review；needs-review 仅在 contextSufficient 且 decision 非 uncertain、展示动作/对象/范围后可人工批准。不可核实时仅拒绝或重新审查；重审重新生成内存token。批准时先转 revalidating 防重复点击，复验摘要一致才 approved。协调器只见 allowed/approved，先持久认领，失败关闭功能并撤销所有候选；成功生成唯一 operation，submit 校验 token/摘要后进入 claimed。每次 assert 对同 operation 只读校验全部状态；第二 operation 不得进入 claimed。结果 accepted/rejected/unknown 均移除候选，durable attempt 保留不重试。关闭指关闭自动发送开关；设置窗关闭不改变偏好，聊天/窗口卸载、上下文重建或超时使相关候选失效。15分钟到期删除待审，重新开启/重载/重启均不自动恢复。

自动语义审查的安装启用门槛：保持总开关关闭，先用已确认无副作用的既有验收任务调用 preview（只允许读取、后台加载和原生审查，不捕获候选、不批准、不发送）；官方 read_thread 前后源 turn/历史不变，工具执行记录不增；核 native 采样临时fork清理与宿主版本/资源摘要；测试里验证同 operation 两次 assert 成功而第二 operation 拒绝。未通过不启用。preview 的断言不替代敏感工具执行级审批；没有已验证工具动作审批的敏感任务必须逐条人工审查，不能自动放行。

关键可观察证据：后台发送前后主窗口路由一致、目标不选中；来源轮结束后真实出现建议、审查计数上升，官方 read_thread 出现恰一次自动用户消息及新轮；批准后改变来源/正文/账户/权限必须没有新轮；重启和 unknown 都不新增发送。签名构建、安装可执行文件及资源哈希与该轮证据绑定。

备选比较：纯关键词不能理解“继续”，只用于强制升级；敏感一律待审仍需要识别隐含范围；新增外部分类器会引入数据传输和配置；本机模型当前不可用。选现有原生 sample 复用源上下文和认证，代价是每条候选多一次模型调用、依赖固定宿主及其隔离验收。任一条件不满足降为待审，不做静默替换。

## 保留旧窗口的升级接入

生产宿主没有 Reload Window 菜单；验收改沿 OCU 可见命令菜单的 Open in new window 创建新原生页面，不关闭旧窗口或重启宿主。controller 对新审查 bridge protocol5 才下发 enabled=true；保留的 protocol2/3/4 一律关闭发送租约，只参与原有草稿只读探针，协调器绝不消费其候选。存在未知 protocol 或未知草稿页时不发送。至少一个已注册 protocol5 且全部主页面均可核草稿，才报告 pageReady；旧 protocol2/3/4 窗口自然关闭/重新打开后退出此兼容范围，不另设旧发送路径。preview 只读数据与采样可以保留既有验收草稿，发送检查仍始终要求无草稿/附件。

## 生产页面恢复与窗口职责检查

最终候选 0.7.0 build17 / bridge protocol5。原生 NnGo.oI 单窗口副作用职责检查留在原生事件监听/建议生成链；Plus 的上下文仍核 nH 和原生连接代际 C，另独立核账户、owner、真实最新轮、运行状态及草稿。安装前须追到 NnGo 的实际赋值证明它确为窗口职责而非安全权限，未核实不发布该改动。

设置增加“重新接入页面增强”，仅在总开关关闭、无发送在途时可执行。它是产品的升级恢复入口，由 OCU 点击；controller 对全部自有主页面先检查加载完成、可见未提交文本/附件及对话框，存在未提交内容或窗口集合变化则拒绝。通过后仅 Page.reload 自有 renderer，宿主进程及后台任务不退出。原生持久草稿由 Codex 恢复；不能把此恢复按钮冒称为冷启动/新启动责任归属验收。没有执行该产品动作前，新旧协议仍按“旧桥不发送、未知窗口阻断”处理。

NnGo 赋值已核实：主进程 `canWritePrimaryWindowTabPersistence = !renderersWithoutAccountState.has(webContents) && browserHostManager.isPrimaryWindowPersistenceOwner(webContents)`；renderer kQZ2 onHydrated 唯一写入 MW，清理设 false。因此剥离窗口职责时，probe 另要求账户/用户标识都存在；snapshot 绑定账户与代际并在每次 assert 重读，nH/C 和原生 owner/运行/权限检查继续有效。不能借此跳过账户未就绪。

重新接入修订：各页先安装本操作独占的 trusted-input 失效标记；每页重连前重核所有尚未重连页，最终检查与 location.reload 在同一 renderer 同步任务执行。只重连旧协议页，已为 protocol5 的页面保留。窗口集合变化或新增输入则停止其余页；部分已重连必须据实报告。收到导航回执后最多观察30秒，全部原页面 protocol5 且 registered>0 才报成功，否则显示未完全接入且保持自动发送关闭。该观察时限是UI结果等待，并非资源/并发上限。

生命周期恢复：Plus 关闭后的 pipe EOF 或真实 OS 父进程消失均撤销发送租约并停止 controller。清理并行执行，沿既有 CDP 请求时限最多等待10秒，随后关闭连接退出；不终止 Codex 宿主。该期限仅界定关闭时资源回收，不是模型审查或任务执行时限。安装17实测父进程退出后9.8秒内 controller 退出，宿主1605继续运行。

2026-11-14 更新后候选为0.7.0 build18，支持实际宿主26.1111.21308/27194；固定资源清单随独立核验更新。thread/sample显式allowInProgressTurn:false，不使用新版正在执行轮次采样能力。采样实现守卫改为Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex真正Mach-O，避免wrapper不变而实际二进制改变时失察。新版语义及安装复验见acceptance.md。
