# 窗口独立侧栏与屏幕记忆

用户要求：每个 Codex 窗口独立展开/折叠；按物理屏幕记忆布局；完成安装和真实双窗口验收。

基线：3ea9fe3（树与 a631f12 相同），规范 checkout 无未提交修改，当前宿主 /Applications/ChatGPT.app 26.1111.21308，Plus 0.7.0 build21；控制器已有两个主页面。宿主 907538.0572f09d40.js 中 RFDv 管理内置分区、项目展开和项目列表展开，jFzS 的 iL 将自定义分区 collapse 提交到账号共享服务。现有内存响应适配与原生 nz(scope,hostId,client,...) 提供 AppScope 接入；不修改官方磁盘包。

## 决定

同一 Plus owner/controller 管理新功能。固定原始资源 SHA256 与结构守卫下，替换 RFDv 中三个持久 atom/family 为页面内原生响应式 atom/family（使用原生 T1 + ouEa.eU signal wrapper 延迟初始化，首次 scope 解析时才读原生基线；配置前 ensure/get 避免未解析默认值），原生读值仅作首次基线；所有相应 setter 写扩展快照。jFzS 的公开 Y 派生状态只覆盖 collapsedSectionIds，保持分区成员、顺序、重命名和删除的原生服务；iL 只写页面内 custom atom，账号 ID 分隔自定义分区覆盖。导航主动展开仍调用同一窗口内的原生 setter。键盘导航和可访问性沿原生模型。不以 CSS 隐藏列表。

窗口快照存独立 sessionStorage 键 codex-plus.sidebar-window.v1，包含版本、屏幕 UUID、有限展开数据；不含聊天正文或凭据。复用原生 nz 入口绑定 AppScope，以便控制器切屏时更新响应式 atom；不依赖自动发送开关。窗口重载在同屏恢复自身快照。

Swift owner 通过现有 stdin 每秒发系统显示器列表（CGDisplayBounds、ColorSync UUID、名称），复用 CodexWorkspaceDisplayCatalog。controller 在已核主 frame/default context 中只读 screenX/screenY/outerWidth/outerHeight 获取每个主 target 的窗口矩形（真实两主页面为 WebContentsView，Browser.getWindowForTarget 实测不可用），要求四个值均有限、宽高为正，再按中心唯一匹配可用唯一 UUID 的屏幕；renderer 与 CGDisplayBounds 均为全局左上坐标，当前两屏负坐标已实测一致。同屏已有窗口互不广播状态；新窗口、移入屏幕的窗口采用该屏幕最近一次用户改动保存的快照。没有屏幕快照时延续窗口布局。显示器名变化不改变 UUID 键；断开保留快照；未知/镜像歧义不写屏幕快照，窗口内独立状态继续工作。

屏幕快照由唯一 controller 写入 ~/Library/Application Support/codex-plus/launcher/sidebar-layouts.json，原子替换，串行写；每个屏幕保存最新窗口布局。页面修改只发变化键和值及本页版本，经既有 CDP binding 的主 frame/default context 身份核对后，controller 重新读取几何并同步屏幕，再保存当前快照。每页同步串行，窗口移动与点击交错时在目标屏幕布局上重新应用本次变化，避免把旧屏幕布局覆盖到新屏幕。配置与恢复不回写成用户操作。文件写失败保留内存与窗口状态并报告 degraded，绝不清空已有文件。

## 生命周期、恢复与范围

旧已加载页面需要重载后接入；不强退宿主，不关闭用户窗口。安装前从设置暂时关闭自动发送以便走已有重新接入功能，完成后恢复原偏好。原生草稿/附件及对话框沿已有重连接入检查。既有检查不读取执行中状态；允许已有后台任务继续运行时重新加载空编辑器页面，任务执行由原生后端持有，验收同时证明此开发任务跨重载继续运行；若原入口不能安全重载则修复原入口，不强制 Page.reload 绕过检查。新 bridge 独立 protocol1，reconnectEnhancements 的待重载选择和最终 readiness 同时检查后台 protocol5 与新 bridge protocol1/bound；旧后台 protocol5 但没有新 bridge 必须重载。控制器读回 ready 后才能报告接入。未知宿主原文放行，仅此功能 unavailable。停用 Plus 停止屏幕保存；已加载页面内独立 atom 保持到原生重载，下一次无 Plus 重载回原生偏好。回滚使用 scripts/install 保留的旧安装。无新权限、外部服务或永久后台进程。

## 实施与验收

实现 runtime/适配、Swift 显示器消息与 controller 单写入协调，设置只展示状态并说明自动记忆行为；版本更新。定向 Node 测试覆盖双窗口隔离、同屏不广播、屏幕移动恢复、reload、自定义账号隔离、全新屏幕/断连/存储异常、移动点击交错、固定源码适配与语法、原生共享 setter 不再被调用。Swift 显示器来源复用已验收逻辑。运行 scripts/test，签名 build/install，绑定候选与安装摘要。

官方 OCU 操作安装版设置与两个 Codex 窗口：外屏展开 Smart Shadow 折叠 Projects，右屏反向，逐窗口读回；切换任务与窗口不串扰；移动窗口到另一块屏幕恢复对应布局、移回恢复；重载/重开恢复并验证原生内容正常。用只读 CDP/AX 补充窗口、屏幕和原生 aria-expanded 状态证据，不代替 GUI 输入；需要全局或真实硬件输入时走既有 KVM。保留两个正常窗口及用户期待布局。最后 commit/push/PR/merge 并记录真实验收与限制。

## 明确契约与取舍（初审修订）

CSS 隐藏会留下错误的导航/可访问性状态；共享偏好后再补偿仍会广播并竞争；替换整个侧栏会增加原生功能维护成本。选择只改原生响应式状态和折叠 setter，复用布局、导航及内容数据。单 controller 文件写入复用现有 owner，避免各窗口竞写同一持久文件；不新增另一个进程。

快照 schema：{version:1,windowId:string|null,displayKey:UUID|null,values:Record<string,boolean|null|Builtin>}。Builtin 仅含 chats/cloud/pinned/threads 布尔字段。键仅允许 builtin、list、project:<原生规范化存储键>、custom:<JSON编码[accountId,sectionId]>；自定义值必须 boolean，项目值 boolean/null。屏幕文件 {version:1,profiles:Record<UUID,{values:Record}>}。未知版本/类型拒绝，坏文件保留、不覆盖并报告；读写失败保持窗口内内存工作。仅保存标识与展开值，不存标题/正文。

运行时 bootstrap 创建随机 pageId，每个文档内修改序号递增。绑定请求 {version:1,pageId,sequence,change:{key,value}}（builtin 的 value 只含实际变动字段；页面保留完整 builtin，configure 在目标 profile 上合并字段）；controller 必须核默认主 context、当前 pageId 及严格递增 sequence。每页同步队列串行，执行时再次核 context/pageId，丢弃旧文档事件。configure({pageId,windowId,displayKey,profile,change?}) 仅对匹配 pageId 生效，返回状态快照；配置不触发修改事件。windowId 取 CDP targetId，防新窗口复制 opener 的 sessionStorage；同 target 同屏重载优先本窗口快照，其次屏幕快照，其次初始化原生基线。新 target 或切屏采用目标屏幕快照；无快照保留当前布局。显示器断开/未知时 displayKey=null，保留快照 values，但不能向先前屏幕保存；重连按屏幕恢复。新文档尚未绑定时的变化留在本窗口，首轮绑定后由明确后续变化保存，不拿初始化过程污染屏幕模板。

文件边界：新增 Sources/CodexPlus/Resources/sidebar-layout.mjs（可序列化页面 runtime、固定源适配和几何/持久化工具），controller.mjs 接入响应适配、binding、同步/保存、readiness；CodexLauncher.swift 发显示器目录并暴露状态；CodexPlusApp.swift 展示状态和存储说明；Tests/sidebar-layout.test.mjs 定向回归；AppInfo.plist 升版本；README.md/docs/acceptance.md 记录用户行为与候选实证。先以 runtime/seam 测试验证隔离和恢复，再集成完整 scripts/test，最后签名安装并实际交互；不另设人工阶段审批。


## 实施后的实际接入与验收

已交付0.8.0 build23。窗口移动使用 Codex Plus 已集成的安装版 Dock Switch 窗口定位CLI临时移动，不改保存规则；可见操作/原生菜单与设置沿官方 OCU，读取窗口元数据和 CDP 只作补充证据。guarded recovery 是产品已有恢复动作，经完整空编辑器/无附件/无对话框/无新输入检查后才重载；不使用无保护的Page.reload。实际结果、候选签名与边界见 ../acceptance.md 本版本段。新原生窗口被已有项目登记任务复用后按共享现场交接保留。
