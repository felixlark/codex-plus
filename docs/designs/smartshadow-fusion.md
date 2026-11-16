# SmartShadow 单包与独立交互后台

依据 [#613 用户定案 r2/r3](https://github.com/felixlark/smart-shadow/issues/613#issuecomment-6906325173)、[#578 切片](https://github.com/felixlark/smart-shadow/issues/578#issuecomment-6906331071)和[安装合同](https://github.com/felixlark/smart-shadow/issues/578#issuecomment-6906497695)。#578交付唯一源码与接口，#613交付正式安装切换、单仓迁入和最终退役。现役 Plus80 保留至新包实际验收。

## 一个安装入口，两个进程

|项目|固定接口|
|---|---|
|容器|`/Applications/SmartShadow.app`，`me.longbiaochen.smart-shadow.app`|
|主可执行|`Contents/MacOS/SmartShadowManager`|
|后台 bundle|`Contents/Library/LoginItems/SmartShadowInteraction.app`|
|后台身份|`me.longbiaochen.smart-shadow.interactiond`|
|后台可执行|`Contents/Library/LoginItems/SmartShadowInteraction.app/Contents/MacOS/SmartShadowInteraction`|
|后台资源|helper 的 `Contents/Resources`|
|签名|主包/helper分别 Developer ID Team `HJG65XBC25`，先内后外；PID核helper身份|
|版本|主App/helper 4.2.0（4200）|

helper保持原观察器、页面增强、F6、人窗与工具右屏路由、controller、原前端手机宿主。菜单栏仅归helper，菜单打开主UI、打开Codex、正式停止交互服务。私有Agent设置窗口移除；设置及重新接入增强统一在主UI，通过原管理socket作用于helper。页面按钮显示SmartShadow，原DOM事件/排序/Snake结构不变。

主UI只拥有管理、设置、小看板，窗口关闭及退出只取消自己的只读请求，不停止helper。UI崩溃不控制后台。普通UI启动仅刷新状态，不启动已停服务。明确启动按钮和F6调用正式ss-service；明确停止按钮/菜单也调用同一正式入口。helper退出清理自身controller/gateway/准确手机宿主，厂商Codex host、真实Run、人工窗、草稿和unknown保留。

## 登录、启动和身份

主App只使用 [SMAppService.loginItem(identifier:)](https://developer.apple.com/documentation/servicemanagement/smappservice/loginitem(identifier:)) 登记包内helper，不使用mainApp登录登记。新helper需准确已安装bundle/path，拒绝旧Plus仍在运行；对原运行目录持有一个进程级独占文件锁后才启动观察器和socket，退出由内核释放。此锁不构成任务/业务存储。

[Apple register](https://developer.apple.com/documentation/servicemanagement/smappservice/register())会立即启动LoginItem，异常或非零退出还会重启；[unregister](https://developer.apple.com/documentation/servicemanagement/smappservice/unregister())会终止运行中的LoginItem。因此同一helper无参数时只调用一次正式ss-service start/attach后正常退出，不持有手机/菜单/socket，不重试未知结果；常驻体由ss-service以`open -g -n <helper bundle> --args --managed-runtime`独立启动。runtime manifest追加`arguments:["--managed-runtime"]`，安装侧按完整argv区分短暂启动器与常驻实例。helper不设置LSMultipleInstancesProhibited，允许短暂启动器等待独立常驻实例；业务单实例由仅常驻体持有的flock保证。系统登录自动重启不能直接变成第二个业务runtime；helper的LaunchServices reopen也不打开Codex。

启用登录开关先由正式控制器启动/附着，再登记唯一LoginItem；UI说明它会即时启动后台。关闭只在正式inspect为stopped且准确新旧身份进程均不存在时注销，UI说明先正常停止后关闭，可随后手动启动。这样系统注销不绕过prepare/drain/stop。

主可执行的 `--open-codex` 为显式F6命令：正式ss-service start/attach后，核容器、helper与运行PID签名，向准确instance发一次`codex.open`并退出，不创建第二UI。`--stop-interactiond`发一次正式停止并退出。普通打开主App不走这些分支。helper保留`--status`、`--lifecycle-*`和`--tool-*`；源CLI别名`scripts/codex-plus`只转到新包，不启动旧Plus。外部F6和配置生成器的实际迁接由#613完成。

登录登记与显式停止为独立选择：停止后普通打开UI仍停；若登录开关开启，下次登录可启动同一helper。系统LoginItem所启动的准确新实例，需要安装侧按真实PID/出生/instance对账采用，不将旧stopped/unknown记录改签，也不另建监督进程。唯一登录项实测、旧登录项退出、helper系统权限由#613在真实安装验收。

工具打开SmartShadow设置时复用同一主UI；仅带`--agent-settings`的新UI窗口初次定位到最右物理屏，既有人窗不重定位。helper不再创建第二套设置窗，旧ToolRouter的同进程设置窗设施不作为消费者使用。

批准时已比较同进程常驻与单包双进程：前者关窗可保持手机，但退出/崩溃UI会停止交互；后者保留当前已验的UI退出独立行为，代价是两层签名/权限和安装配套。按用户选定r3采用后者；两个独立安装App会继续保留重复入口，不满足本轮单一产品目标。

## 数据与生命周期

已知偏好五项（自动展开、屏幕选择、自动发送建议、工具右屏、Chrome右屏）从旧suite一次复制到新`me.longbiaochen.smart-shadow.app`，已有新值优先、false及屏幕Data原样保留；迁移后只写新域。旧suite不写。原Application Support/codex-plus、移动配置、历史结果和未决操作继续保留原位。

MobileGateway仍使用原签名标识`me.longbiaochen.codex-plus.mobile-gateway`和原TLS Keychain tag，主helper不复制/导出密钥。新路径下TLS指纹与合法访问须真实核验；访问失败保留阻点，不能降低手机校验。

管理协议仍为v1，runtime身份换成准确嵌套helper。新增`codex.open`/`enhancements.reconnect`必须带expected_runtime，且仅在running接受；不允许注入设置或任意命令。重新接入仍要求关闭自动发送，沿原controller检查未提交内容；未确认请求不重发。原prepare/drain/nonce保全/正常stop逻辑保持。

看板仍只将taskd当前事实与原Codex目录读入内存并精确去重。它不写TaskWork、Case、action或第二状态库，因此#611停止重复持久化不需要在此制造同类删除；仅实际MCP投影形状改变时适配受影响消费者。

## 构建、交接与验收

`scripts/build`一次构建两个可执行，输出一个新stage内的SmartShadow.app，并在完成内外签名后生成相邻SmartShadow.package.json。manifest保留source_commit/build/files，runtime为bundle_path/bundle_id/executable/resources，路径相对容器、files为路径到SHA256字典；build取helper版本。主容器版本另列。build-manager复用同一入口。install/install-manager只做已停完整包文件替换；ss-service选择和启动由#613办理。

已完成源码层证据：Debug两个产品构建，28项相称Core单元（含偏好迁移/新动作协议），25项页面入口及原controller/mobile生命周期测试，另1项真实shell CLI分派夹具。正式签名包构建、UI关闭/退出独立、F6/增强/右屏、手机读发流式/草稿重连、TLS指纹、显式停启与保留人工窗、唯一登录项尚待#613同包真实验收。原Plus80手机与资源证据在未改部分复用，不外推新身份已验。

后续由#613在实际源码安全点迁入smart-shadow/native，从该仓独立构建、签名、安装并验收无codex-plus工作树依赖后，才退役旧安装、登录项和实时消费者及归档旧仓；原存储和历史unknown不因品牌迁移删除。
