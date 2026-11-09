# Codex Plus Runbook

## Scope

Owner is Longbiao. This repository owns the native `/Applications/Codex Plus.app`,
workspace observation, settings, and the read-only status CLI.

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

Read only the public current mode, window/header controls, and opaque AX identities.
Preserve exclusions for conversations, composer contents, sidebar lists, and nested
browser web areas. Expand only a known closed Codex workspace. Permission grants
use the user's explicit authorization and official System Settings controls.

One runtime owns the feature. Dock Switch must have its observer removed before
Codex Plus receives Accessibility permission. Preserve the old installation for
rollback, and keep GitHub Issue acceptance open until Longbiao accepts the result.
