import AppKit
import CodexPlusCore

/// The accessory app owns one external controller. It never terminates Codex.
final class CodexLauncher: ObservableObject {
    @Published private(set) var summary = "F6 打开 Codex"
    @Published private(set) var pageSummary = "等待从 F6 启动 Codex"
    @Published private(set) var suggestionSummary = "已关闭"
    @Published private(set) var reconnectResult: String?
    @Published private(set) var sidebarSummary = "等待页面接入"
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
    private var autoSendEnabled = !SuggestionAcceptance.isRequested && UserDefaults.standard.bool(forKey: "autoSendSuggestions")
    private var needsPlacement = false
    private var placementProcess: Process?
    private var placementStatus = "idle"
    private var placementRule: String?
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
        autoSendEnabled = enabled
        let message: [String: Any] = ["type": "suggestion-settings", "version": 1, "enabled": enabled]
        if let data = try? JSONSerialization.data(withJSONObject: message) {
            try? controllerInput?.write(contentsOf: data + Data([10]))
        }
        refresh()
    }

    func reconnectEnhancements() {
        guard !autoSendEnabled, let input = controllerInput else { return }
        let message: [String: Any] = ["type": "reconnect-enhancements", "version": 1]
        guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
        do {
            try input.write(contentsOf: data + Data([10]))
            reconnectResult = "正在检查未提交内容并重新接入…"
        } catch { reconnectResult = "连接暂不可用，页面未重新接入。" }
    }

    func status() -> [String: Any] {
        ["hotKey": "F6", "hotKeySource": "Karabiner", "dockItem": false,
         "phase": snapshot["phase"] ?? "idle", "hostPID": snapshot["pid"] ?? NSNull(),
         "entryRequests": entryRequests, "lastEntrySource": lastEntrySource, "placement": placementStatus,
         "placementSource": "dock-switch", "placementRule": placementRule as Any? ?? NSNull(),
         "controllerPID": controller?.processIdentifier ?? 0, "adaptedScripts": snapshot["adapted"] ?? 0,
         "summary": summary, "acceptanceProfile": profile != nil,
         "pageEntries": snapshot["pageEntries"] ?? ["phase": "unavailable"],
         "projectOrder": snapshot["projectOrder"] ?? ["phase": "unavailable"],
         "sidebarLayout": snapshot["sidebarLayout"] ?? ["phase": "unavailable"],
         "settingsRequests": settingsRequests,
         "suggestionAcceptanceScoped": SuggestionAcceptance.threadID != nil,
         "suggestionAutoSend": snapshot["suggestionAutoSend"] ?? ["enabled": false, "phase": "unavailable"]]
    }

    private func ownedHost() -> NSRunningApplication? {
        guard let number = snapshot["pid"] as? NSNumber,
              let app = NSRunningApplication(processIdentifier: number.int32Value), !app.isTerminated,
              app.bundleIdentifier == "com.openai.codex", app.bundleURL == appURL,
              snapshot["endpoint"] is String else { return nil }
        return app
    }

    private func publishDisplays() {
        guard let input = controllerInput else { return }
        let displays: [[String: Any]] = CodexWorkspaceDisplayCatalog.capture().map { display in
            ["uuid": display.identityUsable ? (display.uuid as Any? ?? NSNull()) : NSNull(),
             "name": display.name, "x": display.bounds.minX, "y": display.bounds.minY,
             "width": display.bounds.width, "height": display.bounds.height]
        }
        if let data = try? JSONSerialization.data(withJSONObject: ["type": "sidebar-displays", "version": 1, "displays": displays]) {
            try? input.write(contentsOf: data + Data([10]))
        }
    }

    private func refresh() {
        publishDisplays()
        if let data = try? Data(contentsOf: stateURL), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            snapshot = value
        }
        let entries = snapshot["pageEntries"] as? [String: Any]
        let order = snapshot["projectOrder"] as? [String: Any]
        let connected = controller?.isRunning == true
        let sidebar = snapshot["sidebarLayout"] as? [String: Any]
        if !connected { sidebarSummary = "等待连接" }
        else if sidebar?["supported"] as? Bool == false { sidebarSummary = "当前 Codex 版本待适配" }
        else if sidebar?["storageReady"] as? Bool == false { sidebarSummary = "窗口独立已启用；屏幕记忆暂不可写" }
        else if sidebar?["phase"] as? String == "active" { sidebarSummary = "已启用 · 每窗口独立，按屏幕记忆" }
        else { sidebarSummary = "等待页面或屏幕接入" }
        let suggestion = snapshot["suggestionAutoSend"] as? [String: Any]
        if !autoSendEnabled { suggestionSummary = "已关闭" }
        else if !connected { suggestionSummary = "等待连接" }
        else if suggestion?["storageReady"] as? Bool == false { suggestionSummary = "记录暂不可用，已暂停" }
        else if suggestion?["supported"] as? Bool == false { suggestionSummary = "当前 Codex 版本待适配" }
        else if suggestion?["enabled"] as? Bool == false { suggestionSummary = "自动发送已暂停，请重新启用" }
        else if suggestion?["pageReady"] as? Bool != true { suggestionSummary = "当前页面需重载后接入" }
        else if let review = suggestion?["review"] as? [String: Any], let count = review["pending"] as? Int, count > 0 {
            suggestionSummary = "已开启 · 部分建议未自动发送"
        }
        else if let review = suggestion?["review"] as? [String: Any], let count = review["reviewing"] as? Int, count > 0 {
            suggestionSummary = "已开启 · 正在审查后台建议"
        }
        else { suggestionSummary = "已开启 · 普通建议后台发送，敏感事项先审查" }
        pageSummary = connected && entries?["phase"] as? String == "active"
            ? "已接入 · 左下角 Plus 设置与上方贪吃蛇"
            : (entries?["supported"] as? Bool == false ? "当前 Codex 版本待适配；菜单栏设置可用" : "等待页面连接；普通启动后需正常退出，再按 F6")
        orderSummary = connected && order?["phase"] as? String == "active" ? "已启用 · 需处理、进行中与未读优先" : "尚未接入"
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
        placementRule = DockSwitchPlacement.load(appName: appURL.deletingPathExtension().lastPathComponent)
        guard let placementRule else { placementStatus = "configuration-unavailable"; return }
        let node = "/opt/homebrew/bin/node"
        let cli = "/Applications/dock-switch.app/Contents/Resources/app/bin/dock-switch-cli.js"
        guard FileManager.default.isExecutableFile(atPath: node), FileManager.default.fileExists(atPath: cli) else {
            placementStatus = "unavailable"; return
        }
        // Target the already-open host, so placement cannot launch a second Codex.
        let process = Process()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [cli, "place", "--pid", String(host.processIdentifier), "--placement", placementRule]
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
        guard SuggestionAcceptance.isValidOrAbsent else { summary = "验收任务标识无效，自动发送保持关闭"; return }
        guard controller == nil, !stopping else { return }
        let resources = Bundle.main.resourceURL!
        let process = Process()
        process.executableURL = appURL.appendingPathComponent("Contents/Resources/cua_node/bin/node")
        var arguments = [resources.appendingPathComponent("controller.mjs").path, "--app", appURL.path, "--state", stateURL.path]
        if let profile { arguments += ["--profile", profile] }
        if attach { arguments.append("--attach") }
        if autoSendEnabled { arguments.append("--auto-send-suggestions") }
        if let threadID = SuggestionAcceptance.threadID { arguments += ["--suggestion-acceptance-thread", threadID] }
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
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            if value["type"] as? String == "enhancement-reconnect-result" {
                if value["ok"] as? Bool == true { reconnectResult = "页面增强已重新接入。" }
                else if let count = value["reloaded"] as? Int, count > 0 { reconnectResult = "部分页面已重连，其余尚未接入；自动发送保持关闭。" }
                else if value["reason"] as? String == "unsubmitted-content" { reconnectResult = "页面有未提交内容或对话框，未重新接入。" }
                else { reconnectResult = "页面状态已变化或连接不可用，未完成重新接入。" }
                continue
            }
            guard value["type"] as? String == "ui-action", value["version"] as? Int == 1,
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
