宿主现在可在移动任何窗口前创建或复用持久 OCU 虚拟屏，并先取得原窗口完整尺寸。Agent 窗口按屏幕可用区域缩放，归还时恢复完整原尺寸；原显示器与边界仍匹配时精确还原，否则选择能容纳原尺寸和 40pt 边距的物理显示器。身份或完整 frame 未确认时保留准确记录，未知结果不重放。

`ensure_agent_display` 返回 protocol 2 / `fit_restore_v1`，使消费端可以拒绝缺少完整 frame 语义的旧实现。Chrome 原有窗口只在真实 AX 基线与进程启动身份核实后加入观察；无法观察不产生新窗口认领。变更仅包含准确几何、持久显示启动及对应测试和文档，canonical 其他输入/滚动改动未带入。

验证：34 项受影响纯逻辑测试通过，独立最终源码复核无遗留问题。安装签名候选 4325DA3E-8419-4D2C-8C07-56EAD21BF3F4 后，Codex Plus 67 在 provider 和显示器均未运行时自动启动并取得严格 protocol 2 ready；真实 Chrome 窗口 2048×1122 缩至 1840×1000 后精确恢复；出生于隐藏屏的 1920×1050 窗口完整归还到可容纳它的物理显示器，原三个人工 Chrome 窗口不变。该 provider 连续运行 1805 秒，四次 footprint 为 13/13/16/23 MB。证据保留在本机 `~/Library/Logs/codex-plus/ocu-geometry-20261115/`，不把私密桌面证据写入工程 Git。

### 新增限制

持久启动入口要求现有配置 `virtualDisplay.enabled=true`、`restoreOnSessionEnd=false`；缺失、损坏或瞬态配置在创建前拒绝。准确 PID/window、启动身份及完整 frame 核验沿窗口归属合同，未增加资源并发、负载、退避或业务准入限制。
