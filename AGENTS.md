# Codex Plus Runbook

## Scope

Owner is Longbiao. This repository owns the native `/Applications/Codex Plus.app`,
Codex Web App enhancements, workspace observation, settings, and the status CLI.

All enhancement entry points, settings, and runtime ownership belong to Codex Plus.
The page's Codex Plus button is the first item in the lower-left navigation footer;
the Snake validation button is the last item in that same footer. Keep the independent menu-bar app.

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

One runtime owns the feature. Dock Switch must have its observer removed before
Codex Plus receives Accessibility permission. Preserve the old installation for
rollback, and keep GitHub Issue acceptance open until Longbiao accepts the result.
