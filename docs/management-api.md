# Codex Plus 独立管理协议

本产品只有一个CodexPlus原生运行体；原生菜单/设置和CLI管理自己的增强，不启动、停止或重启SmartShadow。

## 自身服务器

独占 `~/Library/Application Support/codex-plus/enhancements/tool-control.sock`，0600，父目录无其他用户写权。JSON行请求使用 `command=codex-plus-management-v1`、protocol1及UUID request_id；响应回同request_id、真实独立runtime身份/版本/实例和capabilities。

操作：status、settings.read、settings.write、codex.open、enhancements.reconnect、lifecycle.prepare-stop、lifecycle.resume、lifecycle.stop。设置写入核实例/revision和五项严格类型；停止核已prepare的scope revision，未知结果只对账。停止只释放自己的controller/session/socket，保留官方后台及手机目标。状态不包含网关/iOS版本。

独立状态CLI使用同根status.sock；工具命令同根tool-control.sock，已停时不自动启动。安装路径与签名身份为 `/Applications/Codex Plus.app` / `me.longbiaochen.codex-plus`。普通设置入口为自身SwiftUI窗口。

## SmartShadow只读客户端

另一个连接只读未来 `~/Library/Application Support/SmartShadow/interactiond/management.sock`，发送SmartShadow的 `management-v1` status。先验证内核peer PID与该进程签名/安装身份，响应中的runtime PID必须相同。完整用途字段与撤权/错误语义见[生产合同](designs/standalone-enhancements-v4.md)。它与Plus自己的socket、command和写操作不共用。

当前生产合同尚待SmartShadow迁接；缺失时Plus等待准确授权，不借旧socket转发管理写操作。旧融合协议为[历史版本](https://github.com/felixlark/codex-plus/blob/b879019b55dcbca7ded7440fe4b06b2e20bf5576/docs/management-api.md)，不作为当前安装验收。
