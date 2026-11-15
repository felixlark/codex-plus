import AppKit
import CoreGraphics
import CodexPlusCore

/// Reads the current rightmost physical screen. It owns no display lifecycle.
final class AgentToolScreen {
    private(set) var id: CGDirectDisplayID = 0
    private(set) var name = ""
    private(set) var error: String?
    var supported: Bool { !Self.userDisplays().isEmpty }
    var summary: String {
        guard let bounds = currentBounds() else { return "等待物理显示器" }
        return "最右物理屏 · \(name) · \(Int(bounds.width)) × \(Int(bounds.height)) pt"
    }
    static func isVirtualScreen(_ id: UInt32) -> Bool {
        CGDisplayVendorNumber(id) == 0x0CAC && CGDisplayModelNumber(id) == 0x0CAC
    }
    static func userDisplays() -> [UInt32: CGRect] {
        var count: UInt32 = 0
        guard CGGetOnlineDisplayList(0, nil, &count) == .success else { return [:] }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetOnlineDisplayList(count, &ids, &count) == .success else { return [:] }
        return Dictionary(uniqueKeysWithValues: ids.prefix(Int(count)).filter {
            !isVirtualScreen($0) && CGDisplayIsInMirrorSet($0) == 0 && CGDisplayMirrorsDisplay($0) == 0
        }.map { ($0, CGDisplayBounds($0)) })
    }
    func currentBounds() -> CGRect? {
        let candidates = Self.userDisplays()
        guard let selected = ToolWindowPolicy.rightmostDisplay(candidates),
              let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == selected }) else {
            id = 0; error = "right-physical-display-unavailable"; return nil
        }
        id = selected; name = screen.localizedName; error = nil
        let visible = screen.visibleFrame
        return CGRect(x: visible.minX, y: CGDisplayBounds(CGMainDisplayID()).height - visible.maxY,
                      width: visible.width, height: visible.height)
    }
    func prepare(_ completion: (CGRect?) -> Void) { completion(currentBounds()) }
}
