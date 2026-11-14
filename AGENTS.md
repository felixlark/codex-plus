# Codex Plus Runbook

## Scope

Owner is Longbiao. This repository owns the native `/Applications/Codex Plus.app`,
Codex Web App enhancements, workspace observation, settings, the status CLI, and isolation of Agent-owned windows on an invisible virtual display.

All enhancement entry points, settings, and runtime ownership belong to Codex Plus.
The page's Codex Plus button is the first item in the lower-left navigation footer;
the Snake validation button follows Projects in the upper navigation group, using its native spacing and button presentation. Keep the independent menu-bar app.

## Commands

- Tests `./scripts/test`
- Signed build `./scripts/build`
- Install `./scripts/install`
- Live status `./scripts/codex-plus --status`

Use the canonical checkout with one writer. Keep build output and caches under
`~/Library/Caches/codex-plus/`, runtime state under
`~/Library/Application Support/codex-plus/`, and local evidence under
`~/Library/Logs/codex-plus/`. Preserve unrelated changes and existing worktrees.

## Acceptance and boundaries

Use the installed app and the workflow in `docs/acceptance.md`. Unit tests cover
policy and structural parsing. A real Cmd+N and mode-switch check establishes visible
behavior. Retain candidate-bound test, signing, install, and live evidence.

Feature design may inspect Codex's renderer structure, application code, project
and task metadata, and integration mechanisms. Record the selected integration,
affected data, lifecycle, recovery, and acceptance in the feature design. The
workspace auto-expand feature expands a known closed workspace. Permission grants
use the user's explicit authorization and official System Settings controls.

One Plus runtime owns Agent-window isolation. Never route tools to a physical monitor,
move either human Codex window, or claim every window of a utility process. File and
explicit-window claims use exact system window identity. User Settings and Agent
Settings are separate windows. Preserve the previous installation for rollback.
The result owner completes installed interaction acceptance and closes the delivery
issue with evidence; wait for personal acceptance only when explicitly required.

## 自动交付

已进入开发交付的事项，由原结果负责人连续完成相称检查、提交推送、开 PR、自动合并、既定环境安装／部署及真实交互验收，不再逐阶段等待人工批准。必要审查由负责人自动组织并处理实质问题，不以等待特定云评审渠道作为默认停顿点；仅在本人明确指定亲验时等待本人。测试失败或实际缺陷继续修复；任务外敏感动作和本人明确暂停仍按具体边界办理。
