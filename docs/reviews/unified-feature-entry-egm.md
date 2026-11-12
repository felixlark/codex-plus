# 统一功能入口方案独立评审

- 日期：2026-11-12，Asia/Shanghai。
- 设计：[统一功能入口与页面贪吃蛇](../designs/unified-feature-entry.md)。
- 基线：`89fed51`；独立评审输入 v1，评审修订 v2；用户位置纠正后的当前设计为 v3。
- 范围：方案设计与实施就绪；本轮未实施、构建、安装或验收产品。
- 方法：GSE 内置 EGM（Google Elephant-Goldfish Model 的本地适配，用独立新读者检查方案缺口）。主 Agent 起草和裁决，两名新上下文子代理只读审视。使用 `spawn_agent`，`fork_turns=none`，未覆盖继承的模型设置；工具未报告 reviewer 实际 model ID、推理档位或 token，记未知。文件系统共享，只读由任务约束，非沙箱强制隔离。

## 读取和结果

| 检查 | 子代理 | 实际读取 | 结果 |
| --- | --- | --- | --- |
| 设计批评 | `/root/entry_design_review` | v1 全文，EGM design_critic 与 feature-spec-standard，仓根 AGENTS，controller.mjs、CodexLauncher.swift、CodexPlusApp.swift、inspect-sidebar-model.mjs | Blocker 0、Major 0、Nit 1；指定读取完整。 |
| 执行就绪 | `/root/entry_readiness_review` | v1 全文，EGM implementation_readiness 与 implementation-readiness-standard，仓根 AGENTS，CodexPlusApp.swift、CodexLauncher.swift、controller.mjs、scripts/build、scripts/test、Tests/project-activity.test.mjs；补读 inspect-sidebar-model.mjs 前 90 行 | Blocker 0、Major 0、Nit 1；指定读取完整。 |

两个 reviewer 均未调用 GUI、网络、历史或个人记忆，也未写入文件或运行构建测试。安装版身份和现场状态沿用主 Agent 当次采集；独立检查针对设计及源码。

## 发现与裁决

| ID | 来源／级别 | 发现、证据与修订 | 裁决 |
| --- | --- | --- | --- |
| ENTRY-01 | 设计批评／Nit | 同版安装复用实例与崩溃重连重置局面存在歧义。controller.mjs 的连接关闭会退出，页面可能仍存活。v2 明确：仅同一有效连接内复用；重连即使同版也清理旧请求、旧游戏并重绑。 | PROPOSE FIX，已修订设计第 4.1 节；普通契约澄清，主 Agent 复核。 |
| ENTRY-02 | 执行就绪／Nit | 旧措辞可能暗示 F6 会恢复已支持宿主版本。CodexLauncher 使用固定 appURL，F6 启动当前安装版。v2 区分普通启动未接入与未知版本，未知版本先适配并安装 Plus 候选。 | PROPOSE FIX，已修订设计第 5 节；主 Agent 对照启动器复核。 |

两项修订明确了已有恢复合同，未改变架构和功能范围；复用初审其余覆盖，无需新增独立轮次。未宣称连续 clean 收敛。

## 用户位置纠正（v3）

用户明确「是在侧边栏左下角第一个」。设计据此将 Codex Plus 定位为侧边栏左下角按钮区第一项，贪吃蛇沿用同一底部按钮区末位；同步修正示意、容器定位和滚动／位置验收。此次是对用户明确位置的纠正，主 Agent 定向核对，未重跑独立评审；前述评审结论的候选范围仍为 v1/v2，其余架构覆盖继续复用。

## 交付边界

用户随后批准实施、安装和真实界面验收。实际候选、覆盖及正常现场见 `docs/acceptance.md` 的 0.4.0 节；用户最终接受及既有 Issue 验收维持开放。

## 实施候选检查

`/root/implementation_review` 使用 `fork_turns=none` 只读检查原生消息管道、controller、页面入口、游戏、版本适配、测试和设计；完整指定读取，无正式新增 Blocker／Major／Nit。实际执行 7 项定向 Node 检查通过；未操作 GUI、未写文件，实际模型／token 未由工具报告。

主 Agent 的真实截图和交互验收发现弹窗样式受宿主重置影响，以及同页新建聊天的清理缺口；已修复主题 token、显式居中、完整 location 对象订阅和快捷键处理。0.4.0 build 6 的浅深色截图、同页 ⌘N、Esc、暂停、冷启动、多窗口、控制器恢复和退出清理用真实安装版定向复验；后续普通修正由主 Agent 实证复核。排序 fixture 初始空白 frame 的读取竞态通过等待实际导航修复，4 类场景均有通过证据。完整测试为 10 项 Node、33 项 Swift。
