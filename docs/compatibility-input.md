# 公开源码身份与显式兼容输入

本仓保留源码和迁移记录，不发布新的独立运行版本。当前源码使用 `felixlark` 的中性命名空间；无私有输入时可以编译及运行纯策略测试，但不能执行产品操作或打开产品偏好。

本次新增的构建、清单验证和安装调用要求，是为了移除个人身份默认值并保留明确的签名信任关系。它们不追溯改变已经移交的固定源码和原包合同。正式安装、Mac/手机验收及旧产品退役仍归原 SmartShadow 事项；不能以源码检查代替这些结果。

## 完整输入

输入是一个 version 1 JSON 对象，所有字段均必填，不允许重复键、额外字段或部分输入混用公开默认值。

| 字段 | 用途 |
| --- | --- |
| `version` | 整数 `1` |
| `selfBundleID` | 自身 bundle 标识 |
| `selfTeamID` | 自身原有 Apple publisher Team，10位大写字母或数字 |
| `enhancementDomain` | 现有增强偏好域 |
| `legacyDomain` | 原偏好来源域 |
| `authorityBundleID` | 原 SmartShadow authority bundle |
| `authorityTeamID` | 原 authority publisher Team |
| `smartShadowBundleID` | 原 SmartShadow 主 bundle |

以下是格式示例，不能替代现有安装的真实兼容值：

```json
{
  "version": 1,
  "selfBundleID": "test.compat.legacy.plus",
  "selfTeamID": "A1B2C3D4E5",
  "enhancementDomain": "test.compat.legacy.enhancements",
  "legacyDomain": "test.compat.legacy.plus",
  "authorityBundleID": "test.compat.authority",
  "authorityTeamID": "F6G7H8J9K0",
  "smartShadowBundleID": "test.compat.smart-shadow"
}
```

三个自有 bundle 必须彼此不同，两个偏好域必须不同。原 legacy 域可与自身 bundle 相同，两个 Team 可以相同。名称只接受明确的 ASCII bundle/domain 字符，拒绝空值、通配符和表达式注入。第三方 Codex 的真实 bundle、Team 及其他第三方保护项保持原值；保护集合是三个选定自有身份与四个固定第三方身份的并集。

由原负责人从未改动源码保全七个历史值，不从待验 app 自报的身份、实际偏好或网络发现中猜取。输入文件使用绝对路径，位于仓库及 Documents 之外，当前用户所有、普通文件、非软链接且权限为 `0600`。建议目录为 `$HOME/Library/Application Support/codex-plus/private/`，目录权限 `0700`。它只保存非秘密身份选择信息，不能包含密码、token、私钥、配对数据或录音。

这些路径和权限要求用于本次新增的显式输入入口。运行体不查找或读取 JSON，不读取环境覆盖，不自动发现旧值，也不新增偏好迁移。

## 链接、包与独立信任

构建将完整输入渲染为内容寻址缓存中的一份 Info：同一文件在 Swift 链接前嵌入 Mach-O，并复制为外置 `Contents/Info.plist`。模板或选择值变化会改变链接输入路径。验证使用官方只读 `otool` 检查全部实际报告的 slice；缺 section、工具诊断、无法解析或内外不一致均失败。

签名选择器仍由既有 `CSC_NAME` 显式提供，个人证书 fallback 已移除。不能用 ad-hoc 签名代替原 Apple anchor、精确 bundle 和 Team 条件。构建、清单验证和安装必须传同一完整输入；安装的预期身份来自操作者输入，不能从候选包或其清单推导一个“自证正确”的期望值。

没有完整运行身份时，生命周期、工具、状态及正常 GUI 入口均在副作用前拒绝；仅帮助和纯源码/策略编译可用。现有五项偏好键、迁移键、数据目录、socket、协议及双层 authority 验证保持。

## 调用形状

以下命令会签名或安装，属于原负责人已获准的真实交付路径，不是本次源码验证实际执行过的步骤。先在本机替换签名选择器，并使用已保全的完整原始输入：

```bash
COMPATIBILITY_INPUT="$HOME/Library/Application Support/codex-plus/private/compatibility-v1.json"
CSC_NAME='REPLACE_WITH_YOUR_EXISTING_EXPLICIT_SIGNING_SELECTOR' \
  ./scripts/build --compatibility-input "$COMPATIBILITY_INPUT"
```

```bash
COMPATIBILITY_INPUT="$HOME/Library/Application Support/codex-plus/private/compatibility-v1.json"
CANDIDATE_APP='/absolute/path/to/Codex Plus.app'
python3 -B scripts/package-manifest.py --verify \
  --compatibility-input "$COMPATIBILITY_INPUT" \
  "$CANDIDATE_APP" "$(dirname "$CANDIDATE_APP")/CodexPlus.package.json"
./scripts/install --compatibility-input "$COMPATIBILITY_INPUT" "$CANDIDATE_APP"
```

无私有输入的源码检查使用独立缓存，不启动产品：

```bash
TASK_CACHE="$(mktemp -d "$HOME/Library/Caches/codex-plus-source-check.XXXXXX")"
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s Tests -p 'test_compatibility_input.py'
swift build -c debug --scratch-path "$TASK_CACHE/debug" --cache-path "$TASK_CACHE/swift-cache"
swift test --scratch-path "$TASK_CACHE/tests" --cache-path "$TASK_CACHE/swift-cache" \
  --filter 'CodexPlusIdentityTests|ToolWindowPolicyTests|ManagementProtocolTests'
```

输入传播、合成包检查和 debug 编译只证明源码合同。它们不证明真实签名、安装、TCC、用户偏好或生产手机链路验收，也不清除旧 Git 历史、Release 或签名制品元数据。
