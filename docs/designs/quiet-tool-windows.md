# Quiet tool windows in Codex Plus

Codex stays on the middle external display. Identified independent tool windows use the rightmost external display without activation, Raise, pointer movement or Space changes. The target is bound to a stable display UUID; disconnecting it pauses routing instead of using the Codex screen.

## Ownership

`ToolWindowPolicy` in CodexPlusCore and `ToolWindowRouter` in CodexPlus own this feature. Use the existing display catalog and convert NSScreen.visibleFrame into AX coordinates. Missing visible work area skips placement. Protected Codex, X and X Chat windows never qualify.

Known utility bundles and explicitly dedicated tool-only sessions may have process observers. Mixed-use applications require a requested file URL matched to public AXDocument metadata, or explicit PID/window ID mapped to exactly one AX window. No timing, process ancestry or cold-start ownership inference. Baseline existing windows on every request; an already-open document creates no pending claim. Tab reuse consumes the claim without moving the containing window. A manual window opened after a tool document remains unowned. Handled windows are not repeatedly moved after a user drag. Sheets, minimized and fullscreen windows are excluded.

## Command and lifecycle

The installed native binary accepts `--tool-open --app-path PATH [--url URL] [--dedicated]`, `--tool-place --pid PID --window-id ID`, `--tool-status`, `--tool-routing --enabled true/false`, `--tool-exempt`, and `--tool-recover`. Parsing occurs before NSApplication startup. Commands never auto-launch Plus or retry a sent request. A lost response is an unknown result; inspect status before another action. PID and window ID are checked using exact bounded conversions, including raw socket requests.

A separate mode-0600 `tool-control.sock` accepts newline-framed JSON. Accepted sockets explicitly clear inherited O_NONBLOCK. Fragmented reads and partial writes are handled off main. A connected peer with no payload does not block UI or the existing read-only status server. Routing executes on main; quit shuts down pending clients, and their single I/O owner closes each descriptor after reading/writing ends. `--status` retains its read-only contract and adds `toolWindows`.

NSWorkspace opens use activates=false. Plus's own Settings entry invokes a nonactivating in-process callback instead of reopening the bundle (which would activate Codex). Newly created Settings is positioned before display; ordinary user Settings/F6 actions retain their intentional activation semantics. Menu pause removes observers; exemption and offscreen recovery are explicit. Claims are session-local and never restored after restart. A cold-app cannotComplete error retries only the same explicit scope for at most two seconds, carrying monotonically reduced document claims. The epoch captured before open invalidates both late completion and retries on pause/stop; the application is never reopened.

## Migration and cleanup

Source issue moved from Dock Switch #62 to [Codex Plus #10](https://github.com/felixlark/codex-plus/issues/10). Dock Switch PR65 removes its tool router, commands, feature menu, policy and documentation ownership; its general launcher and positioning stay intact. No permanent forwarding adapter or second runtime remains.

Deployment backs up the installed apps and the presence/value of the two legacy preferences. With both owners stopped, copy `quietToolWindowsEnabled` and `quietToolDisplayUUID` from Dock Switch only when the Plus destination key is absent, preserving false. Install cleaned Dock Switch before starting new Plus. Verify one owner, then remove only those two legacy keys. Existing launcher configuration, Plus layout/sorting and unrelated preferences remain intact. Historical evidence is retained.

## Verification

Policy and CLI/socket unit tests do not launch GUI. Signed installed acceptance opens actual tool files and Settings while X Chat's text area holds a temporary unsent draft; record activation events, focused element, draft preservation, pointer and public window geometry. Check Codex stays middle, managed tools fit the right work area, existing/manual windows remain untouched, duplicate document opens do not claim windows, and pause/resume works. Check cold Plus CLI fails without opening an app and malformed/fragmented socket requests do not freeze the runtime. Clear only the temporary draft and close only test windows.

Original Dock Switch 1.1.0 algorithm acceptance is retained at `~/Library/Logs/dock-switch/quiet-tools-20261114/`; migration evidence is under `~/Library/Logs/codex-plus/tool-window-migration-20261114/`. New installed acceptance is recorded separately in docs/acceptance.md. Physical hotplug and F6 require their own hardware evidence; unchanged earlier claims do not imply new coverage.
