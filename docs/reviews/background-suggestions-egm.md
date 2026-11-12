# 后台建议自动发送独立评审

2026-11-12，主owner chat 01a1ce59-86c7-7be3-b6f5-2594bff9b46f。GSE内置EGM，reviewer使用fork_turns=none，行为只读；宿主工具未强制文件系统只读。均实读候选及必要官方原生来源。

候选日志：~/Library/Logs/codex-plus/background-suggestion-20261112/PLAN.md。A哈希a4d962dda6a19f971c33205d2f9c3bb2ceb9db7fbf0fe231d8bb2aca6ff7de86。

- background_readiness：0 Blocker，2 Major。R1：先查跨窗口草稿后native准备多次await，快照会过期。R2：5秒租约不能代表控制器当前在线/开关即时撤销。PROPOSE FIX：每次原生assert向当下控制器申请新许可，跨窗口重查、超时拒绝，明确最终许可后不可消除的在途边界。
- background_critic：0 Blocker/Major，1 Nit。建议统一native live路径，移除DOM Tab/Send并行执行器。PROPOSE FIX：采用，native全局事件覆盖前台和后台聊天；只保留一个发送路径和claim。
- background_recheck：实读候选B及五个native模块，0 Blocker/Major/Nit，允许进入实现。确认native乐观轮后还有两次异步assert，native client设置继承和草稿作用域有依据。

来源范围：J8Ro全局turn-completed/live/cache写入；K6lt client/startTurnWithOutcome/原生prepare及assert；TSib持久/现存composer草稿附件；V3rO alias；Sd8U scope；现有controller与suggestion-auto-send。模型/总token工具未提供。评审通过只代表设计可实施，安装和真实后台续轮证据另列acceptance。

首个候选代码reviewer在共享官方宿主正常冷启动时中断，未返回报告，记为not run/incomplete；重新启动fresh-context的background_code_review2，不能把前者当作通过。

代码复核background_code_review2发现P1：global host scope无法直接ZY查找RouteScope下的ComposerScope。PROPOSE FIX：改为只读遍历root.retainedScopeEntries，按target alias筛canonical node，用GNwQ.GB构造临时读取包装检查rD；不新增scope、不增加持久订阅、不延长native生命周期。曾考虑的weak wrapper/node方案因原生临时克隆可提前GC而弃用，未构建/安装。新增依赖哈希和跨route原生节点形状回归。background_scope_recheck定向复审0 Blocker/Major，7项定向测试通过。原生读取可短暂同步订阅atom后立即取消，imperativeReadDepth阻止额外retain。
