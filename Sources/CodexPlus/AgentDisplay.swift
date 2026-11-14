import AppKit
import CoreGraphics
import CodexPlusCore
import AgentDisplayShim

/// Owns only this Plus process's display. Never borrows a physical/OCU display.
final class AgentDisplay {
    private var handle: UnsafeMutableRawPointer?
    private(set) var id: CGDirectDisplayID = 0
    private(set) var error: String?
    var bounds: CGRect? { id != 0 && CGDisplayIsOnline(id) != 0 ? CGDisplayBounds(id) : nil }
    var supported: Bool { cp_virtual_display_is_supported() != 0 }

    private(set) var isPreparing = false
    private var validated = false
    private var waiting: [(CGRect?) -> Void] = []
    private(set) var diagnostics: [String: Any] = [:]

    /// Read-only topology validation for an already prepared display.
    func currentBounds() -> CGRect? {
        guard handle != nil, validated, !isPreparing else { return nil }
        let online = Self.displays()
        let valid = ToolWindowPolicy.isIsolatedDisplay(id: id, before: online.filter { $0.key != id }, after: online,
            primaryBefore: CGMainDisplayID(), primaryAfter: CGMainDisplayID(),
            mirrored: CGDisplayIsInMirrorSet(id) != 0 || CGDisplayMirrorsDisplay(id) != 0)
        guard valid else { error = "virtual-display-no-longer-isolated"; return nil }
        return bounds
    }

    /// Never wait for main-queue CGVirtualDisplay callbacks while blocking main.
    func prepare(_ completion: @escaping (CGRect?) -> Void) {
        if isPreparing { waiting.append(completion); return }
        if handle != nil { completion(currentBounds()); return }
        let before = Self.displays(), primary = CGMainDisplayID(), codex = Self.codexFrames()
        guard supported else { error = "virtual-display-unavailable"; completion(nil); return }
        var created: UnsafeMutableRawPointer?
        let display = cp_virtual_display_create("Codex Plus Agent", 1920, 1080, 60, &created)
        guard display != 0, let created else { error = "virtual-display-create-failed"; completion(nil); return }
        handle = created; id = display; isPreparing = true; validated = false
        waiting = [completion]; error = nil; diagnostics = [:]
        poll(before: before, primary: primary, codex: codex, deadline: Date().addingTimeInterval(3))
    }

    private func poll(before: [UInt32: CGRect], primary: UInt32, codex: [UInt32: CGRect], deadline: Date) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) { [weak self] in
            guard let self, self.isPreparing, self.handle != nil else { return }
            if self.bounds?.isEmpty == false, self.preservePriorMain(primary, original: before) {
                let after = Self.displays()
                if ToolWindowPolicy.isIsolatedDisplay(id: self.id, before: before, after: after,
                       primaryBefore: primary, primaryAfter: CGMainDisplayID(),
                       mirrored: CGDisplayIsInMirrorSet(self.id) != 0 || CGDisplayMirrorsDisplay(self.id) != 0),
                   codex == Self.codexFrames() {
                    self.validated = true; self.finish(self.bounds); return
                }
            }
            if Date() < deadline { self.poll(before: before, primary: primary, codex: codex, deadline: deadline); return }
            self.error = "virtual-display-topology-unverified"
            self.diagnostics = ["primaryBefore": primary, "primaryAfter": CGMainDisplayID(),
                "ownedID": self.id, "online": CGDisplayIsOnline(self.id),
                "before": Self.framesJSON(before), "after": Self.framesJSON(Self.displays()),
                "codexBefore": Self.framesJSON(codex), "codexAfter": Self.framesJSON(Self.codexFrames())]
            if let handle = self.handle { cp_virtual_display_destroy(handle) }
            self.handle = nil; self.id = 0; self.validated = false
            self.finish(nil)
        }
    }

    private func finish(_ bounds: CGRect?) {
        isPreparing = false
        let callbacks = waiting; waiting.removeAll()
        callbacks.forEach { $0(bounds) }
    }

    private static func framesJSON(_ frames: [UInt32: CGRect]) -> [String: [String: CGFloat]] {
        Dictionary(uniqueKeysWithValues: frames.map { (String($0.key), ["x": $0.value.minX, "y": $0.value.minY, "width": $0.value.width, "height": $0.value.height]) })
    }

    // Same login-session-only main-screen protection as OCU's installed
    // persistent display implementation. Creating CGVirtualDisplay may change
    // the global coordinate origin; translate that change back, never modes.
    private func preservePriorMain(_ primary: UInt32, original: [UInt32: CGRect]) -> Bool {
        guard CGMainDisplayID() == id else { return CGMainDisplayID() == primary }
        let current = Self.displays()
        guard let anchor = current[primary], let previous = original[primary] else { return false }
        let dx = anchor.minX - previous.minX, dy = anchor.minY - previous.minY
        var configuration: CGDisplayConfigRef?
        guard CGBeginDisplayConfiguration(&configuration) == .success, let configuration else { return false }
        for (display, bounds) in current {
            guard let x = Int32(exactly: (bounds.minX - dx).rounded()),
                  let y = Int32(exactly: (bounds.minY - dy).rounded()),
                  CGConfigureDisplayOrigin(configuration, display, x, y) == .success else {
                CGCancelDisplayConfiguration(configuration); return false
            }
        }
        return CGCompleteDisplayConfiguration(configuration, .forSession) == .success
            && CGMainDisplayID() == primary
    }

    /// Call only after all owned windows are restored or closed.
    func release() -> Bool {
        guard !isPreparing else { error = "virtual-display-preparing"; return false }
        guard let handle else { return true }
        guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]], let area = bounds else {
            error = "display-window-query-unavailable"; return false
        }
        if windows.contains(where: { entry in
            guard entry[kCGWindowLayer as String] as? Int == 0,
                  let raw = entry[kCGWindowBounds as String] as? [String: Any],
                  let frame = CGRect(dictionaryRepresentation: raw as CFDictionary) else { return false }
            return area.intersects(frame)
        }) {
            error = "display-still-has-unrestored-windows"; return false
        }
        let before = Self.displays().filter { $0.key != id }
        let primary = CGMainDisplayID()
        let codex = Self.codexFrames()
        cp_virtual_display_destroy(handle)
        self.handle = nil; id = 0; validated = false
        let after = Self.displays()
        let unchanged = before.allSatisfy { after[$0.key] == $0.value }
            && primary == CGMainDisplayID() && codex == Self.codexFrames()
        if !unchanged { error = "desktop-changed-during-display-release" }
        return unchanged
    }

    static func displays() -> [UInt32: CGRect] {
        var count: UInt32 = 0
        guard CGGetOnlineDisplayList(0, nil, &count) == .success else { return [:] }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetOnlineDisplayList(count, &ids, &count) == .success else { return [:] }
        return Dictionary(uniqueKeysWithValues: ids.prefix(Int(count)).map { ($0, CGDisplayBounds($0)) })
    }

    private static func codexFrames() -> [UInt32: CGRect] {
        let pids = Set(NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex").map(\.processIdentifier))
        let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
        return Dictionary(uniqueKeysWithValues: windows.compactMap { w -> (UInt32, CGRect)? in
            guard let pid = w[kCGWindowOwnerPID as String] as? Int32, pids.contains(pid),
                  w[kCGWindowLayer as String] as? Int == 0,
                  let id = w[kCGWindowNumber as String] as? UInt32,
                  let raw = w[kCGWindowBounds as String] as? [String: Any],
                  let frame = CGRect(dictionaryRepresentation: raw as CFDictionary) else { return nil }
            return (id, frame)
        })
    }
}
