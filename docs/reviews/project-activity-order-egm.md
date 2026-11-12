# Project 自动排序 EGM 评审

日期：2026-11-10；工程：Codex Plus；执行电脑：sol。
目标：[Project 按任务更新自动排序方案](../designs/project-activity-order.md)。

## 2026-11-10 原型历史结论

阶段 A 原型已完成真实交互验收，结论为未通过：前台更新时间排序与原生导航有效，后台完成后的项目置顶、主 frame reload 自动恢复选中聊天仍有缺口。测试草稿和聊天数据保持完整，正常重启恢复原生手动顺序及关闭调试监听已验证。

已恢复原生产实例与 Codex Plus 0.2.0 的正常运行态；供应商安装包保持原签名，未发布自动排序功能。阶段 B 未启动。下文保留初始设计评审、原型回归与真实失败证据。

## 评审方法与来源

采用 [EGM auto-review](https://github.com/google/elephant-goldfish-model) 的独立方案评审：两名 fresh-context、只读 reviewer 分别审查设计与实施准备；修订后由第三名 fresh-context reviewer 聚焦复核。均由原生 `collaboration.spawn_agent` 创建，`fork_turns="none"`，未传递父对话或个人 memory。

各 reviewer 实际读取对应 persona、feature-spec / implementation-readiness 标准和目标文档。复核 reviewer 另经官方 GitHub 连接器读取固定提交的 `qqheling/codexplusplus/cdp.rs` 与 `b-nnett/codex-plusplus/sidebar-adapter.js`，并核对 Electron 发布与 CDP Fetch 官方协议。源链接见[来源记录](../research/project-order-sources.md)。

本机 Skill：`/Users/longbiao/.codex/plugins/cache/created-by-me-remote/egm/0.1.2/skills/egm-auto-review/SKILL.md`。

| 审阅实例 | 范围 | 结果 |
| --- | --- | --- |
| `/root/egm_design` | 行为、架构、替代方案、风险和验收 | 阶段 A 可进入原型；两项语义 Nit 进入修订 |
| `/root/egm_readiness` | 工程基线、阶段 A 可执行性、B 的条件披露 | 两项 Major：依赖/路径固定、隔离载体/故障矩阵；一项来源定位 Nit |
| `/root/egm_focused_recheck` | 修订项及其影响的架构/来源/恢复 | Blocker 0、Major 0、Nit 0；阶段 A 具备执行约定 |

模型/推理档位沿原生 reviewer 默认继承，工具结果未提供独立模型身份读回。

## 已关闭的意见

| 意见 | 修订结果 |
| --- | --- |
| 阶段 A 依赖与文件边界留有实施选择 | 固定 Node 最低版本、Acorn 8.15.0、Electron 45.2.3、lockfile v3、清单/锁文件/缓存安装路径及脚本参数 |
| 隔离测试载体和故障复现含糊 | 明确自有 Electron app:// fixture、隐藏窗口、独立 userData、数据夹具；补齐断连、晚 attach、窗口重建和失配的触发/通过/清理矩阵 |
| 未知项目占位规则 | 首次未知固定原生槽位；已知项目填充其余槽位；补三项目示例与元数据恢复规则 |
| 断连与已执行脚本恢复时点 | 暂停响应按实测路径恢复；已执行适配经正常重启恢复；分别保留证据 |
| 研究缓存对评审环境的可达性 | 固定 commit 链接成为跨环境复核正本；复核 reviewer 实际取得两个主来源 |

## 待阶段 A 取得的证据

- 当前 26.1103.60933 宿主接受的 CDP 启动/端点发现、主 frame 身份、app:// Script 响应拦截和启动竞态。
- 原生有效时间对完成、报错、需输入等更新的实际传播；本地、远程、ChatGPT 和折叠项目分别记录覆盖。
- React 布局、可见顺序、键盘导航和交互锚点的一致性。
- 断连、reload、窗口重建、草稿与标签页恢复、正常重启回退及 listener 退出。

复核通过对应方案和下一原型的执行准备。阶段 B 发布与 Longbiao 最终接受各自保留独立验收记录。

## 文档检查

本轮 `git diff --check` 和新增文档本地链接检查通过。产品源码保持原状，本轮验证范围为文档。

## 阶段 A 原型实施与验证

Longbiao 批准后已完成源码探测、隔离 fixture、CDP 原型和精确依赖清单。产品安装版仍为 Codex Plus 0.2.0。

| 检查 | 结果与覆盖 |
| --- | --- |
| 原有 Swift 基线 | `./scripts/test` 的 33 项测试通过 |
| 安装包静态接缝 | 26.1103.60933 的一个 sidebar model 资源唯一匹配，AST 改写与重新解析通过 |
| 源码与排序定向检查 | 正常结构、局部变量改名、重复安装、多义、结构缺失、未知项目槽位与稳定排序共 7 项通过 |
| late-attach | 原文先加载，重载后适配；任务更新后的投影及导航一致；停用后重载恢复原文 |
| response-disconnect | 暂停响应断连后原文继续；正常 draining/disable；转换故障后恢复原文 |
| source-mismatch | 零匹配/多匹配拒绝适配；真实响应放行且原模型继续运行 |
| window-recreate | 第二窗口独立适配与导航、重建后的适配、旧 generation 结果丢弃、renderer crash 恢复后的适配与导航均通过 |
| fixture 清理 | 每个自有 fixture 正常退出后，OS listener 检查通过；临时 userData 已回收 |
| 宿主退出保护 | 已运行宿主返回 `waiting-for-normal-exit`，当前现场保持 |

原型恢复复核由 `/root/probe_contract_review` 和 fresh-context `/root/probe_recovery_recheck` 完成，采用 GSE 内置 EGM 的执行就绪与设计批评标准。响应原文兜底、draining、host finally/PID/恢复报告、多窗口与过期结果断言已落实；聚焦复核 Blocker 0、Major 0、Nit 0。动态测试进一步核验连接关闭状态的同步更新。

本机证据：

- [静态接缝报告](/Users/longbiao/Library/Logs/codex-plus/project-order-probe-20261110/source.json)
- [四类动态场景报告](/Users/longbiao/Library/Logs/codex-plus/project-order-probe-20261110/fixture.json)
- [宿主保护状态](/Users/longbiao/Library/Logs/codex-plus/project-order-probe-20261110/host.json)
- [官方 GUI 工具阻塞](/Users/longbiao/Library/Logs/codex-plus/project-order-probe-20261110/tool-blocker.json)

### 真实宿主验收进展

用户要求 Agent 直接操作后，使用 iFurySt 维护的 Open Computer Use 1.1.2 原生 CLI 恢复了操作路径；双实例定位改用 agent-desktop 1.2.0 的明确窗口 ID。此前 MCP 连接报错与内置 CUA 拒绝记录保留为历史工具证据，未修改其安全设置。

同一 OpenAI 签名的 26.1103.60933 安装版，使用独立资料目录 `~/Library/Application Support/codex-plus/acceptance-20261110/` 启动。原宿主 PID 10053、app-server 10123 保持运行。独立 PID 99165 的调试监听归属与 loopback 已核验；应用自行取得现有登录状态，没有迁移 Cookie、token、登录文件或数据库。

通过真实 GUI 完成首次设置，建立 CP-A、CP-B、CP-C 三个本地测试项目，并分别取得 CP-C OK、CP-B OK、CP-A OK 回复。准备的草稿经过单窗口主 frame reload 后读回一致。原生 File → New Window 成功创建第二个独立实例窗口。

初次真实验收发现可见顺序仍是 C/B/A：`DZgh` 的模型投影被 `sHm2 → Rrp3.D8` 的原生手动顺序再次覆盖。修订增加最终布局 options 接缝，并把运行协议升级为 2。两个真实主窗口均已返回双接缝适配成功、无拦截错误，仍需真实可见排序、后台更新、导航及最终重启回退验收。

新增四类 fixture 布局回归通过，Pinned 与自定义区样本保持独立。EGM 定向复核另指出导航指标与多窗口覆盖问题，均已修订；随后收紧真实宿主固定路径和预审核完整 SHA-256，避免未知源码的两个独立接缝被误当作同一数据链。fixture 加入返回值断链、同名嵌套绑定、后续重赋、多义和重复适配反例。

期间系统自动进入显示器睡眠并锁屏；公开电源管理命令仅唤醒显示器，随后由 Longbiao 本人解锁。解锁后继续完成真实交互，没有绕过锁屏或复制认证材料。

最终原生 View → Next Sidebar Item 按可见 C/B/A 顺序选中测试聊天 C → B → A。reload 后窗口进入新聊天界面，未自动恢复原选中聊天；重选 A 后原测试草稿完整可见。正常退出独立实例 PID 99165 后，OS 检查确认端口 56399 不再监听；用同一独立资料目录、无调试参数正常启动为 PID 76238，显示原生 C/B/A，重选 A 后仍能读回原草稿。再向 A 发送只回复文本的恢复测试，得到 `CP-A RESTORE OK`，顺序继续 C/B/A，证明增强没有遗留为持续自动排序。

### 后续定向评审与裁决

| Reviewer | 发现与裁决 |
| --- | --- |
| `/root/layout_projection_review` | 两项 Major：项目导航证据应使用真实消费者；host 应覆盖全部主窗口。均修订并实际验证。 |
| `/root/layout_projection_recheck` | Major：两处唯一 AST 接缝不能独立证明同一数据链。真实宿主改为固定资源路径与预先审核 SHA-256，fixture 绑定直接模型链。 |
| `/root/source_binding_final_review` | Major：fixture 返回值、同名嵌套变量及后续重赋反例仍可误通过。增加顶层返回、同层 const 与写入排除及实际反例断言。 |
| `/root/direct_chain_recheck` | fresh-context 独立验证上述反例均被拒绝，baseline/改名仍适配，host 摘要检查保留；Blocker 0 / Major 0 / Nit 0。 |
| `/root/activity_clock_review` | 下一时间候选中的调用约定有一项 Blocker：RD 是通过 get 读取的响应式值。文档已改为 `get(module.RD,key)`；该候选未实施，A 的失败结论保留。 |

协议 2 候选的静态接缝检查与四类受控 fixture 有效；真实完成事件和选中恢复失败决定 A 不通过。这些结果不等于阶段 B 发布或 Longbiao 接受自动排序功能。

本轮证据位于 [project-order-live-20261110](/Users/longbiao/Library/Logs/codex-plus/project-order-live-20261110/)，包括 `host-layout.json`、`source-bound.json`、`fixture-layout.json`、`fixture-protocol2.json`、`fixture-data-chain-final.json` 和实际 GUI 截图。单一运行状态仍为 Codex Plus 0.2.0，当前产品源代码未改动。


## 2026-11-11 后续交付评审

用户批准继续修复并完成安装版验收，先前阶段A停止条件已被替代；历史失败记录保留。后续采用GSE内置EGM，fresh-context、只读、同一checkout主Agent单writer。模型/推理档位继承，独立模型身份与总token未由工具返回。

| Reviewer | 范围与结论 |
| --- | --- |
| /root/launcher_delivery_review | 早期暂停与失败恢复：B0/M2/N2；补齐首次执行次序和独立监督者。主进程inspect被官方fuse关闭，pipe断开退出宿主，均经实测排除；改用TCP browser自动附着。 |
| /root/browser_startup_review | TCP控制器及活动时间：B0/M3；修复多窗口全量覆盖、未知源码普通启动降级、在途响应停止竞争。 |
| /root/launcher_candidate_review | 修订候选与原生persistForReload接缝：B0/M0/N1；ledger长期增长列为非阻断后续维护项，未把静态通过当GUI通过。 |
| /root/route_and_f6_review | 实际useLocation路由、Karabiner唯一F6 owner、冷热入口与按PID布局：B0/M0/N0。实读官方固定资源，独立内存预览确认Karabiner恰四处命令改变。 |

真实测试另发现：persistForReload请求分支不覆盖侧栏点击，故撤回默认值修改，改为实际路由组件的effect；原生F6计数无回调的主因是已有Karabiner直接打开官方应用，撤回重复Carbon注册。协议6使用native qM状态selector及两个固定资源AST接缝；后台完成时钟、聊天/草稿恢复、冷热入口、重连、Dock及布局分别按安装版证明。当前验收与覆盖以[验收清单](../acceptance.md)及本机候选记录为准。
