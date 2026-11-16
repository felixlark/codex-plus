# OCU geometry provider / Plus consumer 配对采用候选

用户结果：正常新建的大尺寸 Chrome 窗口自动停放隐藏屏；明确归还时恢复真实原宽高和位置；登录/进程冷启动不依赖预热窗口。既有人工窗口不认领。Root 为唯一源码集成、构建、签名、安装、桌面与 provider runtime 操作者。

候选固定文件归 manifest.json。Plus 基线 e49713f 的三处未提交变更：启动 receipt 只接受 protocol=2、geometry=fit_restore_v1；将真实几何捕获/缩小/归还交给 provider；按窗口中心归属判断已生于 Agent 屏的大窗口，与原物理屏 origin 判据一致。Provider 的稳定源码/测试来自 /Users/longbiao/Library/Caches/codex-plus/ocu-geometry-projection/source，完整9路径差异及身份归 /Users/longbiao/Library/Logs/codex-plus/ocu-geometry-20261115/handoff.md、source-delta.patch、delta-manifest.json。Provider已完成30纯测试及独立设计/定向代码审查；这些不证明安装采用。Plus receipt定向5测试通过，中心判据随后调整，须完成最终定向验证与真实大窗验收。

约束：不从 canonical provider main 的无关 dirty 取包；将准确差异叠在已签名/PR3的相同基线树。保留现有 checkout/index/历史资源；使用缓存中的冻结源及私有 index。不要新建 worktree。不要接受旧receipt或通配。恢复信息只有完整确认或准确已关闭才释放，unknown不重放动作。只使用准确PID/window_id官方OCU，关闭自动读回及动画，再显式只读核验。TLS凭据留Keychain，不导出。手机断线不重发，已完成测试会话保留。无共享正式SS服务启停。

配对切换：
1. Root先完成本手机交互原子段并关闭本案DeviceHub临时窗口；核其他操作者均无桌面/provider lease。读回安装66、原vendor PID3333及准确人窗298/406；完整窗口与隐藏显示census。
2. 构建唯一新provider（Dev身份/同Team）与Plus67，先strict签名/hash验证，保留当前4B28/66备份。一个release build串行；iOS debug包另记候选。
3. 正常退出Plus，读回其controller/gateway和专用手机window确实结束，vendor/人工窗口保持。以当前namespace socket的agentInfo核owner，再用现有terminate正常退出旧provider；不kill、不预先调用新tool-list，不为维护强退其他session。
4. 原owner退出、显示消失后原子安装provider/Plus同批。由正常/Applications入口启动Plus，不先手工ensure或预热窗口。读取真实bootstrap2、唯一persistent namespace显示及新provider身份，配置仍enabled=true、restoreOnSessionEnd=false，随后新发现显示ID。
5. 从正常Chrome入口创建一扇本案新窗口，记录真实原始2048x1122或同类超屏尺寸/身份。自动停放必须实证完整在inset40区域内；明确restore核真实完整原frame；再park跨CLI断连保留。仅关闭该临时窗口，人工Chrome/Codex不动。若新窗继承隐藏屏位置也不得在委派前拒绝其大尺寸。
6. 手机原壳重连Mac原后台，核原会话/未发草稿、全端实际版本，业务不重放。检查login注册；进程冷启动和真实OS重启分别记证，本批不虚报实际整机重启。
7. 新provider有限观察不少于30分钟、至少3次footprint；同时做手机其他已授权验收，不添加常驻自动化或无关服务。当前provider4B28的旧30分钟采样不能替代新provider。

恢复：任一实际失败先正常停止新Plus，核准确业务/窗口副作用，再正常退出新provider、恢复已核旧4B28/66配对，strict签名/hash回读后从正常入口启动。保留unknown及恢复记录，不在老provider上运行新consumer的自动重试。任何人工窗口不作为恢复搬动目标。Root处理源码/安装/PR3及PR23并按真实范围回写证据；没有安装证据不标采用或关单。

只读审视问题：新旧协议是否准确配对、原frame是否在首次AX写前由唯一owner记录、超大窗/原生于虚拟屏/物理屏消失/身份未知的恢复是否具体可执行、当前消费者是否尚有拒绝大窗或提前释放信息的路径。给出Blocker/Major/Nit、位置、触发、后果、证据与最小修订；不做GUI/构建/源码或index写入。
