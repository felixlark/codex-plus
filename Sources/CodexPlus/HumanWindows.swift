import AppKit
import ApplicationServices
import AgentDisplayShim
import CodexPlusCore

/// F6 manages only explicitly bound human windows. Existing hidden windows are never candidates.
final class HumanWindows {
    struct Window {
        let id: UInt32
        let element: AXUIElement
        let frame: CGRect
        let url: URL
    }
    private var host: NSRunningApplication?
    private var bindings: [Int: UInt32] = [:]
    private var token: String?
    private var requestedSlot: Int?
    private var deadline = Date.distantPast
    private var opening = false
    private var error: String?
    private var requested = false
    var createWindow: ((String) -> Bool)?

    func open(_ app: NSRunningApplication) {
        if !requested { deadline = Date().addingTimeInterval(30); error = nil }
        requested = true
        update(app)
    }

    func update(_ app: NSRunningApplication) {
        if host?.processIdentifier != app.processIdentifier || host?.launchDate != app.launchDate {
            host = app; bindings = [:]; token = nil; opening = false
            if let saved = UserDefaults.standard.dictionary(forKey: "humanWindows"),
               saved["pid"] as? Int32 == app.processIdentifier,
               saved["launch"] as? Double == app.launchDate?.timeIntervalSince1970 {
                for slot in [1, 2] { if let id = saved[String(slot)] as? UInt32 { bindings[slot] = id } }
            }
        }
        guard requested, AXIsProcessTrusted() else { return }
        let live = windows(app)
        let screens = destinations()
        if let token, let slot = requestedSlot {
            let matching = live.filter { marker($0.url) == token }
            if matching.count == 1, let screen = screens[slot] {
                if place(matching[0], on: screen) { bindings[slot] = matching[0].id; save(app); self.token = nil; requestedSlot = nil }
                // AX accepts frame changes before a new host window has settled.
                // Retain this exact nonce and retry on the existing heartbeat;
                // never create another window while placement is still pending.
                else if Date() < deadline { return }
                else { error = "window-placement-failed"; requested = false; return }
            } else if matching.count > 1 || Date() > deadline {
                error = matching.count > 1 ? "ambiguous-human-window-token" : "human-window-creation-timeout"
                requested = false; self.token = nil; requestedSlot = nil; return
            } else { return }
        }
        for slot in [1, 2] {
            guard let screen = screens[slot] else { error = "physical-display-\(slot)-unavailable"; requested = false; return }
            if let id = bindings[slot], let window = live.first(where: { $0.id == id }) {
                if !place(window, on: screen) { placementPending(); return }
                continue
            }
            // Existing physical main windows are user windows; hidden windows are not inferred from chronology/focus.
            let candidates = live.filter { window in
                !bindings.values.contains(window.id) && marker(window.url) == nil && screen.frame.contains(window.frame.centerForHumanWindow)
            }
            if candidates.count == 1 {
                let window = candidates[0]
                guard place(window, on: screen) else { placementPending(); return }
                bindings[slot] = window.id; save(app); continue
            }
            let nonce = UUID().uuidString
            guard createWindow?(nonce) == true else { error = "native-window-bridge-unavailable"; return }
            token = nonce; requestedSlot = slot; deadline = Date().addingTimeInterval(30)
            return
        }
        requested = false; error = nil; opening = true
        save(app)
    }

    func status() -> [String: Any] {
        ["phase": requested ? "opening" : error == nil && opening ? "ready" : error == nil ? "idle" : "failed",
         "error": error as Any? ?? NSNull(), "windows": frames()]
    }

    func frames() -> [[String: Any]] {
        guard let host, !host.isTerminated else { return [] }
        let live = windows(host)
        return [1, 2].compactMap { slot in
            guard let id = bindings[slot], let window = live.first(where: { $0.id == id }) else { return nil }
            return ["number": slot, "windowID": id, "x": window.frame.minX, "y": window.frame.minY,
                    "width": window.frame.width, "height": window.frame.height]
        }
    }

    private func destinations() -> [Int: (frame: CGRect, visible: CGRect)] {
        var result: [Int: (frame: CGRect, visible: CGRect)] = [:]
        let primaryHeight = CGDisplayBounds(CGMainDisplayID()).height
        for (slot, name) in [(1, "DELL U3219Q"), (2, "Mi Monitor (2)")] {
            let key = "humanDisplayUUID\(slot)"
            let saved = UserDefaults.standard.string(forKey: key)
            let matches = NSScreen.screens.filter { screen in
                guard let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return false }
                let id = n.uint32Value
                guard CGDisplayIsBuiltin(id) == 0 else { return false }
                let uuid = CGDisplayCreateUUIDFromDisplayID(id).map { CFUUIDCreateString(nil, $0.takeRetainedValue()) as String }
                return saved.map { $0 == uuid } ?? (screen.localizedName == name)
            }
            guard matches.count == 1, let screen = matches.first,
                  let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { continue }
            let id = n.uint32Value
            if saved == nil, let uuid = CGDisplayCreateUUIDFromDisplayID(id) { UserDefaults.standard.set(CFUUIDCreateString(nil, uuid.takeRetainedValue()) as String, forKey: key) }
            let v = screen.visibleFrame
            result[slot] = (CGDisplayBounds(id), CGRect(x: v.minX, y: primaryHeight - v.maxY, width: v.width, height: v.height))
        }
        return result
    }

    private func save(_ app: NSRunningApplication) {
        var saved: [String: Any] = ["pid": app.processIdentifier, "launch": app.launchDate?.timeIntervalSince1970 ?? 0]
        for (slot, id) in bindings { saved[String(slot)] = id }
        UserDefaults.standard.set(saved, forKey: "humanWindows")
    }

    private func marker(_ url: URL) -> String? {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let direct = items.first(where: { $0.name == "codexPlusHumanWindow" })?.value { return direct }
        let initial = items.first(where: { $0.name == "initialRoute" })?.value
        return initial.flatMap { URLComponents(string: "https://codex.invalid" + $0)?.queryItems?.first(where: { $0.name == "codexPlusHumanWindow" })?.value }
    }

    private func windows(_ app: NSRunningApplication) -> [Window] {
        guard !app.isTerminated else { return [] }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        return (value(root, kAXWindowsAttribute) as? [AXUIElement] ?? []).compactMap { element in
            let id = cp_window_id(element)
            guard id != 0, let frame = frame(element), let url = mainURL(element) else { return nil }
            return Window(id: id, element: element, frame: frame, url: url)
        }
    }

    private func mainURL(_ root: AXUIElement) -> URL? {
        var queue = [(root, 0)], index = 0
        while index < queue.count {
            let (element, depth) = queue[index]; index += 1
            if value(element, kAXRoleAttribute) as? String == "AXWebArea" {
                guard let url = value(element, kAXURLAttribute) as? URL, HumanWindowRoute.isMain(url) else { return nil }
                return url
            }
            // Native shell only; never traverse webpage content after finding the WebArea.
            if depth < 12 { queue += (value(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).map { ($0, depth + 1) } }
        }
        return nil
    }

    private func place(_ window: Window, on screen: (frame: CGRect, visible: CGRect)) -> Bool {
        guard cp_window_id(window.element) == window.id else { return false }
        if value(window.element, kAXMinimizedAttribute) as? Bool == true {
            AXUIElementSetAttributeValue(window.element, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
            return false
        }
        switch HumanWindowPlacement.next(frame: window.frame, target: screen.visible) {
        case .ready: return true
        case .resize(var size):
            if let dimensions = AXValueCreate(.cgSize, &size) {
                AXUIElementSetAttributeValue(window.element, kAXSizeAttribute as CFString, dimensions)
            }
        case .move(var point):
            if let position = AXValueCreate(.cgPoint, &point) {
                AXUIElementSetAttributeValue(window.element, kAXPositionAttribute as CFString, position)
            }
        }
        return false
    }

    private func placementPending() {
        if Date() >= deadline { error = "window-placement-failed"; requested = false }
    }

    private func frame(_ element: AXUIElement) -> CGRect? {
        guard let p = value(element, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
              let s = value(element, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero, size = CGSize.zero
        guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
        return CGRect(origin: point, size: size)
    }
    private func value(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key as CFString, &result) == .success else { return nil }
        return result
    }
}
private extension CGRect { var centerForHumanWindow: CGPoint { CGPoint(x: midX, y: midY) } }
