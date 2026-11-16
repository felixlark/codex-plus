import AppKit
import SwiftUI

/// Position only a newly created window owned by this UI. Reopening an existing
/// human window leaves its position intact; no other process is claimed.
struct ManagerWindowPlacement: NSViewRepresentable {
    let enabled: Bool
    final class Anchor: NSView {
        var enabled = false
        private var placed = false
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard enabled, !placed, let window else { return }
            placed = true
            let physical = NSScreen.screens.filter {
                guard let id = ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value else { return false }
                return CGDisplayIsOnline(id) != 0 && CGDisplayMirrorsDisplay(id) == kCGNullDirectDisplay
            }
            guard let screen = physical.max(by: { $0.frame.minX < $1.frame.minX }) else { return }
            let area = screen.visibleFrame
            var frame = window.frame
            frame.size.width = min(frame.width, area.width)
            frame.size.height = min(frame.height, area.height)
            frame.origin = NSPoint(x: area.midX - frame.width / 2, y: area.midY - frame.height / 2)
            window.setFrame(frame, display: false)
        }
    }
    func makeNSView(context: Context) -> Anchor { let view = Anchor(); view.enabled = enabled; return view }
    func updateNSView(_ nsView: Anchor, context: Context) {}
}
