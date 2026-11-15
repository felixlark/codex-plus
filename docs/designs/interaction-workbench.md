# 原 Codex 工作台与任务看板

本批沿 Smart Shadow #578 和管理接缝 v1 补首条可用入口。手机原前端及其独立 Mac anchor 保持；原 Codex 两个人工窗不作为工作台。任务业务状态仍归 GitHub/taskd，Plus 不创建本地业务队列或执行状态投影。

## 当前事实和消费者

基线 main 89867f4：Plus71/iOS53 已正式安装，手机经 Tailscale 读发流式、草稿与重连已有有效证据。Manager4001 已有 workspace.open 客户端及同 request_id 查询，运行侧尚未支持。原 Codex 26.1111.21308 的已核验 native open-in-new-window、startup.whenReady、CDP target 与 AXWebArea URL→CG window_id 是可用接缝；Browser.getWindowForTarget 不支持。

本人已通过官方 cloudflared access curl 的受支持凭据存储完成 https://smartshadow.ai/api/v2/session 验证。API 保留本人/机器区分、Origin 和业务授权。taskd 的无 case coordination GET409 由原负责人修复，部署前如实显示读取错误，不创建 case、Run 或绕机器身份。

## 本批实现

1. ManagementRuntime.workspace.open 接 launcher.openWorkbench(requestID)，不走 F6 或 HumanWindows.open。native 在发出 pipe 前保存 request_id 与 requested；同 ID 重入只查询、不再创建。一次运行只维护一扇工作台，已有窗口则绑定其 nonce/target/CG 身份，保留原请求关联；关闭后只对新的显式打开请求建窗。pipe 回执未知保留 unknown，不自动重发。
2. controller 生成随机 nonce，经已知有效 /plugins/installed?codexPlusWorkbench=nonce 请求原生新窗。唯一 target/默认 context 与完整 nonce 一致才认领。JS/Swift 人工窗口识别均排除 workbench 标记。无唯一结果只等待或报 unknown，绝不推断人工窗口归属。
3. 建窗后先以 request_id/nonce/instance/target 交 native，AXWebArea URL 精确匹配后取得 CG ID。复用正式 OCU right_display 一次布局及同 CG 只读 unknown 对账；不能调用虚拟屏或恢复旧几何。布局确认后仅该 target 导航原 Codex 首页，外层 URL 保留 nonce，等待原页面 ready，再装桌面专用任务看板。手机不加载该插件。
4. 看板是原页面中的可收起侧面板，保留原 Codex 会话/项目/输入组件。用 Shadow DOM 隔离样式、原生 button/select/table/label、可滚动表格和 textContent 渲染外部文本。页面 binding 只接受本次 nonce、当前工作台 target/default frame/context 与已知读取/打开会话操作，返回值只回同 context。导航销毁后不向新文档补交迟到结果。
5. 本批先读正式 repositories、issues、单 issue 与 coordination。controller execFile 固定 /opt/homebrew/bin/cloudflared access curl、固定 HTTPS base/Origin 和 GET endpoint；只接受规范 owner/repo、正整数 issue/page，不提供任意 URL、method、header、shell。凭据留工具支持存储，不访问 token/Cookie文件、不打印进程输出或原始认证URL。本人会话返回 authentication=cloudflare_access、非空主体后才读。非JSON/HTTP/认证失败显示准确不可用类别，不能当空列表。
6. 列表按 next_page 显式翻页，无隐式数量截断。只显示服务实际返回的 Issue 元数据；详情按用户选择读取，运行归属只取 coordination.actions 中真实 thread_id/run_id/state；无记录显示未观察到Run，读取错误单列。点击已有真实 thread 打开同工作台原 Codex 会话，不发送/恢复/新建Run。打开 registry 原thread 不能冒充 Run。首次实测前按返回 schema 收敛字段。
7. 原任务的人为任务决定/preview/confirm继续按taskd准确合同单独迁接，不在首批只读入口臆造审批。原 Codex 工具批准/拒绝已在手机原页面真实通过，不与taskd决定合并。

## 生命周期与恢复

独立检查的4项Major全部采纳：窗口与打开请求分开，每个新request_id建立指向同窗的独立查询关联，旧ID仍可读。native在pipe写前登记；仅确认未提交才返回workspace_unavailable，写出或可能写出后均accepted并保留requested/unknown。无响应不能清pending、换ID自动建窗。

controller沿已有0600 state.json保存非秘密workbench窗口身份和requests（request_id、origin_runtime、nonce、target、CG ID、phase），不新增业务存储。启动先核旧controller已退出，再对同hostPID的旧nonce/target精确只读对账；找到唯一旧窗则复用，捕获过CG ID只检查同CG完整右屏frame，绝不重复布局。target丢失须native再核CG窗口实际消失才closed。没有捕获target的旧建窗unknown持续找同nonce；其原宿主退出才能确证不会迟到建窗，在此之前不新建。关闭已知准确旧窗或原宿主退出后，新显式请求才可创建。

在创建原生窗IPC发出前，先将nonce/creating写入原state.json并完成原子rename；窗口识别和布局分两步：native先只读返回identified/CG ID，controller原子保存target/CG/placementDispatched后才发送一次place。重启只发inspect；不能因native尚未保存其内存布局记录而重放。native的同一队列保存effectDispatched，heartbeat只检查布局结果。

Manager在runtime_changed后先读取新实例身份，再以新expected_runtime只读查询原query_request_id。仅响应中的origin_runtime匹配原请求且phase为已证ready/failed/closed时解除旧pending；无记录仍unknown。重开Manager恢复记录时沿origin_runtime，不能把原unknown变成新请求。第一批运行侧与Core/Manager这一小接缝同时交付，管理布局和模块控制仍归#613。

API字段正本为Smart Shadow service/src/event-workspace/api.ts和service/src/github-system/coordination-api.ts及mcp.ts。GET路径为/api/v2/event-workspace/repositories、/issues、/issues/:number、/issues/:number/coordination；后者外层coordination.actions含host_id/thread_id/run_id/state。当前本地宿主host_id必须沿官方实际绑定核实，其他host仅显示归属，不强开local会话。

- 管理App退出只关闭自己的IPC；不触发工作台/手机/controller停止。工作台用户关闭仅丢失其UI；controller读实际target消失后标closed，手机和原Run不受影响。管理状态带真实request_id/nonce/target/window/phase，不能把发送ACK当ready。
- Plus正常退出只清理自己创建的准确工作台和手机anchor，不关闭官方宿主/人工窗口或取消原Run；若无法确认target消失保留unknown元数据。重启前旧controller完整退出；新运行不可继承旧request为已成功，不自动重放创建。
- controller断线或没有受支持宿主不调用人工F6作为fallback；workspace.open给明确unavailable。恢复沿原生命周期/签名安装回滚，不降级官方Codex、不重启共享OCU/taskd。

## 可观察验收

纯协议检查覆盖nonce/人工窗排除、请求关联、外部文本与API地址验证、同ID无重复、迟到context不交付。真实签名安装后从Manager打开一扇独立原窗，读回同request→nonce→target→CG→右屏→原页面/真实任务；实际选择#578，观察coordination已部署修复或真实错误；有真实Run才进入其原会话。打开/关闭工作台期间核手机原聊天/未发M草稿/后台Run与人工窗；Manager重开复用既有90秒Run隔离证据，改动影响时定向补验。保持原案开放，不把本批只读链路称作全部interactiond完成。
