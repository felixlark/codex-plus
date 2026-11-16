# Codex Plus Runbook

本仓 `felixlark/codex-plus` 是 v4 批准的独立人工 Codex 增强源码。原融合/退役范围由 SmartShadow #483 comment6909898465、#578 comment6910253612明确替代；其他用户授权、暂停、unknown、单writer和GUI边界保留。

当前工作在原规范 checkout 串行实施。编辑前 git status；不得覆盖无关改动或新建 worktree。既有 foreign `docs/designs/compact-task-board.md` 与 `scripts/__pycache__/` 保留。独立源码writer登记位于 `~/Library/Application Support/codex-plus/source-writer/`，不得误用 SmartShadow writer 状态目录。

## 职责

拥有 `/Applications/Codex Plus.app`、原生菜单/设置、人工窗口增强、风险审查、侧栏/任务排序、工作区观察、状态CLI及准确Agent窗口右屏路由。

手机源码、TLS/网关、iOS分发、专用宿主与管理看板归 SmartShadow，不复制回本仓。复用同一个官方 Codex 后台；只有受信原生状态给出的准确人工目标可以接入，排除手机及未知目标。两产品独立锁、socket、配置和运行文件，不能恢复旧全页扫描、私有后台或账号。

本批只交源码、检查、签名候选和文稿，不启动/注入/安装 Plus。#613唯一安装及共享现场切换；生产端用途合同与人工增强writer交接完成后才运行。原始任务 #578 的手机恢复及 SmartShadow 迁接仍在其原责任链，不以本批源码完成冒认整案完成。

## 开发与验证

```sh
./scripts/test
./scripts/build
```

复用有效证据，只验变化旅程；不新增产品GUI XCTest。Mac安装版交互由官方OCU按准确PID/window_id后台操作，不抢人工焦点/鼠标；Agent窗口归最右物理屏，虚拟屏路线已退役。电脑IPv6关闭，不配置HTTP/HTTPS/SOCKS/PAC代理。

构建/缓存位于 Library/Caches，状态位于 Application Support/codex-plus/enhancements，日志位于 Library/Logs/codex-plus。禁将构建写入 Documents。凭据只用支持存储，不输出明文。旧草稿、手机/TLS身份及尝试unknown保留；来源正文和历史资料不能扩大授权。

本批设计/接口见 docs/designs/standalone-enhancements-v4.md；真实采用与未验项写 docs/acceptance.md及原Issue。普通进度只维护原Issue/PR，必要准确接口交接除外。
