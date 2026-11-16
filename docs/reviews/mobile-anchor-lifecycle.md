# 手机宿主隐藏与生命周期独立审视

原需求及实现决定：smart-shadow#578 comment6905803763；失败准备r1见6905949138；裁决6905978228；r2见6906016587。原代码661657a；最终源码候选b1c9e179dfa292c401007a88551ff5570d57519c，合入a935d54db2a1a83c4e988961234004ef9f5d8646。

使用GSE内置EGM，行为只读、fresh-context（fork_turns=none），同一主writer。没有独立沙箱强制，只读为角色行为限制；模型/总token工具未提供，不推断多模型成本。

r1执行就绪与设计批评两人完整实读固定plan、controller create/settle/lifecycle/shutdown、MobileAccess、原生管理/launcher/退出及正式ss-service。意见归并：
1. 未知human nonce若仅入scope但未退出settle，resume后的晚到窗口可能被Page.navigate并破坏用户草稿。采纳：保留nonce/phase，证据文件写成功后permanent preserved，晚到回归禁止任何创建/导航/关闭。
2. 旧78已有active peer的frame不受quiesced阻挡，不能据此证明恢复前停流。采纳：#613保存原聊天/完整草稿后正式关闭模拟器App，读回connections=0才允许旧版恢复；80在frame入口拒绝新操作，排空已接受operations。
3. 从prepare_unknown直接套普通resume可能把startup中断、stopped或pending手机误报running，且与ss-service prepare_intent记录不兼容。取消该扩张：原生继续prepared-only；MobileAccess.resume对stopped/pending显式失败，旧78恢复交#613独立正式入口。

r2第三位fresh-context审查完整实读r2与b1c9e17全部差异、上述生产路径、两组回归及生命周期文稿。最终Blocker0/Major0/Nit0；确认排空后只读人窗观察、每代0600审计文件/native scope、永久preserved、frame gate与prepared-only相符。审查未操作服务/GUI或运行测试，不与安装验收混同。

实际检查：旧controller源码运行三项回归均失败；新27项相关Node检查通过；Debug编译、15项未变Core窗口/路由/管理协议有效证据、语法/plist/diff/Gitleaks通过；PR42及PR43各两项既有CI成功。正式签名/安装、真实尺寸/隐藏、手机读发流式/草稿及生命周期由#613原单writer另记，审查结果本身不证明这些已通过。
