# 当前任务统一统计

原案：Smart Shadow #578。用户要求小看板合并 Codex 当前工作与项目待办，按明确关联去重；手机仍使用原界面和原后台。本文补齐已安装的小看板，不改变服务生命周期或手机协议。

## 范围与身份

每次打开或手动刷新，同次读取 taskd 的 `tasks_read` 和现役原 Electron 的会话列表。Codex 候选只含 active、systemError；idle/notLoaded 是历史状态，不作为独立当前任务计数。taskd 已登记事项按 repository/number 计数，保留其完成状态；当前总数明确含此登记范围。来源失败时分别标识来源不可用，只显示已取得来源的计数并标注不完整，不把缺失当零。

保留 taskd action 的 host_id/thread_id/run_id 作为关联。读取正式 installed.json 中 taskd 当前配置的 host 小节，校验配置文件属当前用户且私有、source_commit 与本次 inspect 一致；仅当其中 hostname、binary/version、transport 的应用路径、launcher_state、资源摘要与原生进程核验全部一致时，建立该 host.id 到 local 的映射。映射缺失则不跨 host 合并。不靠标题、目录或分支猜。一个正在运行的 Codex 会话，如果其当前 Run 与某 action 的 thread_id/run_id 同时相符，就并入该事项；同会话先后服务不同事项不合并事项。没有匹配当前 Run 的候选保留为独立项。精确事项绑定优先于亲缘关系，不同事项永不因亲缘合并。仅当子会话来源给出准确父 Run/rootTurnId 且与已知父当前 Run 一致时才归并；只有 parentThreadId 时保留独立项并标明亲缘、关联待核实。父节点不可见时不递归猜测根身份。

active 会话经 `thread/read includeTurns:false` 复核当前状态，并通过原生 `thread/turns/list sortDirection:desc limit:1 itemsView:notLoaded` 取得最新 Run，不读取正文。已实测 thread/read includeTurns:true 会混有旧 inProgress，禁止据它遍历认定当前 Run。list 与复核间变为 idle/notLoaded 的条目移出当前独立计数；Run切换采用最新已证身份。原 API 没有足够证据时保留候选并标注待关联，宁可不确定也不错误合并。单项失败保留其余成功项，该项只显示“状态未知”且来源标记不完整，不把旧状态算为确认执行中。taskd 的完成数仍只认业务状态；存在活跃执行或待批准的并入会话时分别贡献运行／待处理计数，两个指示可重叠。

## 读取接缝

SmartShadowManager 启动一个短期只读 Node 读取器，使用现役原 App 的内置 Node、当前 launcher state 中的 loopback CDP，在已存在的人类原页面上短暂借用 appServerManagers。固定原应用版本、模块和原生后端摘要；核 PID/路径、CDP监听所有者及 app-server进程。没有身份匹配则报该来源不可用，不启动或恢复任何宿主。

读取器只执行 thread/list（全页、useStateDbOnly、当前账户）及 active/error 的无正文 thread/read 和最新 turn 元数据读取；从原后端返回后在页内投影 id/name/status/parent/currentRunId。不持久化会话列表、聊天正文或第二套状态。不使用手机专用页、不改变路由、不订阅thread、不调用resume/start/interrupt。一次读取结束或父进程取消均释放自身manager lease和CDP会话。脚本随独立Manager包安装，Plus/mobile资源不变。

## 验收与恢复

纯合并语义测试覆盖同Run去重、同thread不同Run不误合、父子跨事项不合并、无父Run不猜合并、结束竞态、单项读取失败、源失败非零、运行结束不等于业务完成。定向编译加现有CI；#613负责下一次Manager单包安装。安装版观察真实本轮会话与taskd事项，核准确计数和链接，关闭看板不影响原Run与手机连接。原版本若不匹配只关闭Codex来源，保留真实taskd读取。旧签名安装保留作回退。

## GSE核查记录

独立执行就绪与设计批评各读完整候选。首轮发现host映射来源、父子归并优先级、两阶段读取竞态及局部失败三类缺口；已补当前配置匹配、明确Run优先、来源不完整语义。两位定向复审均为0 Blocker/0 Major。真实只读探测已验证完整分页、当前Run元数据、原生3333/3406身份及取消退出；实现与安装证据另记验收文档。
