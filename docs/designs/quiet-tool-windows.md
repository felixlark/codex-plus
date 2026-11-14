# Agent-only invisible windows

Codex Plus owns Agent-only windows on an invisible virtual display. The middle and right physical screens remain the user's two Codex windows. No horizontal/rightmost display selection, physical-screen fallback, utility-process ownership, or old display UUID remains.

## Display and identity

AgentDisplay now acquires a read-only reference to the official Open Computer Use persistent-display screen. It validates the exact namespace-derived vendor/model/serial, the persisted enabled/restoreOnSessionEnd=false configuration, online bounds, non-primary/non-builtin/non-mirrored status and nonoverlap on every use. A display number or rightmost position alone never qualifies. Missing/changed/ambiguous display identity rejects the request before opening a resource; status does not create a screen. Plus contains no virtual-display creation, display-configuration or destruction code and does not launch/restart the shared OCU runtime. This avoids the actual build33 creation-time physical layout disturbance.

OCU owns the persistent screen lifecycle. Plus owns only its exact window claims; releasing Plus drops its display reference and leaves the OCU screen and other tasks untouched. Exact-window parking registration with the official OCU runtime is a remaining integration requirement before declaring the normal OCU-exit restoration contract verified. Do not treat OCU keep-only inspection as registration. Runtime disconnect/reconnect persistence and normal runtime shutdown restoration need separate evidence.

AX windows are directly mapped to CGWindowID using the same runtime identity API as OCU. PID, process launch date, AX element and CG owner are checked before moving or restoring; overlapping geometry is never identity. Codex, X, X Chat and normal Plus windows are protected.

## Ownership and lifecycle

Only an explicit local file matched through AXDocument, an exact PID/window ID, or a newly created Agent Settings window qualifies. Baseline manual windows on each file request. File/tab reuse consumes the claim without moving the manual window; no delayed reopening revives consumed claims. There are no launch/activation/unhide watchers for utility applications, no process-wide dedicated mode, and no implicit utility windows.

The original request epoch cancels both late completions and bounded AX readiness retries. Pause discards pending observers/claims permanently; resuming only accepts new requests. Existing parked windows stay invisible. The independent command socket retains its complete-frame, no-replay and single-I/O-owner shutdown contracts.

Before mutating a window, retain its exact identity, original frame/display, and last observed frame. Verify the move by readback. Partial failures roll back immediately; failed rollback stays a recoverable record. Restore only the same live identity still at the last frame and an unchanged original display. A new file window that was born on the Agent display has no invented physical target: status reports close-agent-window, and it must be saved/closed before releasing that display. A user-moved window is released without further movement. An unavailable CG inventory is unknown, not proof a window closed.

Normal Settings stays user-owned. Agent Settings is a separate window positioned on the virtual display before showing without activation. On normal quit, close only still-owned Agent Settings, restore all other live owned windows and read back results, then release its reference. Failed restoration cancels that quit without activating a dialog, preserving status for recovery. Plus never destroys the shared OCU display, whether other windows remain or not. No persistent AX handles or automatic crash reclaim exists; process crash handling remains macOS behavior.

## Entry points

The native installed binary exposes --tool-open (local file or own Agent Settings), --tool-place/--tool-restore with exact PID/window ID, --tool-status, and --tool-routing. Old --dedicated, --tool-exempt and --tool-recover semantics are removed. New preference agentToolWindowsEnabled defaults on for this user-requested feature; only quietToolDisplayUUID/quietToolWindowsEnabled are retired.

## Acceptance

Use signed /Applications installation. Record both current human Codex IDs/frames, foreground app/focused AX identity and a content fingerprint only (no message contents), system pointer/input-idle and clipboard count. Never place test text in X/X Chat. Open a local Agent test document, operate/save it through OCU with explicit window identity, automatic action readback and visual cursor disabled; prove virtual geometry and saved contents. Verify manual same-app window stays unchanged when another Agent file opens. Cover duplicate file, protected-window rejection, pause/cancel/resume, targeted restoration, user-move release, and Plus quit/restart without changing the shared display; separately verify OCU normal-exit restoration after exact-window registration is integrated. Activation notifications and live geometry cover the critical actions, with user physical input distinguished from Agent activity. Unit tests never launch GUI.

Migration evidence: ~/Library/Logs/codex-plus/agent-display-20261115/. Earlier right-screen acceptance is historical only and does not describe current behavior.
