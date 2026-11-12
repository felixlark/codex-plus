import AppKit

/// The accessory app owns one external controller. It never terminates Codex.
final class CodexLauncher: ObservableObject {
    @Published private(set) var summary = "F6 打开 Codex"
    @Published private(set) var pageSummary = "等待从 F6 启动 Codex"
    @Published private(set) var suggestionSummary = "已关闭"
    @Published private(set) var orderSummary = "等待连接"
    var onOpenSettings: (() -> Void)?
    private var controllerOutput: Pipe?
    private var controllerInput: FileHandle?
    private var outputBuffer = Data()
    private var settingsRequests = 0
    private var controller: Process?
    private var timer: Timer?
    private var stopping = false
    private var recovering = false
    private var snapshot: [String: Any] = [:]
    private var stopped: (() -> Void)?
    private var entryRequests = 0
    private var lastEntrySource = "none"
    private var needsPlacement = false
    private var placementProcess: Process?
    private var placementStatus = "idle"
    private let appURL = URL(fileURLWithPath: "/Applications/ChatGPT.app")
    private let profile: String?
    private let stateURL: URL

    init() {
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "--acceptance-profile"), args.indices.contains(index + 1) {
            let value = args[index + 1]
            let expected = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/codex-plus/acceptance-20261110").path
            profile = value == expected ? value : nil
        } else { profile = nil }
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/codex-plus")
            .appendingPathComponent(profile == nil ? "launcher" : "installed-acceptance")
        stateURL = directory.appendingPathComponent("state.json")
    }

    func start() {
        refresh()
        if ownedHost() != nil { startController(attach: true) }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func open(source: String = "menu") {
        entryRequests += 1
        lastEntrySource = source
        needsPlacement = true
        refresh()
        if let host = ownedHost() {
            if controller == nil { recovering = false; startController(attach: true) }
            host.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            place(host)
            return
        }
        if profile == nil, let existing = NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex")
            .first(where: { !$0.isTerminated && $0.bundleURL == appURL }) {
            existing.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            place(existing)
            summary = "已打开 Codex；正常退出后再按 F6，项目自动排序将生效"
            return
        }
        guard controller == nil else { return }
        startController(attach: false)
    }

    @discardableResult func stop(completion: (() -> Void)? = nil) -> Bool {
        stopping = true
        stopped = completion
        timer?.invalidate(); timer = nil
        // TCP detachment releases Fetch requests without closing the host app.
        if controller?.isRunning == true { controller?.terminate(); return true }
        return false
    }

    func setAutoSendSuggestions(_ enabled: Bool) {
        let message: [String: Any] = ["type": "suggestion-settings", "version": 1, "enabled": enabled]
        if let data = try? JSONSerialization.data(withJSONObject: message) {
            try? controllerInput?.write(contentsOf: data + Data([10]))
        }
        refresh()
    }

    func status() -> [String: Any] {
        ["hotKey": "F6", "hotKeySource": "Karabiner", "dockItem": false,
         "phase": snapshot["phase"] ?? "idle", "hostPID": snapshot["pid"] ?? NSNull(),
         "entryRequests": entryRequests, "lastEntrySource": lastEntrySource, "placement": placementStatus,
         "controllerPID": controller?.processIdentifier ?? 0, "adaptedScripts": snapshot["adapted"] ?? 0,
         "summary": summary, "acceptanceProfile": profile != nil,
         "pageEntries": snapshot["pageEntries"] ?? ["phase": "unavailable"],
         "projectOrder": snapshot["projectOrder"] ?? ["phase": "unavailable"],
         "settingsRequests": settingsRequests,
         "suggestionAutoSend": snapshot["suggestionAutoSend"] ?? ["enabled": false, "phase": "unavailable"]]
    }

    private func ownedHost() -> NSRunningApplication? {
        guard let number = snapshot["pid"] as? NSNumber,
              let app = NSRunningApplication(processIdentifier: number.int32Value), !app.isTerminated,
              app.bundleIdentifier == "com.openai.codex", app.bundleURL == appURL,
              snapshot["endpoint"] is String else { return nil }
        return app
    }

    private func refresh() {
        if let data = try? Data(contentsOf: stateURL), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            snapshot = value
        }
        let entries = snapshot["pageEntries"] as? [String: Any]
        let order = snapshot["projectOrder"] as? [String: Any]
        let connected = controller?.isRunning == true
        let suggestion = snapshot["suggestionAutoSend"] as? [String: Any]
        if !UserDefaults.standard.bool(forKey: "autoSendSuggestions") { suggestionSummary = "已关闭" }
        else if !connected { suggestionSummary = "等待连接" }
        else if suggestion?["storageReady"] as? Bool == false { suggestionSummary = "记录暂不可用，已暂停" }
        else if suggestion?["supported"] as? Bool == false { suggestionSummary = "当前 Codex 版本待适配" }
        else if suggestion?["enabled"] as? Bool == false { suggestionSummary = "自动发送已暂停，请重新启用" }
        else if suggestion?["pageReady"] as? Bool != true { suggestionSummary = "当前页面需重载后接入" }
        else { suggestionSummary = "已开启 · 当前聊天的新建议将自动发送" }
        pageSummary = connected && entries?["phase"] as? String == "active"
            ? "已接入 · 左下角 Plus 设置与上方贪吃蛇"
            : (entries?["supported"] as? Bool == false ? "当前 Codex 版本待适配；菜单栏设置可用" : "等待页面连接；普通启动后需正常退出，再按 F6")
        orderSummary = connected && order?["phase"] as? String == "active" ? "已启用 · 按任务活动排序" : "尚未接入"
        if controller?.isRunning == true {
            switch snapshot["phase"] as? String {
            case "active":
                summary = "F6 打开 Codex · Codex Plus 页面增强已连接"; recovering = false
                if needsPlacement, let host = ownedHost() { place(host) }
            case "failed", "disconnected": summary = "连接正在恢复；Codex 中的任务继续运行"
            default: summary = "正在连接 Codex…"
            }
        } else if ownedHost() != nil {
            summary = "Codex 正在运行；正在恢复自动排序连接"
        } else if profile == nil && !NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex").isEmpty {
            summary = "F6 打开 Codex；正常退出后从 F6 启动可启用自动排序"
        } else if snapshot["phase"] as? String == "failed" {
            summary = "自动排序暂不可用：\(snapshot["error"] as? String ?? "连接失败")"
        } else { summary = "F6 打开 Codex · Codex Plus 在菜单栏运行" }
    }

    private func place(_ host: NSRunningApplication) {
        guard needsPlacement, placementProcess == nil else { return }
        needsPlacement = false
        let node = "/opt/homebrew/bin/node"
        let cli = "/Applications/dock-switch.app/Contents/Resources/app/bin/dock-switch-cli.js"
        guard FileManager.default.isExecutableFile(atPath: node), FileManager.default.fileExists(atPath: cli) else {
            placementStatus = "unavailable"; return
        }
        // Target the already-open host, so placement cannot launch a second Codex.
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [cli, "place", "--pid", String(host.processIdentifier), "--placement", "side_right_fill"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] exited in DispatchQueue.main.async {
            guard let self, self.placementProcess === exited else { return }
            self.placementStatus = exited.terminationStatus == 0 ? "placed" : "failed"
            self.placementProcess = nil
        }}
        do { try process.run(); placementProcess = process; placementStatus = "placing" }
        catch { placementStatus = "failed" }
    }

    private func startController(attach: Bool) {
        guard controller == nil, !stopping else { return }
        let resources = Bundle.main.resourceURL!
        let process = Process()
        process.executableURL = appURL.appendingPathComponent("Contents/Resources/cua_node/bin/node")
        var arguments = [resources.appendingPathComponent("controller.mjs").path, "--app", appURL.path, "--state", stateURL.path]
        if let profile { arguments += ["--profile", profile] }
        if attach { arguments.append("--attach") }
        if UserDefaults.standard.bool(forKey: "autoSendSuggestions") { arguments.append("--auto-send-suggestions") }
        process.arguments = arguments
        let output = Pipe(), input = Pipe()
        process.standardOutput = output
        process.standardInput = input
        controllerOutput = output
        controllerInput = input.fileHandleForWriting
        outputBuffer.removeAll()
        output.fileHandleForReading.readabilityHandler = { [weak self, weak process] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async { [weak self, weak process] in
                guard let self, let process, self.controller === process else { return }
                self.receive(data)
            }
        }
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] exited in DispatchQueue.main.async {
            guard let self, self.controller === exited else { return }
            self.controllerOutput?.fileHandleForReading.readabilityHandler = nil
            self.controllerOutput = nil
            self.controllerInput = nil
            self.outputBuffer.removeAll()
            self.controller = nil; self.refresh()
            if self.stopping { self.stopped?(); self.stopped = nil; return }
            guard !self.stopping else { return }
            if self.ownedHost() != nil && !self.recovering {
                self.recovering = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                    guard let self else { return }
                    self.startController(attach: true)
                }
            } else if !attach, (self.snapshot["error"] as? String)?.hasPrefix("Unsupported") == true {
                self.openNormally()
            }
        }}
        do { try process.run(); controller = process; if !attach { recovering = false }; summary = "正在启动 Codex…" }
        catch { summary = "Codex 启动失败：\(error.localizedDescription)" }
    }

    private func receive(_ data: Data) {
        outputBuffer.append(data)
        while let newline = outputBuffer.firstIndex(of: 10) {
            let line = outputBuffer.prefix(upTo: newline)
            outputBuffer.removeSubrange(...newline)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  value["type"] as? String == "ui-action", value["version"] as? Int == 1,
                  value["action"] as? String == "open-settings",
                  let requestID = value["requestId"] as? String, UUID(uuidString: requestID) != nil else { continue }
            guard !stopping else { continue }
            settingsRequests += 1
            onOpenSettings?()
            if let reply = try? JSONSerialization.data(withJSONObject: ["type": "ui-result", "requestId": requestID, "ok": onOpenSettings != nil]) {
                try? controllerInput?.write(contentsOf: reply + Data([10]))
            }
        }
    }

    private func openNormally() {
        let config = NSWorkspace.OpenConfiguration()
        if let profile {
            config.createsNewApplicationInstance = true
            config.arguments = ["--user-data-dir=\(profile)/user-data"]
            config.environment = ["CODEX_HOME": "\(profile)/codex-home", "CODEX_ELECTRON_USER_DATA_PATH": "\(profile)/user-data"]
        }
        NSWorkspace.shared.openApplication(at: appURL, configuration: config) { [weak self] app, _ in
            DispatchQueue.main.async {
                self?.summary = "已打开官方 Codex；当前版本的自动排序尚未适配"
                if let app { self?.place(app) }
            }
        }
    }
}
