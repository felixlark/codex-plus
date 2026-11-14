# Agent-only invisible windows

Codex Plus owns Agent-only windows on an invisible virtual display. The middle and right physical screens remain the user's two Codex windows. No horizontal/rightmost display selection, physical-screen fallback, utility-process ownership, or old display UUID remains.

## Display and identity

AgentDisplay now acquires a read-only reference to the official Open Computer Use persistent-display screen. It validates the exact namespace-derived vendor/model/serial, the persisted enabled/restoreOnSessionEnd=false configuration, online bounds, non-primary/non-builtin/non-mirrored status and nonoverlap on every use. A display number or rightmost position alone never qualifies. Missing/changed/ambiguous display identity rejects the request before opening a resource; status does not create a screen. Plus contains no virtual-display creation, display-configuration or destruction code and does not launch/restart the shared OCU runtime. This avoids the actual build33 creation-time physical layout disturbance.

OCU owns the persistent screen lifecycle and the real window restore records. Plus uses the installed official stdio MCP in the persistent-display namespace with action readback/cursor animation off. Each session requires tools/list to advertise integer window_id and keep/agent_display/restore/release before doing anything. Missing exact-window support rejects the request before opening a file or Settings. Deployment must also bind the actual app-agent runtime to this contract; new frontend metadata alone does not establish that.

OCU requires AX or screenshot observation on each get_app_state. Lifecycle calls use screenshot-only observation tied to the exact owned window; returned image data is discarded, not logged. This avoids collecting a shared app's unrelated focused text. Errors retain only a bounded first line and, for own Agent Settings, its identity/frame. The newline pipe uses short reads and per-descriptor broken-pipe protection; a short reply never waits for the provider to close stdout.

External Agent windows are moved and registered by OCU using exact PID/windowID; Plus no longer resizes them. A window larger than the current virtual screen is rejected. OCU keeps the actual original position for normal runtime shutdown. Agent Settings first appears on the hidden screen, then is registered asynchronously by exact ID while Plus remains AX-responsive. Its truthful original location may be hidden: on explicit normal OCU shutdown, OCU's existing supported physical-screen fallback applies, not a fabricated Plus physical original. Plus quit closes its own Settings; closed-window registration is pruned by OCU. Session disconnect/reconnect leaves persistent windows in place.

Plus restores external windows with exact OCU restore and drops its reference without destroying the shared screen. User takeover triggers exact release, which discards only the OCU restore record and never moves that window. Unknown RPC results are not replayed on another quit; full identity/closure reconciliation or explicit operator recovery is required. A born-hidden file with no physical original remains save/close recovery through its exact Agent window; status is the instruction, no focus-taking dialog is opened.

AX windows are directly mapped to CGWindowID using the same runtime identity API as OCU. PID, process launch date, AX element and CG owner are checked before moving or restoring; overlapping geometry is never identity. Codex, X, X Chat and normal Plus windows are protected.

## Ownership and lifecycle

Only an explicit local file matched through AXDocument, an exact PID/window ID, or a newly created Agent Settings window qualifies. Baseline manual windows on each file request. File/tab reuse consumes the claim without moving the manual window; no delayed reopening revives consumed claims. There are no launch/activation/unhide watchers for utility applications, no process-wide dedicated mode, and no implicit utility windows.

The original request epoch cancels both late completions and bounded AX readiness retries. Pause discards pending observers/claims permanently; resuming only accepts new requests. Existing parked windows stay invisible. The independent command socket retains its complete-frame, no-replay and single-I/O-owner shutdown contracts.

Before requesting a move, retain its exact identity and original frame/display. Only a successful OCU operation followed by contained-frame readback commits the parked baseline. An accepted operation followed by a physical user takeover releases the record without moving it; failed or unknown outcomes retain recovery state. Restore only the same live identity still at the last frame and an unchanged original display. A new file window that was born on the Agent display has no invented physical target: status reports close-agent-window, and it must be saved/closed before releasing that display. A user-moved window is released without further movement. An unavailable CG inventory is unknown, not proof a window closed.

Normal Settings stays user-owned. Agent Settings is a separate window positioned on the virtual display before showing without activation. On normal quit, close only still-owned Agent Settings, asynchronously restore other live owned windows and read back results, then release its reference. In-flight operations keep quit pending and retry termination only after verified completion. Failed restoration cancels that quit without activating a dialog, preserving status for recovery. Plus never destroys the shared OCU display, whether other windows remain or not. No persistent AX handles or automatic crash reclaim exists; process crash handling remains macOS behavior.

## Entry points

The native installed binary exposes --tool-open (local file or own Agent Settings), --tool-place/--tool-restore with exact PID/window ID, --tool-status, and --tool-routing. Old --dedicated, --tool-exempt and --tool-recover semantics are removed. New preference agentToolWindowsEnabled defaults on for this user-requested feature; only quietToolDisplayUUID/quietToolWindowsEnabled are retired.

## Acceptance

Use signed /Applications installation. Record both current human Codex IDs/frames, foreground app/focused AX identity and a content fingerprint only (no message contents), system pointer/input-idle and clipboard count. Never place test text in X/X Chat. Open a local Agent test document, operate/save it through OCU with explicit window identity, automatic action readback and visual cursor disabled; prove virtual geometry and saved contents. Verify manual same-app window stays unchanged when another Agent file opens. Cover duplicate file, protected-window rejection, pause/cancel/resume, targeted restoration, user-move release, and Plus quit/restart without changing the shared display; separately verify OCU normal-exit restoration for exact registered windows. Activation notifications and live geometry cover the critical actions, with user physical input distinguished from Agent activity. Unit tests never launch GUI.

Migration evidence: ~/Library/Logs/codex-plus/agent-display-20261115/. Earlier right-screen acceptance is historical only and does not describe current behavior.
