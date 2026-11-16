# interactiond 原生生命周期接缝

沿 #578/#613 原批准范围，将已有 `/Applications/Codex Plus.app` 接入正式服务控制器。管理 App 自身关闭不调用本接缝；明确停止 interactiond 会断开手机连接、结束网关并关闭该连接的专用宿主。原 Codex 主进程、app-server、人工窗口与正在执行的 Run 均保留。

## 协议与责任

停前采用明确两阶段：`lifecycle.prepare-stop`先冻结native/controller新资源准入，等待已在途的mobile初始化读取结束，返回当前live owned_scope及摘要；#613持久保存后再发`lifecycle.stop`。prepare是有副作用的显式停前动作，status保持纯读。prepare失败保留quiesced/unknown可查，不把失败解释为从未停止准入；不自动恢复或重复发送。已有连接可在prepare期间保留，但80起若该peer再发新frame会被明确关闭，不把它送进原后台；prepare等待已经接受的操作排空。手机连接恢复仍需手动Reconnect，不重发旧业务。

冻结从接受prepare即生效，包括controller自动恢复、设置/tool效果、新人窗/手机窗/网关/导航安装；失败或断连后仍保持。quiesce回执屏障覆盖所有已发资源变更和所有正在处理的初始化/创建/安装回调，等待其归并后再采集scope。无法证明全部收敛就prepare_unknown/scope_not_ready，不返回成功scope。回执绑定prepare request_id、native instance、controller PID/出生和scope revision；等待通过异步continuation，不能阻塞处理controller stdout的主线程。后续stop仅接受该次仍处于prepared的scope。

复用现有同用户 `0600 tool-control.sock` 及 management-v1 身份协议，增加 `lifecycle.stop`，必须给出最近status读到的 `expected_runtime` UUID和`expected_scope_revision`（同次controller/gateway/anchor集合摘要）。原生当前集合与摘要不符就前置拒绝，不先接受再丢失资源身份；接受时立即关闭新开窗/配置写准入。接口回显accepted_scope及其摘要并返回 `stop_requested`，不冒称进程已经停止；原生在响应发回后走与菜单退出相同的路径。旧身份、已停止、拒绝退出分别保留准确结果。断连、响应未知不重发stop，控制器检查原PID/出生时间及本次controller/gateway/anchor实际消失；相同PID不同出生不得归前次运行。

原生CLI新增 `--lifecycle-status` / `--lifecycle-stop --expected-instance UUID`，使用已校验的socket连接，不启动GUI。status保留已有runtime UUID/PID/path/build，附主进程出生时间、controller PID及当前手机target/window/连接。ss-service核已安装路径和Developer ID签名，status成功且身份相符才允许发送stop。

另增`--lifecycle-prepare-stop --expected-instance UUID`，等待controller通过原stdin/stdout返回同request_id的quiesce响应。没有controller时仅可返回已证不存在的本代scope；存在controller而没有响应则prepare_unknown，不能凭旧状态文件组成成功scope。

显式`lifecycle.resume`（同instance）可取消已知prepared阶段，解冻原连接/observer，不启动另一个controller或重放旧开窗。prepare_unknown时先只读对账；不能把resume成功解释为旧unknown已清除。该入口用于取消未执行的停止，不恢复用户明确暂停的业务来源。

### 80：保全陈旧人窗请求，避免永久卡住prepare

旧F6请求的Electron invoke可以已完成，但controller仍保留`requested`，原生AX侧超时不会清掉它。80在startup/monitor/已在途invoke全部排空后，对这些记录只读`Target.getTargets`，保存每个原nonce/phase与实际匹配target。没有匹配仍是unknown，不能伪造未创建或关闭它。结果先原子写入本机launcher下`human-creation-outcomes-<controller connection>.json`（0600），再随native scope返回`human_creation_outcomes`。每代文件跨重启保留，不只依赖下一次启动会覆盖的state.json。

已经冻结的nonce标为`preserved`，后续settle永久跳过，resume也不解冻；迟到的窗口可能已有用户草稿，绝不能自动Page.navigate、重建或关掉。它们仍属于保留的原官方host，不加入本服务关闭资源。确有`creating`但未排空、Target清单失败或证据文件写入失败，仍拒绝prepare。原Scope摘要和同host出生校验保持。

ManagementRuntime继续只允许prepared阶段resume，不开放prepare_unknown的普通恢复；后者可能涉及startup中断或已丢失的手机上下文。MobileAccess.resume对stopped或握手未完成返回失败，不把无操作当恢复成功。旧78明确失败prepare且未发送stop的恢复由#613正式恢复入口办理：先保存草稿/原unknown并关闭手机App，读回connections=0，再按原prepare request/instance/出生身份登记独立recovery observation，正常退出及资源消失读回；不冒称原stop已接受，不使用原finish接口伪造scope。恢复unknown只读结算，不重发Quit/stop。

ToolControlServer 在处理该请求后构造独立的 afterReply 回调，写响应成功或失败后都调度到主线程；只有已核实例且已接受的stop含此回调。原生记录内存阶段 stop_requested → stopping，若窗口操作仍在途则 blocked_pending_window；原观察器完成后沿既有正常退出回调继续。重复stop只读回原阶段，不产生第二次动作。

启动由 #613 通过原生 NSWorkspace/open 首次启动已核签名的安装路径，无新增daemon或第二Plus。已有匹配实例时只读status，不对它重复open（原应用reopen会打开Codex界面）。原有偏好/配置读取保持；不把旧controller参数直接伪装成配置文件。原Plus恢复原Codex的附着路径不变。

## 停止完成与恢复

原生先撤回自己窗口观察/开窗请求，再发controller SIGTERM。controller依次关手机客户端/网关/专用anchor并释放页面增强。现有10秒best-effort清理的最终`stopped`不构成准确证明；最终完成条件由 #613 检查主PID/出生、controller/gateway退出和专用target消失。未证实项为stop_unknown，不kill原Codex、不凭时间自动重试。

原生统一退出入口先停止workspace observer，并禁用reopen/F6/menu开窗准入；controller的createHumanWindow/settleHumanCreations在每个await返回后检查stopping。mobile tick/readiness与startGateway在await返回且产生开窗/spawn副作用前检查stopped。已发送的开窗不能按“未取得target”当不存在：status保存creationAttempted、anchor nonce/instance；stop后按nonce在原backend目标列表对账，unknown保留，不能启动替代连接掩盖。

停止中冻结management设置写入和tool-open/place/routing等效果入口，防止重新启用observer或重置stopping；status和只读对账继续可用。controller恢复回调在native接受prepare时即被关闭并持续保持。若已有创建请求无法取得完整身份，只返回scope_not_ready且不执行stop，由owner先对账，不用不完整集合接受停止。

状态明确标记采样来源：native进程身份由本进程取得，controller/mobile值仅在当前controller PID匹配且alive时返回，附observe time与配置instance。gateway PID出生由公开proc接口核验；从未创建用observed_absent，创建中target未知用pending/unknown，不以null代替不存在。manager退出无上述副作用。

停止前由ss-service在已有生命周期操作记录中原子保存：操作ID、instance UUID、主PID/出生、controller PID/出生、gateway PID/出生、anchor nonce/instance/创建阶段/target/window、原backend身份、已核原Codex主PID/出生和配置摘要。gateway身份由原mobile status新增导出，只报自建gateway。原偏好/草稿/未决发送不变。断线后用该记录只读核对停止对象（Plus/controller/gateway/专用anchor）：均消失才标stopped；保留对象（原Codex主进程/app-server/Run）继续存在另证，PID重用不误判原进程；对象仍在/不可见则保留stop_unknown，不丢记录、不重发。这里复用#613既有操作记录，不新增业务库。正式切换前双方核单writer和正在发送请求；新Plus启动后若手机需新专用宿主，沿原生获准入口重新接入，核读取/发送/流式与原未发草稿。不能仅看进程已启动就称手机恢复。

## 验证

纯协议检查覆盖stop缺失/错误实例拒绝、只读status不触发退出、stop请求结果区别于退出完成。debug构建及现有CI。由#613统一安装后，先验status/拒绝旧实例，再在双方共同安全点执行真实stop，确认手机断开、原Codex Run继续、人工窗口保留；启动后重连手机并跑原入口。没有共同安全点时保留候选，继续独立工作。

共同安全点逐项读回：无在途手机发送/初始化，未发草稿在手机可见且记录长度摘要；已发送unknown清单保持不重放；当前Run身份和状态固定以便停后验证仍继续。停止/启动验收分别证明草稿、unknown未重放、Run连续性、连接恢复；任何一项未知仍如实保留。
