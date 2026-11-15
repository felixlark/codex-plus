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
        let claimID = UUID()
        let pid: pid_t
        let element: AXUIElement
        let windowID: UInt32
        let launchDate: Date
        var lastKnownFrame: CGRect?
        var result: String
    }
    var openOwnSettings: (() -> Void)?
    var ownAgentWindow: NSWindow?
    private let display = AgentToolScreen()
    private let ocu = OpenComputerUseWindowClient()
    private let hostWindows = HumanWindows()
    private var placementRequests = 0
    private var ownershipTimer: Timer?

    private var stopping = false
    private var terminationScheduled = false
    private var lastError: String?
    private var watches: [pid_t: Watch] = [:]
    private var managed: [Managed] = []
    private var tokens: [NSObjectProtocol] = []
    private var lastOpen: [String: Any] = [:]
    private var lastRestore: [String: Any] = [:]
    private var currentOpenDocument: URL?
    private var currentOpenID: String?
    private var observationErrors: [pid_t: Int] = [:]
    private var observationEpoch = UUID()
    private var screenToken: NSObjectProtocol?
    private(set) var chromeUsesAgentDisplay = UserDefaults.standard.object(forKey: ToolWindowPolicy.chromeEnabledKey) as? Bool ?? true
    var displaySummary: String { display.summary }

    private(set) var enabled = UserDefaults.standard.object(forKey: ToolWindowPolicy.enabledKey) as? Bool ?? true

    func start() {
        guard tokens.isEmpty else { return }
        stopping = false
        ownershipTimer?.invalidate()
        ownershipTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.reconcileOwnership() }
        let center = NSWorkspace.shared.notificationCenter
        tokens.append(center.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] n in
            guard let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.remove(app.processIdentifier)
        })
        screenToken = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
            object: nil, queue: .main) { [weak self] _ in
                guard let self else { return }
                self.display.prepare { _ in }
                for watch in Array(self.watches.values) { self.scan(watch) }
            }
    }

    /// Stopping releases local ownership. Agent windows remain on the right screen.
    @discardableResult func stop() -> Bool {
        stopping = true; observationEpoch = UUID()
        tokens.forEach(NSWorkspace.shared.notificationCenter.removeObserver); tokens.removeAll()
        if let screenToken { NotificationCenter.default.removeObserver(screenToken) }; screenToken = nil
        for pid in Array(watches.keys) { removeWatch(pid) }
        managed.removeAll { $0.result != "parking" }
        guard placementRequests == 0 else { return false }
        managed.removeAll(); ownAgentWindow = nil
        ownershipTimer?.invalidate(); ownershipTimer = nil
        return true
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

    /// A failed AX inventory is unknown, never an empty manual-window baseline.
    private func verifiedBaseline(_ app: NSRunningApplication) -> [AXUIElement]? {
        guard let launch = app.launchDate, !app.isTerminated else { return nil }
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(AXUIElementCreateApplication(app.processIdentifier),
            kAXWindowsAttribute as CFString, &raw) == .success,
            let windows = raw as? [AXUIElement],
            let live = NSRunningApplication(processIdentifier: app.processIdentifier),
            !live.isTerminated, live.launchDate == launch else { return nil }
        return windows
    }

    private struct FileOpenSnapshot {
        let process: FileOpenPolicy.ProcessIdentity
        let windows: [AXUIElement]
    }

    private func fileOpenSnapshots(_ appURL: URL) -> [FileOpenSnapshot]? {
        var snapshots: [FileOpenSnapshot] = []
        for app in NSWorkspace.shared.runningApplications
            where app.bundleURL?.resolvingSymlinksInPath() == appURL {
            guard !app.isTerminated, let launchDate = app.launchDate else { return nil }
            var raw: CFTypeRef?
            guard AXUIElementCopyAttributeValue(AXUIElementCreateApplication(app.processIdentifier),
                    kAXWindowsAttribute as CFString, &raw) == .success,
                  let baseline = raw as? [AXUIElement],
                  let live = NSRunningApplication(processIdentifier: app.processIdentifier),
                  !live.isTerminated, live.launchDate == launchDate else { return nil }
            snapshots.append(FileOpenSnapshot(
                process: .init(pid: app.processIdentifier, launchDate: launchDate), windows: baseline))
        }
        return snapshots
    }

    private func existingFileInstance(_ resource: URL, snapshots: [FileOpenSnapshot]) -> Int? {
        FileOpenPolicy.existingInstance(resource: resource,
            documents: snapshots.map { Set($0.windows.compactMap(document)) })
    }

    @discardableResult
    private func watch(_ app: NSRunningApplication, baseline: [AXUIElement], documents: Set<URL>?,
                       remainder: ((Set<URL>?) -> Void)? = nil) -> Bool {
        func reportRemainder(_ watch: Watch) {
            remainder?(documents.map { $0.intersection(watch.documents ?? []) })
        }
        guard enabled, !stopping, AXIsProcessTrusted(), app.processIdentifier > 0,
              !ToolWindowPolicy.protectedBundles.contains(app.bundleIdentifier ?? "") else { return false }
        if let existing = watches[app.processIdentifier], existing.app.launchDate != app.launchDate {
            removeWatch(app.processIdentifier)
        }
        if let existing = watches[app.processIdentifier] {
            // Each request contributes its own manual-window baseline. Reusing
            // an observer must never make a later request claim those windows.
            for window in baseline where !existing.known.contains(where: { CFEqual($0, window) }) {
                existing.known.append(window)
                AXObserverAddNotification(existing.observer, window, kAXTitleChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque())
            }
            if let documents { existing.documents = (existing.documents ?? []).union(documents) }
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
        guard enabled, !stopping, watches[watch.app.processIdentifier] === watch,
              let launchDate = watch.app.launchDate,
              let live = NSRunningApplication(processIdentifier: watch.app.processIdentifier),
              !live.isTerminated, live.launchDate == launchDate else { return }
        guard let claims = watch.documents else { removeWatch(watch.app.processIdentifier); return }
        watch.documents = ToolWindowPolicy.remainingClaims(claims, knownDocuments: Set(watch.known.compactMap(document)))
        guard watch.documents?.isEmpty == false else { removeWatch(watch.app.processIdentifier); return }
        for window in windows(watch.app) where !watch.known.contains(where: { CFEqual($0, window) }) {
            guard let url = document(window), watch.documents?.contains(url) == true else {
                AXObserverAddNotification(watch.observer, window, kAXTitleChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque())
                continue
            }
            if place(window, pid: watch.app.processIdentifier) {
                // A dispatched layout is consumed even when its effect is unknown.
                watch.known.append(window); watch.documents?.remove(url)
            }
        }
        if watch.documents?.isEmpty != false { removeWatch(watch.app.processIdentifier) }
    }

    @discardableResult
    private func place(_ window: AXUIElement, pid: pid_t, mobileAnchor: Bool = false) -> Bool {
        guard enabled, !stopping, let app = NSRunningApplication(processIdentifier: pid),
              (mobileAnchor && app.bundleIdentifier == "com.openai.codex") || !ToolWindowPolicy.protectedBundles.contains(app.bundleIdentifier ?? ""),
              app.bundleIdentifier != "com.google.Chrome" || chromeUsesAgentDisplay,
              let launchDate = app.launchDate,
              ToolWindowPolicy.eligible(role: value(window, kAXRoleAttribute) as? String ?? "",
                                       subrole: value(window, kAXSubroleAttribute) as? String ?? "",
                                       minimized: value(window, kAXMinimizedAttribute) as? Bool ?? false,
                                       fullscreen: value(window, "AXFullScreen") as? Bool ?? false),
              let original = frame(window), display.currentBounds() != nil else { return false }
        let id = cp_window_id(window)
        guard id != 0, liveIdentity(window, pid: pid, id: id, launchDate: launchDate) else { return false }
        if managed.contains(where: { $0.pid == pid && $0.windowID == id }) { return true }
        let record = Managed(pid: pid, element: window, windowID: id, launchDate: launchDate,
                             lastKnownFrame: original, result: "parking")
        managed.append(record); placementRequests += 1
        ocu.call(arguments: ["app": String(pid), "window_id": Int(id), "window_placement": "right_display", "include_screenshot": false]) { [weak self] outcome in
            guard let self else { return }
            self.placementRequests -= 1
            defer { self.finishStopIfReady() }
            guard let i = self.managed.firstIndex(where: { $0.claimID == record.claimID }) else { return }
            if self.stopping { self.managed.remove(at: i); return }
            if self.definitelyGone(record) { self.managed.remove(at: i); return }
            guard self.live(record), let actual = self.frame(window), let area = self.display.currentBounds() else {
                self.managed[i].result = "parking-identity-unavailable"; return
            }
            // The provider may report an error after a partial size/position write.
            // Read the exact full frame; preserve an unknown result without replay.
            self.managed[i].lastKnownFrame = actual
            guard case .accepted = outcome, ToolWindowPolicy.contained(actual, in: area) else {
                self.managed[i].result = "parking-unconfirmed"; self.lastError = outcome.diagnostic; return
            }
            self.managed[i].result = "parked"; self.lastError = nil
            if self.lastOpen["pid"] as? Int == Int(pid),
               ToolWindowPolicy.canReportParked(requestID: self.currentOpenID, resource: self.currentOpenDocument,
                    latestRequestID: self.lastOpen["id"] as? String, actualDocument: self.document(window))
                    || self.lastOpen["windowID"] as? UInt32 == id {
                self.lastOpen["state"] = "parked"
            }
        }
        return true
    }

    func routeMobileAnchor(_ host: NSRunningApplication, request: [String: Any]) -> [String: Any]? {
        guard enabled, !stopping, host.bundleIdentifier == "com.openai.codex",
              host.bundleURL?.path == "/Applications/ChatGPT.app",
              let nonce = request["anchor"] as? String, UUID(uuidString: nonce) != nil,
              let instance = request["instance"] as? String, UUID(uuidString: instance) != nil else { return nil }
        if let id = request["windowID"] as? UInt32 {
            guard let record = managed.first(where: { $0.pid == host.processIdentifier && $0.windowID == id }), live(record) else {
                return ["phase": "unknown", "windowID": id]
            }
            guard record.result != "parking" else { return ["phase": "placing", "windowID": id] }
            if let actual = frame(record.element), let area = display.currentBounds(), ToolWindowPolicy.contained(actual, in: area) {
                return ["phase": "ready", "windowID": id]
            }
            return ["phase": "unknown", "windowID": id]
        }
        guard let window = hostWindows.mobileAnchor(host, nonce: nonce, instance: instance) else { return nil }
        guard place(window.element, pid: host.processIdentifier, mobileAnchor: true) else { return nil }
        return ["phase": "placing", "windowID": window.id]
    }

    func routeWorkbench(_ host: NSRunningApplication, request: [String: Any]) -> [String: Any]? {
        guard enabled, !stopping, host.bundleIdentifier == "com.openai.codex",
              host.bundleURL?.path == "/Applications/ChatGPT.app",
              let nonce = request["nonce"] as? String, UUID(uuidString: nonce) != nil,
              let instance = request["instance"] as? String, UUID(uuidString: instance) != nil else { return nil }
        if request["operation"] as? String == "inspect-absence", let id = request["windowID"] as? UInt32 {
            let info = windowInfo(id)
            return ["phase": info == nil || (info?[kCGWindowOwnerPID as String] as? Int32) != host.processIdentifier ? "closed" : "unknown", "windowID": id]
        }
        guard let window = hostWindows.workbench(host, nonce: nonce) else { return nil }
        if request["operation"] as? String == "identify" { return ["phase": "identified", "windowID": window.id] }
        if let id = request["windowID"] as? UInt32 {
            guard id == window.id else { return ["phase": "unknown", "windowID": id] }
            if request["operation"] as? String == "place", request["effectDispatched"] as? Bool != true {
                guard place(window.element, pid: host.processIdentifier, mobileAnchor: true) else { return nil }
                return ["phase": "placing", "windowID": id, "effectDispatched": true]
            }
            if managed.contains(where: { $0.pid == host.processIdentifier && $0.windowID == id && $0.result == "parking" }) {
                return ["phase": "placing", "windowID": id]
            }
            // A recovered/unknown exact window is inspected only. Never repeat
            // the geometry effect, even when this native process has restarted.
            let ready = frame(window.element).flatMap { actual in display.currentBounds().map { ToolWindowPolicy.contained(actual, in: $0) } } ?? false
            return ["phase": ready ? "ready" : "unknown", "windowID": id]
        }
        return ["phase": "unknown"]
    }

    private func finishStopIfReady() {
        guard stopping, placementRequests == 0, !terminationScheduled else { return }
        terminationScheduled = true
        RunLoop.main.perform(inModes: [.common]) { [weak self] in
            guard let self else { return }
            self.terminationScheduled = false
            if self.stopping, self.placementRequests == 0 { NSApp.terminate(nil) }
        }
    }

    func setChromeUsesAgentDisplay(_ flag: Bool) {
        chromeUsesAgentDisplay = flag
        UserDefaults.standard.set(flag, forKey: ToolWindowPolicy.chromeEnabledKey)
    }

    private func reconcileOwnership() {
        managed.removeAll { definitelyGone($0) }
        if stopping { finishStopIfReady(); return }
        for record in managed where record.result == "parked" {
            guard live(record), let actual = frame(record.element), let last = record.lastKnownFrame else { continue }
            if !ToolWindowPolicy.sameFrame(actual, last) { release(record) }
        }
        if ownAgentWindow?.isVisible == false { ownAgentWindow = nil }
    }

    private func release(_ record: Managed) {
        managed.removeAll { $0.claimID == record.claimID }
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

    private func definitelyGone(_ record: Managed) -> Bool {
        guard let inventory = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else { return false }
        guard let info = inventory.first(where: { $0[kCGWindowNumber as String] as? UInt32 == record.windowID }) else { return true }
        if let owner = info[kCGWindowOwnerPID as String] as? Int32, owner != record.pid { return true }
        if let date = NSRunningApplication(processIdentifier: record.pid)?.launchDate, date != record.launchDate { return true }
        return false
    }

    private func restore(pid: pid_t, id: UInt32) -> Bool {
        if pid == ProcessInfo.processInfo.processIdentifier, ownAgentWindow?.windowNumber == Int(id) {
            ownAgentWindow = nil
            lastRestore = ["pid": Int(pid), "windowID": id, "state": "released", "mode": "keep-right-screen"]
            return true
        }
        guard let record = managed.first(where: { $0.pid == pid && $0.windowID == id }), record.result != "parking" else { return false }
        release(record)
        lastRestore = ["pid": Int(pid), "windowID": id, "state": "released", "mode": "keep-right-screen"]
        return true
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
                let restored = restore(pid: identity.pid, id: identity.windowID)
                return ["ok": restored, "state": restored ? "released" : "requires-reconciliation", "status": status()]
            }
            guard let app = NSRunningApplication(processIdentifier: identity.pid),
                  let window = exactWindow(app, id: identity.windowID) else { return error("No exact live AX window for this PID/window ID") }
            guard enabled, !stopping, let original = frame(window),
                  !ToolWindowPolicy.protectedBundles.contains(app.bundleIdentifier ?? "") else { return error("Protected or unavailable Agent window") }
            let requestID = UUID().uuidString, epoch = observationEpoch
            currentOpenDocument = nil; currentOpenID = nil
            lastOpen = ["id": requestID, "pid": Int(identity.pid), "windowID": identity.windowID, "state": "preparing-display"]
            prepareDisplay(id: requestID, epoch: epoch) { [weak self] in
                guard let self else { return }
                guard let exact = self.exactWindow(app, id: identity.windowID),
                      let current = self.frame(exact), ToolWindowPolicy.sameFrame(current, original) else {
                    if self.lastOpen["id"] as? String == requestID { self.lastOpen["state"] = "window-changed-routing-cancelled" }
                    return
                }
                let parked = self.place(exact, pid: identity.pid)
                if self.lastOpen["id"] as? String == requestID { self.lastOpen["state"] = parked ? "parking" : "failed" }
            }
            return ["ok": true, "requestID": requestID, "state": "requested"]
        case "tool-open": return open(request)
        default: return error("Unsupported tool command")
        }
    }

    func setEnabled(_ flag: Bool) {
        observationEpoch = UUID(); currentOpenDocument = nil; currentOpenID = nil
        enabled = flag; UserDefaults.standard.set(flag, forKey: ToolWindowPolicy.enabledKey)
        if flag { if tokens.isEmpty { start() } }
        else {
            for pid in Array(watches.keys) { removeWatch(pid) }
            if ["preparing-display", "requested", "waiting-for-window", "waiting-for-accessibility"].contains(lastOpen["state"] as? String ?? "") { lastOpen["state"] = "routing-cancelled" }
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
                !baseline.contains(where: { CFEqual($0, w) }) && documents?.contains(self.document(w) ?? URL(fileURLWithPath: "/")) == true
                    && self.managed.contains(where: { CFEqual($0.element, w) && $0.result == "parked" })
            }
            let retry = !observed && !placed && pending?.isEmpty != true && remaining > 1
                && self.observationErrors[app.processIdentifier] == Int(AXError.cannotComplete.rawValue)
            if self.lastOpen["id"] as? String == id {
                self.lastOpen["state"] = placed ? "parked" : self.managed.contains(where: { $0.pid == app.processIdentifier && $0.result == "parking" }) ? "parking" : pending?.isEmpty == true ? "opened-in-existing-window" : observed ? "waiting-for-window" : retry ? "waiting-for-accessibility" : "observation-unavailable"
                self.lastOpen["observing"] = self.watches[app.processIdentifier] != nil
            }
            if retry { self.retryObservation(app, baseline: baseline, documents: pending, id: id, epoch: epoch, remaining: remaining - 1) }
        }
    }

    private func prepareDisplay(id: String, epoch: UUID, operation: @escaping () -> Void) {
        guard enabled, !stopping, observationEpoch == epoch else { return }
        display.prepare { [weak self] area in
            guard let self else { return }
            guard area != nil else {
                self.lastOpen = ["id": id, "state": "failed", "error": "right-physical-display-unavailable"]; return
            }
            self.ocu.call { [weak self] outcome in
                guard let self, self.enabled, !self.stopping, self.observationEpoch == epoch else { return }
                guard case .accepted = outcome else {
                    self.lastOpen = ["id": id, "state": "failed", "error": "ocu-right-display-interface-unavailable"]; return
                }
                operation()
            }
        }
    }

    private func open(_ request: [String: Any]) -> [String: Any] {
        guard enabled, !stopping else { return error("Agent window routing is paused") }
        guard AXIsProcessTrusted() else { return error("Codex Plus Accessibility permission is required") }
        guard let path = request["appPath"] as? String, path.hasPrefix("/"),
              let bundle = Bundle(path: path), path.hasSuffix(".app") else { return error("An absolute app bundle is required") }
        let id = UUID().uuidString, epoch = observationEpoch
        if bundle.bundleIdentifier == CodexWorkspacePreference.domain {
            guard let openOwnSettings else { return error("Agent Settings entry unavailable") }
            currentOpenDocument = nil; currentOpenID = nil
            lastOpen = ["id": id, "state": "preparing-display"]
            prepareDisplay(id: id, epoch: epoch) { [weak self] in
                guard let self else { return }
                openOwnSettings()
                if self.lastOpen["id"] as? String == id {
                    self.lastOpen = ["id": id, "state": self.ownAgentWindow?.isVisible == true ? "registering-agent-settings" : "failed", "windowID": self.ownAgentWindow?.windowNumber ?? 0]
                }
            }
            return ["ok": true, "requestID": id, "state": "requested"]
        }
        guard !ToolWindowPolicy.protectedBundles.contains(bundle.bundleIdentifier ?? "") else { return error("Protected user application") }
        guard let raw = request["url"] as? String, let resource = URL(string: raw), resource.isFileURL,
              FileManager.default.fileExists(atPath: resource.path) else { return error("A current local file URL is required; other tools need an exact window ID") }
        let appURL = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        currentOpenDocument = nil; currentOpenID = nil
        guard let snapshots = fileOpenSnapshots(appURL) else {
            lastOpen = ["id": id, "state": "failed", "error": "application-window-baseline-unavailable"]
            return error("Application window baseline is unavailable")
        }
        if let index = existingFileInstance(resource, snapshots: snapshots) {
            lastOpen = ["id": id, "state": "opened-in-existing-window", "pid": Int(snapshots[index].process.pid)]
            return ["ok": true, "state": "opened-in-existing-window"]
        }
        currentOpenDocument = resource.standardizedFileURL.resolvingSymlinksInPath(); currentOpenID = id
        lastOpen = ["id": id, "state": "preparing-display"]
        prepareDisplay(id: id, epoch: epoch) { [weak self] in self?.openFile(appURL: appURL, resource: resource, id: id, requestEpoch: epoch) }
        return ["ok": true, "requestID": id, "state": "requested"]
    }

    private func openFile(appURL: URL, resource: URL, id: String, requestEpoch: UUID) {
        // Capture all instances again after display preparation. LaunchServices
        // may select any running instance; array order is not an identity.
        guard let snapshots = fileOpenSnapshots(appURL) else {
            if lastOpen["id"] as? String == id {
                lastOpen = ["id": id, "state": "failed", "error": "application-window-baseline-unavailable"]
            }
            return
        }
        if let index = existingFileInstance(resource, snapshots: snapshots) {
            if lastOpen["id"] as? String == id {
                lastOpen = ["id": id, "state": "opened-in-existing-window", "pid": Int(snapshots[index].process.pid)]
            }
            return
        }
        let existingDocuments = Set(snapshots.flatMap { $0.windows.compactMap(document) })
        let scope = ToolWindowPolicy.scope(bundleID: Bundle(url: appURL)?.bundleIdentifier ?? "", resource: resource, existingDocuments: existingDocuments)
        // File document identity is public AX metadata. Web/tab identity is left
        // to the official browser tool, followed by exact tool-place if needed.
        let documents: Set<URL>?
        switch scope {
        case .document(let url): documents = [url]
        case .none: documents = []
        }
        if scope == .none {
            if lastOpen["id"] as? String == id { lastOpen["state"] = "opened-in-existing-window" }
            return
        }
        if lastOpen["id"] as? String == id { lastOpen["state"] = "requested" }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = false
        config.allowsRunningApplicationSubstitution = false
        let openCalledAt = Date()
        NSWorkspace.shared.open([resource], withApplicationAt: appURL, configuration: config) { [weak self] app, failure in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.enabled, !self.stopping, self.observationEpoch == requestEpoch else {
                    if self.lastOpen["id"] as? String == id { self.lastOpen["state"] = "routing-cancelled" }
                    return
                }
                if let failure {
                    if self.lastOpen["id"] as? String == id { self.lastOpen = ["id": id, "state": "failed", "error": failure.localizedDescription] }; return
                }
                guard let app else { if self.lastOpen["id"] as? String == id { self.lastOpen["state"] = "failed" }; return }
                guard let launchDate = app.launchDate,
                      let live = NSRunningApplication(processIdentifier: app.processIdentifier),
                      !live.isTerminated, live.launchDate == launchDate else {
                    if self.lastOpen["id"] as? String == id { self.lastOpen["state"] = "observation-unavailable" }
                    return
                }
                let baseline: [AXUIElement]
                let newProcess: Bool
                switch FileOpenPolicy.baseline(pid: app.processIdentifier, launchDate: launchDate,
                    appURL: live.bundleURL, requestedAppURL: appURL, openCalledAt: openCalledAt,
                    captured: snapshots.map(\.process)) {
                case .captured(let index): baseline = snapshots[index].windows; newProcess = false
                case .newProcess: baseline = []; newProcess = true
                case .unavailable:
                    if self.lastOpen["id"] as? String == id {
                        self.lastOpen = ["id": id, "state": "observation-unavailable",
                            "pid": Int(app.processIdentifier), "error": "application-window-baseline-unavailable"]
                    }
                    return
                }
                if let watch = self.watches[app.processIdentifier] { self.scan(watch) }
                var pending = documents
                let observed: Bool
                if scope != .none {
                    // Claims are created only here, against the actual instance.
                    // Initial scan covers windows created before completion.
                    if let documents,
                            ToolWindowPolicy.remainingClaims(documents, knownDocuments: Set(baseline.compactMap(self.document))).isEmpty {
                        pending = []; observed = false
                    } else { observed = self.watch(app, baseline: baseline, documents: documents, remainder: { pending = $0 }) }
                } else {
                    // Temporal coincidence is not evidence of tool ownership.
                    // Browser/non-file windows need an explicit window ID.
                    observed = false
                }
                let placed = self.windows(app).contains { w in
                    !baseline.contains(where: { CFEqual($0, w) }) && documents?.contains(self.document(w) ?? URL(fileURLWithPath: "/")) == true
                    && self.managed.contains(where: { CFEqual($0.element, w) && $0.result == "parked" })
                }
                let reused = baseline.compactMap(self.document).contains(resource.standardizedFileURL.resolvingSymlinksInPath())
                let state = placed ? "parked" : self.managed.contains(where: { $0.pid == app.processIdentifier && $0.result == "parking" }) ? "parking" : reused ? "opened-in-existing-window" : observed ? "waiting-for-window" : scope != .none ? "observation-unavailable" : "opened-without-window-rule"
                if self.lastOpen["id"] as? String == id {
                    self.lastOpen = ["id": id, "state": state, "pid": Int(app.processIdentifier), "observing": observed, "newProcess": newProcess]
                }
                if scope != .none && !observed && !placed && pending?.isEmpty != true,
                   self.observationErrors[app.processIdentifier] == Int(AXError.cannotComplete.rawValue) {
                    if self.lastOpen["id"] as? String == id { self.lastOpen["state"] = "waiting-for-accessibility" }
                    self.retryObservation(app, baseline: baseline, documents: pending, id: id, epoch: requestEpoch)
                }
            }
        }
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
        display.prepare { _ in }
        var target: [String: Any] = ["type": "right-physical-display", "owner": "WindowServer", "supported": display.supported]
        if let area = display.currentBounds() { target["id"] = display.id; target["name"] = display.name; target["frame"] = jsonFrame(area) }
        var windows = managed.map { record -> [String: Any] in
            var result: [String: Any] = ["pid": record.pid, "windowID": record.windowID, "result": record.result, "restoreMode": "release-only"]
            if let frame = frame(record.element) { result["frame"] = jsonFrame(frame) }; return result
        }
        if let ownAgentWindow, ownAgentWindow.isVisible { windows.append(["pid": ProcessInfo.processInfo.processIdentifier, "windowID": ownAgentWindow.windowNumber, "result": "agent-settings"]) }
        return ["ok": true, "enabled": enabled, "chromeUsesAgentDisplay": chromeUsesAgentDisplay, "displaySummary": displaySummary,
                "accessibility": AXIsProcessTrusted(), "target": target, "lastOpen": lastOpen, "lastRestore": lastRestore,
                "watchedProcesses": watches.count, "windows": windows, "pendingPlacements": placementRequests,
                "observationErrors": observationErrors.map { ["pid": Int($0.key), "code": $0.value] }, "lastError": lastError ?? display.error ?? ""]
    }

    private func ownAgentWindowIsParked(_ window: NSWindow) -> Bool {
        guard window.isVisible, let area = display.currentBounds() else { return false }
        let height = CGDisplayBounds(CGMainDisplayID()).height
        return ToolWindowPolicy.contained(CGRect(x: window.frame.minX, y: height - window.frame.maxY, width: window.frame.width, height: window.frame.height), in: area)
    }

    func prepareAgentWindow(_ window: NSWindow) -> Bool {
        guard enabled, !stopping, let area = display.currentBounds() else { return false }
        if window.isVisible && !ownAgentWindowIsParked(window) { ownAgentWindow = nil; lastError = "agent-settings-handed-to-user"; return false }
        let target = ToolWindowPolicy.destination(frame: window.frame, area: area)
        window.setFrame(NSRect(x: target.minX, y: CGDisplayBounds(CGMainDisplayID()).height - target.maxY, width: target.width, height: target.height), display: false)
        ownAgentWindow = window; return true
    }

    func registerAgentWindow(_ window: NSWindow) {
        guard window === ownAgentWindow else { return }
        if ownAgentWindowIsParked(window) {
            lastError = nil
            if lastOpen["windowID"] as? Int == window.windowNumber { lastOpen["state"] = "opened-agent-settings" }
        } else { lastError = "right-screen-placement-unconfirmed"; lastOpen["state"] = "failed" }
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
