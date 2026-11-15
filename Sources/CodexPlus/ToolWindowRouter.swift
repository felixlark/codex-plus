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
        var defaultChrome = false
        var defaultKnown: [AXUIElement] = []
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
        let originalFrame: CGRect
        let originalDisplays: [UInt32: CGRect]
        var lastKnownFrame: CGRect?
        var result: String
    }
    var openOwnSettings: (() -> Void)?
    var ownAgentWindow: NSWindow?
    private let display = AgentDisplay()
    private let ocu = OpenComputerUseWindowClient()
    private var agentSettingsRegistration: UInt32?
    private var registeredAgentSettings: UInt32?
    private var agentReleaseUnconfirmed = false
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
    private var preparingChrome = false
    private var startupRecovery = AgentDisplayStartupRecovery()
    private(set) var chromeUsesAgentDisplay = UserDefaults.standard.object(forKey: ToolWindowPolicy.chromeEnabledKey) as? Bool ?? true
    var displaySummary: String {
        guard enabled, !startupRecovery.isReady else { return display.summary }
        guard display.supported else { return display.summary }
        if let error = startupRecovery.lastError { return "自动恢复等待重试 · " + error }
        return startupRecovery.inFlight != nil ? "正在自动恢复 OCU 虚拟屏" : "等待自动恢复 OCU 虚拟屏"
    }
    private func recoveryParameter(_ key: String, fallback: TimeInterval) -> TimeInterval {
        let value = UserDefaults.standard.object(forKey: key) as? Double ?? fallback
        return value.isFinite && value > 0 ? value : fallback
    }


    private(set) var enabled = UserDefaults.standard.object(forKey: ToolWindowPolicy.enabledKey) as? Bool ?? true

    func start() {
        guard tokens.isEmpty else { return }
        ownershipTimer?.invalidate()
        ownershipTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.reconcileOwnership() }
        for key in ["quietToolDisplayUUID", "quietToolWindowsEnabled"] { UserDefaults.standard.removeObject(forKey: key) }
        let center = NSWorkspace.shared.notificationCenter
        tokens.append(center.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { [weak self] n in
            guard let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            self?.remove(app.processIdentifier)
        })
        startupRecovery.request(enabled: enabled)
        recoverStartupDisplayIfNeeded()
        tokens.append(center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.recoverStartupDisplayIfNeeded()
        })
        tokens.append(center.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { [weak self] _ in
            self?.observeDefaultChrome()
        })
        screenToken = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification,
            object: nil, queue: .main) { [weak self] _ in
                guard let self else { return }
                // Only still-pending windows; handled/user-moved windows stay put.
                self.display.prepare { _ in }
                self.recoverStartupDisplayIfNeeded()
                self.observeDefaultChrome()
                for w in Array(self.watches.values) { self.scan(w) }
            }
    }

    /// A failed restore retains exact records and lets the caller cancel quit.
    @discardableResult
    func stop() -> Bool {
        stopping = true
        startupRecovery.request(enabled: false)
        // Keep the existing observer alive until restoration completes. A window
        // can close while an asynchronous restore is pending; its exact record
        // must then be reconciled without retrying an unknown restore effect.
        observationEpoch = UUID()
        tokens.forEach(NSWorkspace.shared.notificationCenter.removeObserver)
        tokens.removeAll()
        if let screenToken { NotificationCenter.default.removeObserver(screenToken) }
        screenToken = nil
        for pid in Array(watches.keys) { removeWatch(pid) }
        if let window = ownAgentWindow {
            if !window.isVisible { ownAgentWindow = nil; registeredAgentSettings = nil }
            else if ownAgentWindowIsParked(window) { window.close(); ownAgentWindow = nil; registeredAgentSettings = nil }
            else { forgetAgentSettings() }
        }
        let keys = managed.map { ($0.pid, $0.windowID) }
        var restored = true
        for (pid, id) in keys { if !restore(pid: pid, id: id, preservingBornHidden: true) { restored = false } }
        guard restored, managed.isEmpty, agentSettingsRegistration == nil, ownAgentWindow == nil, startupRecovery.inFlight == nil else { return false }
        guard display.release() else { return false }
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
                       defaultChrome: Bool = false, remainder: ((Set<URL>?) -> Void)? = nil) -> Bool {
        func reportRemainder(_ watch: Watch) {
            remainder?(documents.map { $0.intersection(watch.documents ?? []) })
        }
        guard enabled, !stopping, AXIsProcessTrusted(), app.processIdentifier > 0,
              !ToolWindowPolicy.protectedBundles.contains(app.bundleIdentifier ?? "") else { return false }
        if let existing = watches[app.processIdentifier], existing.app.launchDate != app.launchDate {
            removeWatch(app.processIdentifier)
        }
        if let existing = watches[app.processIdentifier] {
            if defaultChrome && !existing.defaultChrome { existing.defaultKnown = baseline }
            existing.defaultChrome = existing.defaultChrome || defaultChrome
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
        watch.defaultChrome = defaultChrome
        if defaultChrome { watch.defaultKnown = baseline }
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
        guard enabled, startupRecovery.isReady, watches[watch.app.processIdentifier] === watch,
              let launchDate = watch.app.launchDate else { return }
        guard let live = NSRunningApplication(processIdentifier: watch.app.processIdentifier),
              !live.isTerminated, live.launchDate == launchDate else {
            removeWatch(watch.app.processIdentifier); return
        }
        if let claims = watch.documents {
            // Opening a file as a tab in an existing manual window consumes
            // the request without taking ownership of that window.
            watch.documents = ToolWindowPolicy.remainingClaims(claims, knownDocuments: Set(watch.known.compactMap(document)))
            if !ToolWindowPolicy.retainsObservation(defaultChrome: watch.defaultChrome, documents: watch.documents) { removeWatch(watch.app.processIdentifier); return }
        }
        let handled = watch.defaultChrome ? watch.defaultKnown : watch.known
        for window in windows(watch.app) where !handled.contains(where: { CFEqual($0, window) }) {
            if watch.defaultChrome {
                guard value(window, kAXSubroleAttribute) as? String == "AXStandardWindow" else { continue }
                // Already parked windows may belong to another OCU client.
                // The default is satisfied; preserve that client's restore record.
                if let bounds = display.currentBounds(), let current = frame(window),
                   ToolWindowPolicy.contained(current, in: bounds) {
                    watch.defaultKnown.append(window); continue
                }
            } else if let documents = watch.documents {
                guard let raw = value(window, kAXDocumentAttribute) as? String,
                      let url = URL(string: raw), documents.contains(url.standardizedFileURL) else {
                    // Document metadata may become available after AXWindowCreated.
                    AXObserverAddNotification(watch.observer, window, kAXTitleChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque())
                    continue
                }
            }
            if place(window, pid: watch.app.processIdentifier) {
                watch.known.append(window)
                if watch.defaultChrome { watch.defaultKnown.append(window) }
                if watch.documents != nil, let raw = value(window, kAXDocumentAttribute) as? String, let url = URL(string: raw) {
                    watch.documents?.remove(url.standardizedFileURL)
                }
            }
        }
        // A mixed-use app is observed only until this exact document is claimed.
        if !ToolWindowPolicy.retainsObservation(defaultChrome: watch.defaultChrome, documents: watch.documents) { removeWatch(watch.app.processIdentifier) }
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
            release(managed[i]); lastError = "previous-claim-release-pending"; return false
        }
        let origin = AgentDisplay.userDisplays().filter { $0.key != display.id && $0.value.contains(CGPoint(x: original.midX, y: original.midY)) }
        // New documents can inherit the previous Agent window's virtual location.
        // They are still exact file claims; never invent a physical restore target.
        let bornOnAgentDisplay = display.bounds.map { $0.contains(CGPoint(x: original.midX, y: original.midY)) } ?? false
        guard (!origin.isEmpty || bornOnAgentDisplay), display.currentBounds() != nil else { lastError = display.error ?? "original-display-unavailable"; return false }
        // The paired OCU provider captures the complete real frame, fits the
        // window to its inset area and owns full-frame restoration. Plus never
        // resizes a window before handing that original geometry to the provider.
        let record = Managed(pid: pid, element: window, windowID: id, launchDate: launchDate,
                             originalFrame: original, originalDisplays: origin, lastKnownFrame: original, result: "parking")
        managed.append(record)
        let epoch = observationEpoch
        ocu.call(arguments: ocuArguments(pid: pid, id: id, placement: "agent_display")) { [weak self] outcome in
            guard let self, let i = self.managed.firstIndex(where: { $0.claimID == record.claimID }) else { return }
            guard self.live(record), let actual = self.frame(window) else {
                if self.definitelyGone(record) { self.managed.remove(at: i); self.finishStopIfReady() }
                else { self.managed[i].result = "parking-identity-unavailable" }
                return
            }
            guard case .accepted = outcome, let current = self.display.currentBounds(),
                  ToolWindowPolicy.contained(actual, in: current) else {
                self.managed[i].result = "parking-unconfirmed"; self.lastError = "ocu-parking-unconfirmed"
                if case .accepted = outcome, let bounds = self.display.currentBounds(),
                   !ToolWindowPolicy.contained(actual, in: bounds), !ToolWindowPolicy.sameFrame(actual, original) {
                    self.release(self.managed[i]) // Verified completion followed by user takeover; never restore it.
                }
                return
            }
            self.managed[i].lastKnownFrame = actual
            self.managed[i].result = "parked"; self.lastError = nil
            if self.stopping || self.observationEpoch != epoch {
                _ = self.restore(pid: pid, id: id)
                return
            }
            if self.lastOpen["pid"] as? Int == Int(pid),
               (ToolWindowPolicy.canReportParked(requestID: self.currentOpenID, resource: self.currentOpenDocument,
                    latestRequestID: self.lastOpen["id"] as? String, actualDocument: self.document(window))
                || self.lastOpen["windowID"] as? UInt32 == id) {
                self.lastOpen["state"] = "parked"
            }
        }
        return true // Claimed, not yet reported parked; no duplicate observer call.
    }

    private func ocuArguments(pid: pid_t, id: UInt32, placement: String) -> [String: Any] {
        ["app": String(pid), "window_id": Int(id), "window_placement": placement,
         "allow_activation": false, "include_ax": false, "include_screenshot": true]
    }

    private func finishStopIfReady() {
        guard stopping, managed.isEmpty, agentSettingsRegistration == nil, ownAgentWindow == nil, startupRecovery.inFlight == nil,
              !terminationScheduled else { return }
        terminationScheduled = true
        // AppKit may run a nested event loop while awaiting terminateLater.
        // Leave the main dispatch callback first so the controller's main-queue
        // termination completion can run inside that loop.
        RunLoop.main.perform(inModes: [.common]) { [weak self] in
            guard let self else { return }
            self.terminationScheduled = false
            guard self.stopping, self.managed.isEmpty, self.agentSettingsRegistration == nil,
                  self.ownAgentWindow == nil, self.startupRecovery.inFlight == nil else { return }
            NSApp.terminate(nil)
        }
    }

    func setChromeUsesAgentDisplay(_ flag: Bool) {
        chromeUsesAgentDisplay = flag
        UserDefaults.standard.set(flag, forKey: ToolWindowPolicy.chromeEnabledKey)
        if flag { observeDefaultChrome() }
        else {
            for watch in Array(watches.values) where watch.defaultChrome {
                watch.defaultChrome = false
                if !ToolWindowPolicy.retainsObservation(defaultChrome: false, documents: watch.documents) { removeWatch(watch.app.processIdentifier) }
            }
        }
    }

    private func observeDefaultChrome() {
        guard enabled, !stopping, startupRecovery.isReady, chromeUsesAgentDisplay, !preparingChrome, AXIsProcessTrusted() else { return }
        let apps = NSWorkspace.shared.runningApplications.filter {
            ToolWindowPolicy.defaultsToAgentDisplay(bundleID: $0.bundleIdentifier ?? "", enabled: chromeUsesAgentDisplay)
                && watches[$0.processIdentifier]?.defaultChrome != true
        }
        guard !apps.isEmpty else { return }
        display.prepare { [weak self] bounds in
            guard let self, bounds != nil else { return }
            self.preparingChrome = true
            let epoch = self.observationEpoch
            self.ocu.call { [weak self] outcome in
                guard let self else { return }
                self.preparingChrome = false
                guard case .accepted = outcome, self.enabled, !self.stopping,
                      self.chromeUsesAgentDisplay, self.observationEpoch == epoch,
                      self.display.currentBounds() != nil else { return }
                for app in apps where !app.isTerminated {
                    guard let baseline = self.verifiedBaseline(app) else { continue }
                    _ = self.watch(app, baseline: baseline, documents: nil, defaultChrome: true)
                }
            }
        }
    }

    private func recoverStartupDisplayIfNeeded() {
        guard enabled, !stopping,
              let attempt = startupRecovery.begin(now: ProcessInfo.processInfo.systemUptime, configured: display.supported) else { return }
        let timeout = recoveryParameter("ocuDisplayRecoveryRequestTimeout", fallback: 20)
        ocu.ensurePersistentDisplay(timeout: timeout) { [weak self] outcome in
            guard let self else { return }
            var online = false
            self.display.prepare { online = $0 != nil }
            let ready: Bool
            switch outcome {
            case .ready(let id): ready = online && self.display.id == id
            case .unknown: ready = false // An online screen does not prove full-frame capability; retry idempotent ensure.
            case .unavailable, .unsupported: ready = false
            }
            let current = self.startupRecovery.complete(attempt, now: ProcessInfo.processInfo.systemUptime,
                ready: ready, error: outcome.diagnostic,
                retryInterval: self.recoveryParameter("ocuDisplayRecoveryRetryInterval", fallback: 2))
            if self.stopping { self.finishStopIfReady(); return }
            if current, self.enabled { self.observeDefaultChrome() }
        }
    }

    private func reconcileOwnership() {
        managed.removeAll { definitelyGone($0) }
        if stopping {
            if let window = ownAgentWindow, !window.isVisible, agentSettingsRegistration == nil {
                ownAgentWindow = nil; registeredAgentSettings = nil
            }
            finishStopIfReady()
            return
        }
        recoverStartupDisplayIfNeeded()
        observeDefaultChrome() // Retry only baseline readiness; unknown AX never becomes a claim.
        // AX readiness/minimize/fullscreen changes need not publish window-created.
        for watch in Array(watches.values) where watch.defaultChrome { scan(watch) }
        for record in managed where record.result == "parked" {
            if definitelyGone(record) { managed.removeAll { $0.claimID == record.claimID }; continue }
            guard live(record), let actual = frame(record.element), let last = record.lastKnownFrame else { continue }
            if !ToolWindowPolicy.sameFrame(actual, last) { release(record) }
        }
        if let window = ownAgentWindow, !window.isVisible, agentSettingsRegistration == nil {
            ownAgentWindow = nil; registeredAgentSettings = nil
        }
        if let window = ownAgentWindow, registeredAgentSettings == UInt32(window.windowNumber),
           agentSettingsRegistration == nil, !agentReleaseUnconfirmed, !ownAgentWindowIsParked(window) { forgetAgentSettings() }
    }

    private func forgetAgentSettings() {
        guard let window = ownAgentWindow, agentSettingsRegistration == nil, !agentReleaseUnconfirmed else { return }
        let id = UInt32(window.windowNumber)
        agentSettingsRegistration = id
        ocu.call(arguments: ocuArguments(pid: ProcessInfo.processInfo.processIdentifier, id: id, placement: "release")) { [weak self, weak window] outcome in
            guard let self else { return }
            self.agentSettingsRegistration = nil
            if case .accepted = outcome {
                self.registeredAgentSettings = nil; self.agentReleaseUnconfirmed = false
                if window === self.ownAgentWindow { self.ownAgentWindow = nil }
                self.finishStopIfReady()
            } else { self.agentReleaseUnconfirmed = true; self.lastError = "ocu-agent-settings-release-unconfirmed" }
        }
    }

    private func release(_ record: Managed) {
        guard let i = managed.firstIndex(where: { $0.claimID == record.claimID }),
              !["releasing", "release-unconfirmed", "restore-unconfirmed"].contains(managed[i].result) else { return }
        managed[i].result = "releasing"
        ocu.call(arguments: ocuArguments(pid: record.pid, id: record.windowID, placement: "release")) { [weak self] outcome in
            guard let self, let i = self.managed.firstIndex(where: { $0.claimID == record.claimID }) else { return }
            if case .accepted = outcome { self.managed.remove(at: i); self.finishStopIfReady() }
            else { self.managed[i].result = "release-unconfirmed" }
        }
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

    private func restore(pid: pid_t, id: UInt32, preservingBornHidden: Bool = false) -> Bool {
        if pid == ProcessInfo.processInfo.processIdentifier, ownAgentWindow?.windowNumber == Int(id) {
            if ownAgentWindow?.isVisible == false { ownAgentWindow = nil; registeredAgentSettings = nil; return agentSettingsRegistration == nil }
            if let window = ownAgentWindow, ownAgentWindowIsParked(window) {
                window.close(); ownAgentWindow = nil; registeredAgentSettings = nil; return agentSettingsRegistration == nil
            }
            forgetAgentSettings(); return false
        }
        guard let i = managed.firstIndex(where: { $0.pid == pid && $0.windowID == id }) else { return false }
        let record = managed[i]
        let protectedOperation = ["parking", "restoring", "releasing", "parking-unconfirmed", "release-unconfirmed", "restore-unconfirmed"].contains(record.result)
        guard let inventory = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
            if !protectedOperation { managed[i].result = "restore-window-query-unavailable" }
            return false
        }
        let info = inventory.first { ($0[kCGWindowNumber as String] as? UInt32) == id }
        if info == nil {
            managed.remove(at: i); return true
        }
        if let owner = info?[kCGWindowOwnerPID as String] as? Int32, owner != pid {
            managed.remove(at: i); return true
        }
        if let launch = NSRunningApplication(processIdentifier: pid)?.launchDate, launch != record.launchDate {
            managed.remove(at: i); return true
        }
        if protectedOperation { return false }
        guard live(record), let actual = frame(record.element), let last = record.lastKnownFrame else {
            managed[i].result = "restore-identity-unavailable"; return false
        }
        guard ToolWindowPolicy.sameFrame(actual, last) else {
            release(record); return false // User took over: forget the OCU record without moving.
        }
        if preservingBornHidden, record.originalDisplays.isEmpty,
           NSRunningApplication(processIdentifier: pid)?.bundleIdentifier == "com.google.Chrome" {
            release(record); return false // Keep born-hidden browser windows alive on OCU's persistent screen.
        }
        let physical = AgentDisplay.userDisplays()
        guard !physical.isEmpty else { managed[i].result = "restore-physical-display-unavailable"; return false }
        let originalTopologyUnchanged = record.originalDisplays.contains { physical[$0.key] == $0.value }
        managed[i].result = "restoring"
        lastRestore = ["pid": Int(pid), "windowID": id, "mode": originalTopologyUnchanged ? "exact-original-frame" : "physical-fallback-original-size", "state": "requested"]
        ocu.call(arguments: ocuArguments(pid: pid, id: id, placement: "restore")) { [weak self] outcome in
            guard let self, let i = self.managed.firstIndex(where: { $0.claimID == record.claimID }) else { return }
            if self.definitelyGone(record) { self.managed.remove(at: i); self.finishStopIfReady(); return }
            if case .accepted = outcome, self.live(record), let actual = self.frame(record.element),
               ToolWindowPolicy.restorationConfirmed(actual: actual, original: record.originalFrame,
                    requiresExactFrame: originalTopologyUnchanged,
                    physicalDisplays: AgentDisplay.userDisplays().map(\.value)) {
                self.managed.remove(at: i); self.lastRestore["state"] = "restored"; self.finishStopIfReady()
            } else { self.managed[i].result = "restore-unconfirmed"; self.lastRestore["state"] = "unconfirmed" }
        }
        return false // Asynchronous; status is authoritative, a quit retries after completion.
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
                let pending = managed.contains { $0.pid == identity.pid && $0.windowID == identity.windowID && ["restoring", "releasing"].contains($0.result) }
                    || (identity.pid == ProcessInfo.processInfo.processIdentifier && agentSettingsRegistration == identity.windowID)
                return ["ok": restored || pending, "state": restored ? "restored" : pending ? "requested" : "requires-recovery", "status": status()]
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
        if !flag {
            observationEpoch = UUID(); currentOpenDocument = nil; currentOpenID = nil
            if ["preparing-display", "requested", "waiting-for-window", "waiting-for-accessibility", "parking", "registering-agent-settings"].contains(lastOpen["state"] as? String ?? "") {
                lastOpen["state"] = "routing-cancelled"
            }
        }
        stopping = false
        enabled = flag
        startupRecovery.request(enabled: flag)
        UserDefaults.standard.set(flag, forKey: ToolWindowPolicy.enabledKey)
        if flag {
            if tokens.isEmpty { start() }
            recoverStartupDisplayIfNeeded()
            observeDefaultChrome()
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
        guard startupRecovery.isReady else {
            if lastOpen["id"] as? String == id { lastOpen["state"] = "failed"; lastOpen["error"] = "OCU display startup recovery is not ready" }
            return
        }
        display.prepare { [weak self] bounds in
            guard let self else { return }
            guard self.enabled, !self.stopping, self.observationEpoch == epoch else {
                if self.lastOpen["id"] as? String == id { self.lastOpen["state"] = "routing-cancelled" }
                return
            }
            guard bounds != nil else {
                if self.lastOpen["id"] as? String == id { self.lastOpen["state"] = "failed"; self.lastOpen["error"] = self.display.error ?? "display-unavailable" }
                return
            }
            self.ocu.call { [weak self] outcome in
                guard let self else { return }
                guard self.enabled, !self.stopping, self.observationEpoch == epoch else {
                    if self.lastOpen["id"] as? String == id { self.lastOpen["state"] = "routing-cancelled" }
                    return
                }
                guard case .accepted = outcome, self.display.currentBounds() != nil else {
                    self.lastError = "ocu-exact-window-lifecycle-unavailable"
                    if self.lastOpen["id"] as? String == id { self.lastOpen["state"] = "failed"; self.lastOpen["error"] = self.lastError }
                    return
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
        var target: [String: Any] = ["type": "agent-virtual-display", "owner": "OCU persistent-display", "supported": display.supported, "preparing": startupRecovery.inFlight != nil, "startupRecovery": startupRecovery.phase.rawValue]
        if !display.diagnostics.isEmpty { target["diagnostics"] = display.diagnostics }
        if let bounds = display.bounds {
            target["id"] = display.id; target["name"] = "Open Computer Use"; target["owner"] = "OCU persistent-display"
            target["frame"] = jsonFrame(bounds)
        }
        var windows = managed.map { record -> [String: Any] in
            var result: [String: Any] = ["pid": record.pid, "windowID": record.windowID, "result": record.result,
                "restoreMode": record.originalDisplays.isEmpty ? "physical-fallback-original-size" : "original-frame-or-physical-fallback"]
            if let f = frame(record.element) { result["frame"] = jsonFrame(f) }
            return result
        }
        if let ownAgentWindow, ownAgentWindow.isVisible {
            windows.append(["pid": ProcessInfo.processInfo.processIdentifier, "windowID": ownAgentWindow.windowNumber, "result": "agent-settings"])
        }
        return ["ok": true, "enabled": enabled, "chromeUsesAgentDisplay": chromeUsesAgentDisplay, "displaySummary": displaySummary, "accessibility": AXIsProcessTrusted(), "target": target,
                "lastOpen": lastOpen, "lastRestore": lastRestore, "watchedProcesses": watches.count, "windows": windows,
                "observationErrors": observationErrors.map { ["pid": Int($0.key), "code": $0.value] },
                "lastError": lastError ?? startupRecovery.lastError ?? display.error ?? ""]
    }

    private func ownAgentWindowIsParked(_ window: NSWindow) -> Bool {
        guard window.isVisible, let bounds = display.bounds else { return false }
        let height = CGDisplayBounds(CGMainDisplayID()).height
        let rect = CGRect(x: window.frame.minX, y: height - window.frame.maxY, width: window.frame.width, height: window.frame.height)
        return ToolWindowPolicy.contained(rect, in: bounds)
    }

    func prepareAgentWindow(_ window: NSWindow) -> Bool {
        guard enabled, !stopping, let bounds = display.currentBounds() else { return false }
        let primaryHeight = CGDisplayBounds(CGMainDisplayID()).height
        let current = CGRect(x: window.frame.minX, y: primaryHeight - window.frame.maxY, width: window.frame.width, height: window.frame.height)
        if window.isVisible && !ToolWindowPolicy.contained(current, in: bounds) {
            forgetAgentSettings(); lastError = "agent-settings-handed-to-user"; return false
        }
        let original = CGRect(x: 0, y: 0, width: window.frame.width, height: window.frame.height)
        let target = ToolWindowPolicy.destination(frame: original, area: bounds.insetBy(dx: 20, dy: 20))
        window.setFrame(NSRect(x: target.minX, y: primaryHeight - target.maxY, width: target.width, height: target.height), display: false)
        ownAgentWindow = window
        return true
    }

    func registerAgentWindow(_ window: NSWindow) {
        let id = UInt32(window.windowNumber), pid = ProcessInfo.processInfo.processIdentifier
        guard window === ownAgentWindow, ownAgentWindowIsParked(window), agentSettingsRegistration == nil else { return }
        agentSettingsRegistration = id; agentReleaseUnconfirmed = false
        let epoch = observationEpoch
        ocu.call(arguments: ocuArguments(pid: pid, id: id, placement: "agent_display")) { [weak self, weak window] outcome in
            guard let self else { return }
            self.agentSettingsRegistration = nil
            guard let window, window === self.ownAgentWindow, window.isVisible else { self.finishStopIfReady(); return }
            if self.stopping || self.observationEpoch != epoch { window.close(); self.ownAgentWindow = nil; self.finishStopIfReady(); return }
            if case .accepted = outcome, self.ownAgentWindowIsParked(window) {
                self.registeredAgentSettings = id; self.lastError = nil
                if self.lastOpen["windowID"] as? Int == Int(id) { self.lastOpen["state"] = "opened-agent-settings" }
            } else {
                if self.lastOpen["windowID"] as? Int == Int(id) {
                    let frame = window.frame
                    self.lastOpen["diagnostic"] = ["outcome": outcome.diagnostic,
                        "windowID": id, "nativeFrame": self.jsonFrame(frame),
                        "systemFrame": self.windowInfo(id)?[kCGWindowBounds as String] ?? NSNull()]
                }
                // If a user took over, release any OCU record without moving it.
                // Otherwise this is still our hidden Settings window; close it.
                if self.ownAgentWindowIsParked(window) { window.close(); self.ownAgentWindow = nil }
                else { self.registeredAgentSettings = id; self.forgetAgentSettings() }
                self.lastError = "ocu-agent-settings-registration-unconfirmed: " + outcome.diagnostic
                if self.lastOpen["windowID"] as? Int == Int(id) { self.lastOpen["state"] = "failed" }
            }
        }
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
