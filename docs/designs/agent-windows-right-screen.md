# Agent 窗口归最右物理屏

2026-11-15 本人明确退役所有 OCU 虚拟屏，Agent 派生窗口改归最右物理屏。原移动端、人工窗口、草稿与运行保持。全局 OCU 配置和提供方退役由原负责人处理，Plus 原负责人只迁消费者，不重启共享 OCU。

## 实施边界

- Plus 不再创建、确保、发现或恢复 OCU 虚拟屏，也不调用其停放／归还协议。删除零消费者的 startup recovery 和对应专用测试；普通 OCU 客户端只核准确窗口与新 right_display 能力，执行一次右屏请求。通用窗口身份桥仍被 HumanWindows 消费，保留。
- 每次请求从当前在线、非镜像的物理显示器选择横坐标最大的屏幕；同横坐标用最右边界及稳定 ID 排序。使用该屏的可用区域，保留原尺寸直至超过可用区域才缩小，居中后实际读回完整 frame。
- 只认准确 PID、启动时间、CG window_id 与 AX 窗口。显式 tool-place 和本次 tool-open 的文件身份／建窗差量可以授权归属；既有人工窗口不迁。Chrome 不再对所有后续新窗自动认领，Agent 浏览器沿准确窗口入口迁右屏。
- 手机专用窗口在原nonce文档阶段先把anchor/instance/target交原生主体；仅匹配唯一AXWebArea URL与准确CG窗口后请求right_display。实际右屏布局回读后，只对该手机窗口请求一次1×1显示点尺寸并最小化；同时核AXMinimized=true和完整CG onscreen清单不含此窗口，才以同组身份回执，controller再将同一target切到隔离空白页并开网关。过期回执或unknown不继续导航、不重建、不重放缩窗或最小化。人工窗口仍受通用tool-place保护。
- 原五设置字段暂保留管理协议兼容，chromeUsesAgentDisplay 表示明确 Agent Chrome 窗口的右屏路由，不表示虚拟屏或全进程认领。管理 App 文案由其原负责人对齐。
- 官方 OCU right_display 负责一次布局请求；Plus 在请求前核PID/启动时间/准确窗口，完成后独立读回当前右屏及完整frame。不把 AX 返回错误当未执行重试。已派出的文件布局请求即消费，未确认保留准确请求与状态，不自动重放。用户后续移动后释放本地路由记录，不拉回。
- 停止 Plus 只停止其观察与释放自有路由记录，Agent 窗口保持右屏，不再归还到旧虚拟屏／原屏。旧 tool-restore 兼容入口只释放该准确窗口路由，明确返回 released，不报告几何恢复。
- 自有 Agent 设置窗直接放到最右物理屏，无 OCU 登记或虚拟屏 pin。原 Settings 到独立 SmartShadow 管理 App 的迁接仍按已有管理交付进行。

## 验收

### 手机专用宿主不占屏（2026-11-16增量）

用户要求空白宿主尽量缩到一个像素、不干扰屏幕。准确26.1111.21308原主窗`getPrimaryMinimumSize()`返回480×600，`syncPrimaryMinimumSize`会重新设置主窗下限；不改厂商包或全App的最小尺寸。实际窗口尺寸可能被该下限或标题栏约束夹住，不能把AX resize返回0写成1×1已经生效。`--tool-status`的`mobilePresentation`记录一次请求的AX结果、CG实际frame、显示点单位及`onePointSizeAccepted`，不把显示点冒称物理像素。

无论缩窗能否达到1×1，正常路径最小化同一独立宿主，不关闭、不导航、不重建它来隐藏窗口。WindowServer的`optionIncludingWindow`在本机不返回最小化Electron窗口，身份查询改为完整`optionAll`后精确匹配ID；对最小化窗口也会省略`kCGWindowIsOnscreen`键，因此隐藏验收使用成功的完整onscreen清单与AXMinimized交叉读回；查询失败保持unconfirmed，后续仅只读对账。用户主动从Dock恢复后不循环抢回/最小化；正式状态重新读回可反映当前可见性。普通Agent工具窗口仍按原右屏规则，手机的尺寸/最小化行为不推广到其他窗口。

安装验收由#613唯一操作者：核固定候选/签名与当前草稿/Run→正式切换→新宿主自动右屏及最小化→读实际frame/两种隐藏证据→原手机一次Reconnect恢复同聊天/完整未发草稿→真实唯一消息与流式、Mac同thread对账。复用已完成行为证据，不重放旧unknown。切换会正常重建本服务自有资源，该事实与“最小化动作保留同一现役宿主”分开记证。本次局部呈现/有限停机流程沿相称影响面复用已有资源证据，不新增常驻循环或冒称80已新做30分钟观察。

80已由#613正式签名安装，两次启动均自动最小化；实际1×1请求被夹至480×600，AXMinimized与完整onscreen清单双证据确认隐藏。手机原聊天/完整草稿、新唯一文字消息及正常prepare/resume/stop/start通过，详见[正式验收](../acceptance.md)。更早78经官方OCU最小化同窗时target/instance/gateway与connections=1保持；该证据与新80自动路径分开，79未单独安装。

源码确认零 OCU 虚拟屏消费者；定向纯逻辑检查覆盖物理屏选择、负坐标、窗口尺寸、无屏与身份。签名安装后用官方 OCU 核实际外部tool-place、新文件tool-open、已打开文件保持人工窗、路由观察期间新建人工Chrome不被认领、用户移动后不拉回、tool-restore只返回released且几何不变；AX部分成功/unknown不自动重放。自有设置窗另验，不能代替外部窗口路径。人工Codex两窗不动。

正常退出重开Plus会断开其手机网关；验收绑定原聊天、原Run和草稿，要求准确断线提示、手动重连且无自动Send，不声称服务不断线。首条正式链路优先，复用已有手机有效证据；30分钟/3次footprint及扩展覆盖继续记录，不作为先用前置。旧几何原型证据保留历史，不能当本批新路线通过。

## 旧运行交接与独立检查

独立GSE检查发现的两项Major均采纳：旧恢复记录迁接顺序、外部窗口真实验收缺口。现役Plus67已通过正式tool-routing暂停，读回enabled=false/startupRecovery=paused/watchedProcesses=0；未发新的虚拟屏动作。旧8253已由官方OCU确认不再是Chrome当前窗口，不重放其未知停放。Native68旧路线构建只留候选，不安装。

OCU退役负责人接手准确Agent三窗6173/7204/7093，先核旧记录与在途动作，解除旧恢复/pin，再用新right_display迁位，最后退役显示器并重新发现物理屏核位；Root不同时操窗。人工298/406保持。新提供方安装、三窗迁位及旧记录已解除的实际回执到位后，Plus再正常退出和切换，不能靠旧stop隐式迁移。恢复不能重开旧虚拟屏；必要修复沿新物理屏路线继续。
