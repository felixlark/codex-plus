# 窗口侧栏独立与屏幕记忆审查

方案基线 3ea9fe3，设计见 ../designs/window-sidebar-layout.md。采用 GSE 内置独立新上下文审查；reviewer 仅行为约束只读，未隔离文件系统，未读取个人 memory 或历史聊天。

初审执行就绪与设计批评各一位，实际读方案、指定角色/标准和受影响来源。有效问题：真实主页面为 WebContentsView，Browser.getWindowForTarget 不可用；旧 protocol5 页不会加载新 bridge；原重连检查不覆盖执行轮次；快照/增量/文档代际契约欠明确。已改为 renderer 几何加系统 UUID 匹配、双 bridge 重载与 ready、明确后端任务继续时空编辑器可重载的语义，补齐 schema/pageId/sequence/targetId。补充实现文件边界和有意义的接入取舍。第三位 fresh-context reviewer 定向复核后零有效 Blocker/Major。

代码独立审查核对实际官方资源 RFDv/jFzS/Nwp9/kpIY/OWtl 与作用域实现，发现并接受两项：

- P1：初始化时直接读 kpIY.TB 可能早于原生持久化初始化。改为原生 T1 + ouEa.eU 的 signal wrapper，在 scope resolve 时求初值；configure/set 先读取确保基线已初始化。
- P2：切屏并发点击内置分区时重放整张 builtin 会覆盖目标屏幕其他分区。改为仅广播实际变化字段，配置时在目标屏幕快照上合并。

新增回归分别重现原失败。修改后同一独立 reviewer 只读定向复核上述差量与依赖，核实 T1→Nmf8.T 缓存契约，未发现新增 P1/P2，两项关闭。reviewer 未替代真实安装/GUI验收。主负责人运行59项Node与42项Swift测试全通过，签名构建并安装0.8.0 build23；GUI业务证据单列 docs/acceptance.md。

未声称跨版本支持、模型多样性、成本节省或固定轮次收敛；官方源码摘要变化时仅此适配降级。
