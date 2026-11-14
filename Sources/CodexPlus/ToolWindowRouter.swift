import AppKit
import ApplicationServices
import CodexPlusCore
import AgentDisplayShim

/// The existing Codex Plus process is the sole owner of quiet tool placement.
/// No activation restoration loop: prevent activation at launch instead.
final class ToolWindowRouter {
    private final class Watch {
        let app: NSRunningApplication
        let observer: AXObserver
        var known: [AXUIElement]
        var documents: Set<URL>?
        init(app: NSRunningApplication, observer: AXObserver, known: [AXUIElement], documents: Set<URL>?) {
            self.app = app; self.observer = observer; self.known = known; self.documents = documents
        }
    }
    private struct Managed {
        let pid: pid_t
        let element: AXUIElement
        let windowID: UInt32
        let launchDate: Date
        let originalFrame: CGRect
        let originalDisplays: [UInt32: CGRect]
        var lastKnownFrame: CGRect?
        var result: String
    }
    var openOwnSettings: (() -> Void)?
    var ownAgentWindow: NSWindow?
    private let display = AgentDisplay()
    private var stopping = false
    private var lastError: String?
    private var watches: [pid_t: Watch] = [:]
    private var managed: [Managed] = []
    private var tokens: [NSObjectProtocol] = []
    private var lastOpen: [String: Any] = [:]
    private var observationErrors: [pid_t: Int] = [:]
    private var observationEpoch = UUID()
    private var screenToken: NSObjectProtocol?
    private(set) var enabled = UserDefaults.standard.object(forKey: ToolWindowPolicy.enabledKey) as? Bool ?? true

    func start() {
        guard tokens.isEmpty else { return }
        for key in ["quietToolDisplayUUID", "quietToolWindowsEnabled"] { UserDefaults.standard.removeObject(forKey: key) }
        let center = NSWorkspace.shared.notificationCenter
        tokens.append(center.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] n in
            guard let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.remove(app.processIdentifier)
        })
        screenToken = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
            object: nil, queue: .main) { [weak self] _ in
                guard let self else { return }
                // Only still-pending windows; handled/user-moved windows stay put.
                for w in Array(self.watches.values) { self.scan(w) }
            }
    }

    /// A failed restore retains the display and lets the caller cancel quit.
    @discardableResult
    func stop() -> Bool {
        stopping = true
        observationEpoch = UUID()
        tokens.forEach(NSWorkspace.shared.notificationCenter.removeObserver)
        tokens.removeAll()
        if let screenToken { NotificationCenter.default.removeObserver(screenToken) }
        screenToken = nil
        for pid in Array(watches.keys) { removeWatch(pid) }
        if let window = ownAgentWindow, ownAgentWindowIsParked(window) { window.close() }
        ownAgentWindow = nil
        let keys = managed.map { ($0.pid, $0.windowID) }
        var restored = true
        for (pid, id) in keys { if !restore(pid: pid, id: id) { restored = false } }
        guard restored else { return false }
        return display.release()
    }

    private func removeWatch(_ pid: pid_t) {
        guard let w = watches.removeValue(forKey: pid) else { return }
        CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(w.observer), .commonModes)
    }

    private func remove(_ pid: pid_t) {
        removeWatch(pid)
        managed.removeAll { $0.pid == pid }
        observationErrors.removeValue(forKey: pid)
    }

    private func windows(_ app: NSRunningApplication) -> [AXUIElement] {
        value(AXUIElementCreateApplication(app.processIdentifier), kAXWindowsAttribute) as? [AXUIElement] ?? []
    }

    @discardableResult
    private func watch(_ app: NSRunningApplication, baseline: [AXUIElement], documents: Set<URL>?,
                       remainder: ((Set<URL>?) -> Void)? = nil) -> Bool {
        func reportRemainder(_ watch: Watch) {
            remainder?(documents.map { $0.intersection(watch.documents ?? []) })
        }
        guard enabled, !stopping, AXIsProcessTrusted(), app.processIdentifier > 0,
              !ToolWindowPolicy.protectedBundles.contains(app.bundleIdentifier ?? "") else { return false }
        if let existing = watches[app.processIdentifier] {
            // Each request contributes its own manual-window baseline. Reusing
            // an observer must never make a later request claim those windows.
            for window in baseline where !existing.known.contains(where: { CFEqual($0, window) }) {
                existing.known.append(window)
                AXObserverAddNotification(existing.observer, window, kAXTitleChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque())
            }
            if let documents { existing.documents?.formUnion(documents) }
            scan(existing); reportRemainder(existing); return true
        }
        var observer: AXObserver?
        let creation = AXObserverCreate(app.processIdentifier, { _, _, _, context in
            guard let context else { return }
            let owner = Unmanaged<ToolWindowRouter>.fromOpaque(context).takeUnretainedValue()
            // AX callbacks are delivered on the main run loop.
            for w in Array(owner.watches.values) { owner.scan(w) }
        }, &observer)
        guard creation == .success, let observer else {
            observationErrors[app.processIdentifier] = Int(creation.rawValue)
            return false
        }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let watch = Watch(app: app, observer: observer, known: baseline, documents: documents)
        watches[app.processIdentifier] = watch
        let results = [kAXWindowCreatedNotification, kAXFocusedWindowChangedNotification].map {
            AXObserverAddNotification(observer, appElement, $0 as CFString, Unmanaged.passUnretained(self).toOpaque())
        }
        guard results.contains(where: { $0 == .success || $0 == .notificationAlreadyRegistered }) else {
            observationErrors[app.processIdentifier] = Int(results[0].rawValue)
            // Existing windows can still be placed even when this application
            // does not publish window notifications. Do not claim observation.
            scan(watch)
            reportRemainder(watch)
            watches.removeValue(forKey: app.processIdentifier); return false
        }
        observationErrors.removeValue(forKey: app.processIdentifier)
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes)
        for window in baseline {
            AXObserverAddNotification(observer, window, kAXTitleChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque())
        }
        scan(watch)
        reportRemainder(watch)
        return true
    }

    private func scan(_ watch: Watch) {
        guard enabled else { return }
        if let claims = watch.documents {
            // Opening a file as a tab in an existing manual window consumes
            // the request without taking ownership of that window.
            watch.documents = ToolWindowPolicy.remainingClaims(claims, knownDocuments: Set(watch.known.compactMap(document)))
            if watch.documents?.isEmpty == true { removeWatch(watch.app.processIdentifier); return }
        }
        for window in windows(watch.app) where !watch.known.contains(where: { CFEqual($0, window) }) {
            if let documents = watch.documents {
                guard let raw = value(window, kAXDocumentAttribute) as? String,
                      let url = URL(string: raw), documents.contains(url.standardizedFileURL) else {
                    // Document metadata may become available after AXWindowCreated.
                    AXObserverAddNotification(watch.observer, window, kAXTitleChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque())
                    continue
                }
            }
            if place(window, pid: watch.app.processIdentifier) {
                watch.known.append(window)
                if watch.documents != nil, let raw = value(window, kAXDocumentAttribute) as? String, let url = URL(string: raw) {
                    watch.documents?.remove(url.standardizedFileURL)
                }
            }
        }
        // A mixed-use app is observed only until this exact document is claimed.
        if watch.documents?.isEmpty == true { removeWatch(watch.app.processIdentifier) }
    }

    @discardableResult
    private func place(_ window: AXUIElement, pid: pid_t) -> Bool {
        guard enabled, !stopping, let app = NSRunningApplication(processIdentifier: pid),
              !ToolWindowPolicy.protectedBundles.contains(app.bundleIdentifier ?? ""),
              let launchDate = app.launchDate,
              ToolWindowPolicy.eligible(role: value(window, kAXRoleAttribute) as? String ?? "",
                                       subrole: value(window, kAXSubroleAttribute) as? String ?? "",
                                       minimized: value(window, kAXMinimizedAttribute) as? Bool ?? false,
                                       fullscreen: value(window, "AXFullScreen") as? Bool ?? false),
              let original = frame(window) else { return false }
        let id = cp_window_id(window)
        guard id != 0, liveIdentity(window, pid: pid, id: id, launchDate: launchDate) else { return false }
        if let i = managed.firstIndex(where: { $0.pid == pid && $0.windowID == id }) {
            guard live(managed[i]) else { lastError = "window-identity-unavailable"; return false }
            if let last = managed[i].lastKnownFrame, ToolWindowPolicy.sameFrame(original, last) { return managed[i].result == "parked" }
            managed.remove(at: i) // Explicit new claim after a user move.
        }
        let origin = AgentDisplay.displays().filter { $0.key != display.id && $0.value.contains(CGPoint(x: original.midX, y: original.midY)) }
        guard !origin.isEmpty, let bounds = display.ensure() else { lastError = display.error ?? "original-display-unavailable"; return false }
        let area = bounds.insetBy(dx: 20, dy: 20)
        let target = ToolWindowPolicy.destination(frame: original, area: area)
        managed.append(Managed(pid: pid, element: window, windowID: id, launchDate: launchDate,
                               originalFrame: original, originalDisplays: origin, lastKnownFrame: original, result: "parking"))
        let i = managed.count - 1
        let outcome = ToolWindowPolicy.parkTransaction(original: original, target: target, write: { rect in
            if self.live(self.managed[i]) { _ = self.writeFrame(window, to: rect) }
        }, read: { self.live(self.managed[i]) ? self.frame(window) : nil })
        switch outcome {
        case .parked(let actual):
            managed[i].lastKnownFrame = actual; managed[i].result = "parked"
            if lastOpen["pid"] as? Int == Int(pid) { lastOpen["state"] = "parked" }
            return true
        case .rolledBack: managed.remove(at: i)
        case .recoveryRequired(let actual): managed[i].lastKnownFrame = actual; managed[i].result = "rollback-failed"
        }
        lastError = "parking-failed"
        return false
    }

    private func writeFrame(_ window: AXUIElement, to rect: CGRect) -> Bool {
        var point = rect.origin; var size = rect.size
        guard let position = AXValueCreate(.cgPoint, &point), let dimensions = AXValueCreate(.cgSize, &size),
              let current = frame(window) else { return false }
        if abs(current.width - rect.width) > 1 || abs(current.height - rect.height) > 1 {
            guard AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, dimensions) == .success else { return false }
        }
        guard AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, position) == .success,
              let actual = frame(window) else { return false }
        return ToolWindowPolicy.sameFrame(actual, rect)
    }

    private func liveIdentity(_ window: AXUIElement, pid: pid_t, id: UInt32, launchDate: Date) -> Bool {
        var owner: pid_t = 0
        guard AXUIElementGetPid(window, &owner) == .success,
              let app = NSRunningApplication(processIdentifier: pid),
              let info = windowInfo(id), let cgPID = info[kCGWindowOwnerPID as String] as? Int32 else { return false }
        return owner == pid && cgPID == pid && ToolWindowPolicy.matchesIdentity(pid: pid, windowID: id, launchDate: launchDate,
                     livePID: app.processIdentifier, liveWindowID: cp_window_id(window), liveLaunchDate: app.launchDate)
    }
    private func live(_ record: Managed) -> Bool {
        liveIdentity(record.element, pid: record.pid, id: record.windowID, launchDate: record.launchDate)
    }

    private func restore(pid: pid_t, id: UInt32) -> Bool {
        if pid == ProcessInfo.processInfo.processIdentifier, ownAgentWindow?.windowNumber == Int(id) {
            if let window = ownAgentWindow, ownAgentWindowIsParked(window) { window.close() }
            ownAgentWindow = nil; return true
        }
        guard let i = managed.firstIndex(where: { $0.pid == pid && $0.windowID == id }) else { return false }
        let record = managed[i]
        guard let inventory = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
            managed[i].result = "restore-window-query-unavailable"; return false
        }
        let info = inventory.first { ($0[kCGWindowNumber as String] as? UInt32) == id }
        if info == nil || (info?[kCGWindowOwnerPID as String] as? Int32) != pid {
            managed.remove(at: i); return true
        }
        if let launch = NSRunningApplication(processIdentifier: pid)?.launchDate, launch != record.launchDate {
            managed.remove(at: i); return true
        }
        guard live(record), let actual = frame(record.element), let last = record.lastKnownFrame else {
            managed[i].result = "restore-identity-unavailable"; return false
        }
        guard ToolWindowPolicy.sameFrame(actual, last) else {
            managed.remove(at: i); return true // The user took over; leave it alone.
        }
        let displays = AgentDisplay.displays()
        guard record.originalDisplays.contains(where: { displays[$0.key] == $0.value }) else {
            managed[i].result = "restore-original-display-unavailable"; return false
        }
        let restored = writeFrame(record.element, to: record.originalFrame)
        if restored { managed.remove(at: i) }
        else { managed[i].lastKnownFrame = frame(record.element); managed[i].result = "restore-failed" }
        return restored
    }

    func command(_ request: [String: Any]) -> [String: Any] {
        switch request["command"] as? String {
        case "tool-status": return status()
        case "tool-routing":
            guard let flag = request["enabled"] as? Bool else { return error("enabled is required") }
            setEnabled(flag); return status()
        case "tool-place", "tool-restore":
            guard let pid = request["pid"] as? Int, let id = request["windowID"] as? Int,
                  let identity = ToolCommand.windowIdentity(pid: pid, windowID: id) else { return error("Valid PID/window ID required") }
            if request["command"] as? String == "tool-restore" {
                return ["ok": restore(pid: identity.pid, id: identity.windowID), "status": status()]
            }
            guard let app = NSRunningApplication(processIdentifier: identity.pid),
                  let window = exactWindow(app, id: identity.windowID) else { return error("No exact live AX window for this PID/window ID") }
            return ["ok": place(window, pid: identity.pid), "status": status()]
        case "tool-open": return open(request)
        default: return error("Unsupported tool command")
        }
    }

    func setEnabled(_ flag: Bool) {
        if !flag { observationEpoch = UUID() }
        stopping = false
        enabled = flag
        UserDefaults.standard.set(flag, forKey: ToolWindowPolicy.enabledKey)
        if flag {
            if tokens.isEmpty { start() }
        } else {
            for pid in Array(watches.keys) { removeWatch(pid) }
        }
    }

    // Retry only AX readiness for the same explicitly requested file.
    // This never opens the app again or infers ownership from elapsed time.
    private func retryObservation(_ app: NSRunningApplication, baseline: [AXUIElement], documents: Set<URL>?,
                                  id: String, epoch: UUID, remaining: Int = 8) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, self.enabled, !self.stopping, self.observationEpoch == epoch, !app.isTerminated else { return }
            var pending = documents
            let observed = self.watch(app, baseline: baseline, documents: documents, remainder: { pending = $0 })
            let placed = self.windows(app).contains { w in
                !baseline.contains(where: { CFEqual($0, w) }) && self.managed.contains(where: { CFEqual($0.element, w) })
            }
            let retry = !observed && !placed && pending?.isEmpty != true && remaining > 1
                && self.observationErrors[app.processIdentifier] == Int(AXError.cannotComplete.rawValue)
            if self.lastOpen["id"] as? String == id {
                self.lastOpen["state"] = placed ? "parked" : pending?.isEmpty == true ? "opened-in-existing-window" : observed ? "waiting-for-window" : retry ? "waiting-for-accessibility" : "observation-unavailable"
                self.lastOpen["observing"] = self.watches[app.processIdentifier] != nil
            }
            if retry { self.retryObservation(app, baseline: baseline, documents: pending, id: id, epoch: epoch, remaining: remaining - 1) }
        }
    }

    private func open(_ request: [String: Any]) -> [String: Any] {
        guard enabled, !stopping else { return error("Agent window routing is paused") }
        guard AXIsProcessTrusted() else { return error("Codex Plus Accessibility permission is required") }
        guard let path = request["appPath"] as? String, path.hasPrefix("/"),
              let bundle = Bundle(path: path), path.hasSuffix(".app") else { return error("Use an absolute, non-protected app bundle path") }
        if bundle.bundleIdentifier == CodexWorkspacePreference.domain {
            guard let openOwnSettings, display.ensure() != nil else { return error(display.error ?? "Agent Settings entry unavailable") }
            openOwnSettings()
            lastOpen = ["state": "opened-agent-settings", "windowID": ownAgentWindow?.windowNumber ?? 0]
            return ["ok": ownAgentWindow?.isVisible == true, "state": "opened-agent-settings",
                    "windowID": ownAgentWindow?.windowNumber ?? 0]
        }
        guard !ToolWindowPolicy.protectedBundles.contains(bundle.bundleIdentifier ?? "") else { return error("Protected user application") }
        let appURL = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        let existing = NSWorkspace.shared.runningApplications.first { $0.bundleURL?.resolvingSymlinksInPath() == appURL }
        let baseline = existing.map(windows) ?? []
        let resource: URL?
        if let raw = request["url"] as? String {
            guard let url = URL(string: raw), url.isFileURL, FileManager.default.fileExists(atPath: url.path) else { return error("A current local file URL is required; other tools need an explicit window ID") }
            resource = url
        } else { return error("A local file URL is required; use tool-place for a known Agent window") }
        let existingDocuments = Set(baseline.compactMap { document($0) })
        let scope = ToolWindowPolicy.scope(bundleID: bundle.bundleIdentifier ?? "", resource: resource, existingDocuments: existingDocuments)
        // File document identity is public AX metadata. Web/tab identity is left
        // to the official browser tool, followed by exact tool-place if needed.
        let documents: Set<URL>?
        switch scope {
        case .document(let url): documents = [url]
        case .none: documents = []
        }
        if scope == .none {
            lastOpen = ["state": "opened-in-existing-window", "pid": Int(existing?.processIdentifier ?? 0)]
            return ["ok": true, "state": "opened-in-existing-window"]
        }
        guard display.ensure() != nil else { return error(display.error ?? "Agent display unavailable") }
        let preObserved: Bool
        if let existing, documents?.isEmpty == false { preObserved = watch(existing, baseline: baseline, documents: documents) }
        else { preObserved = false }
        let id = UUID().uuidString
        lastOpen = ["id": id, "state": "requested"]
        if let existing { lastOpen["pid"] = Int(existing.processIdentifier) }
        let requestEpoch = observationEpoch
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        let completion: (NSRunningApplication?, Error?) -> Void = { [weak self] app, failure in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.enabled, !self.stopping, self.observationEpoch == requestEpoch else {
                    if self.lastOpen["id"] as? String == id { self.lastOpen["state"] = "routing-cancelled" }
                    return
                }
                if let failure {
                    if let documents, let existing, let watch = self.watches[existing.processIdentifier], watch.documents != nil {
                        watch.documents?.subtract(documents)
                        if watch.documents?.isEmpty == true { self.removeWatch(existing.processIdentifier) }
                    }
                    self.lastOpen = ["id": id, "state": "failed", "error": failure.localizedDescription]; return
                }
                guard let app else { self.lastOpen = ["id": id, "state": "failed"]; return }
                if let watch = self.watches[app.processIdentifier] { self.scan(watch) }
                var pending = documents
                let observed: Bool
                if scope != .none {
                    // Never recreate a pre-open claim that was already consumed
                    // by an AX event (including an existing-window/tab reuse).
                    if preObserved { observed = self.watches[app.processIdentifier] != nil }
                    else if let documents,
                            ToolWindowPolicy.remainingClaims(documents, knownDocuments: Set(baseline.compactMap(self.document))).isEmpty {
                        pending = []; observed = false
                    } else { observed = self.watch(app, baseline: baseline, documents: documents, remainder: { pending = $0 }) }
                } else {
                    // Temporal coincidence is not evidence of tool ownership.
                    // Browser/non-file windows need an explicit window ID.
                    observed = false
                }
                let placed = self.windows(app).contains { w in
                    !baseline.contains(where: { CFEqual($0, w) }) && self.managed.contains(where: { CFEqual($0.element, w) })
                }
                let reused = resource?.isFileURL == true && baseline.compactMap(self.document).contains(resource!.standardizedFileURL)
                let state = placed ? "parked" : reused ? "opened-in-existing-window" : observed ? "waiting-for-window" : scope != .none ? "observation-unavailable" : "opened-without-window-rule"
                self.lastOpen = ["id": id, "state": state,
                                 "pid": Int(app.processIdentifier), "observing": observed,
                                 "newProcess": existing == nil]
                if scope != .none && !observed && !placed && pending?.isEmpty != true,
                   self.observationErrors[app.processIdentifier] == Int(AXError.cannotComplete.rawValue) {
                    self.lastOpen["state"] = "waiting-for-accessibility"
                    self.retryObservation(app, baseline: baseline, documents: pending, id: id, epoch: requestEpoch)
                }
            }
        }
        if let url = resource {
            NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: config, completionHandler: completion)
        } else {
            NSWorkspace.shared.openApplication(at: appURL, configuration: config, completionHandler: completion)
        }
        return ["ok": true, "requestID": id, "state": "requested"]
    }

    private func windowInfo(_ id: UInt32) -> [String: Any]? {
        (CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]])?
            .first { ($0[kCGWindowNumber as String] as? UInt32) == id }
    }

    private func exactWindow(_ app: NSRunningApplication, id: UInt32) -> AXUIElement? {
        guard let launch = app.launchDate else { return nil }
        let matching = windows(app).filter { cp_window_id($0) == id && liveIdentity($0, pid: app.processIdentifier, id: id, launchDate: launch) }
        return matching.count == 1 ? matching[0] : nil
    }

    private func status() -> [String: Any] {
        var target: [String: Any] = ["type": "agent-virtual-display", "supported": display.supported]
        if let bounds = display.bounds {
            target["id"] = display.id; target["name"] = "Codex Plus Agent"
            target["frame"] = jsonFrame(bounds)
        }
        var windows = managed.map { record -> [String: Any] in
            var result: [String: Any] = ["pid": record.pid, "windowID": record.windowID, "result": record.result]
            if let f = frame(record.element) { result["frame"] = jsonFrame(f) }
            return result
        }
        if let ownAgentWindow, ownAgentWindow.isVisible {
            windows.append(["pid": ProcessInfo.processInfo.processIdentifier, "windowID": ownAgentWindow.windowNumber, "result": "agent-settings"])
        }
        return ["ok": true, "enabled": enabled, "accessibility": AXIsProcessTrusted(), "target": target,
                "lastOpen": lastOpen, "watchedProcesses": watches.count, "windows": windows,
                "observationErrors": observationErrors.map { ["pid": Int($0.key), "code": $0.value] },
                "lastError": lastError ?? display.error ?? ""]
    }

    private func ownAgentWindowIsParked(_ window: NSWindow) -> Bool {
        guard window.isVisible, let bounds = display.bounds else { return false }
        let height = CGDisplayBounds(CGMainDisplayID()).height
        let rect = CGRect(x: window.frame.minX, y: height - window.frame.maxY, width: window.frame.width, height: window.frame.height)
        return ToolWindowPolicy.contained(rect, in: bounds)
    }

    func prepareAgentWindow(_ window: NSWindow) -> Bool {
        guard enabled, !stopping, let bounds = display.ensure() else { return false }
        let primaryHeight = CGDisplayBounds(CGMainDisplayID()).height
        let current = CGRect(x: window.frame.minX, y: primaryHeight - window.frame.maxY, width: window.frame.width, height: window.frame.height)
        if window.isVisible && !ToolWindowPolicy.contained(current, in: bounds) {
            ownAgentWindow = nil; lastError = "agent-settings-handed-to-user"; return false
        }
        let original = CGRect(x: 0, y: 0, width: window.frame.width, height: window.frame.height)
        let target = ToolWindowPolicy.destination(frame: original, area: bounds.insetBy(dx: 20, dy: 20))
        window.setFrame(NSRect(x: target.minX, y: primaryHeight - target.maxY, width: target.width, height: target.height), display: false)
        ownAgentWindow = window
        return true
    }

    private func jsonFrame(_ f: CGRect) -> [String: CGFloat] {
        ["x": f.minX, "y": f.minY, "width": f.width, "height": f.height]
    }

    private func error(_ message: String) -> [String: Any] { ["ok": false, "error": message] }
    private func document(_ window: AXUIElement) -> URL? {
        (value(window, kAXDocumentAttribute) as? String).flatMap(URL.init(string:))?.standardizedFileURL.resolvingSymlinksInPath()
    }
    private func value(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var v: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &v) == .success else { return nil }
        return v
    }
    private func frame(_ window: AXUIElement) -> CGRect? {
        guard let p = value(window, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
              let s = value(window, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero; var size = CGSize.zero
        guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size), size.width > 0, size.height > 0 else { return nil }
        return CGRect(x: point.x, y: point.y, width: size.width, height: size.height)
    }
}
