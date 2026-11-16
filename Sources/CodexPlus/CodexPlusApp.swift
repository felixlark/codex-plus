import AppKit
import ApplicationServices
import CodexPlusCore
import ServiceManagement
import Security
import Darwin
import SwiftUI

@main
final class CodexPlusApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private static var retainedDelegate: CodexPlusApp?
    private let observer = CodexWorkspaceObserver()
    private let statusServer = StatusServer()
    private let toolWindows = ToolWindowRouter()
    private let toolServer = ToolControlServer()
    private let management = ManagementRuntime()
    private var statusItem: NSStatusItem?
    private var runtimeLease: Int32 = -1
    private var serviceRequest: Process?
    private let settings = SettingsModel()
    private let launcher = CodexLauncher()

    static func main() {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if LifecycleCommand.run(arguments) { return }
        if arguments.first?.hasPrefix("--tool-") == true {
            do {
                let request = try ToolCommand.parse(arguments)!
                let data = try ToolControlChannel.request(request)
                FileHandle.standardOutput.write(data)
                if let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], result["ok"] as? Bool == false { exit(1) }
            } catch {
                fputs("SmartShadow tool command failed: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
            return
        }
        if CommandLine.arguments.contains("--status") {
            do {
                FileHandle.standardOutput.write(try StatusChannel.readStatus())
            } catch {
                fputs("SmartShadow status unavailable: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
            return
        }
        if CommandLine.arguments.contains("--help") {
            print("SmartShadow interactiond 4.2.0\nUsage: SmartShadowInteraction [--status | --help | --tool-status | --tool-open --app-path PATH [--url URL] | --tool-place --pid PID --window-id ID | --tool-routing --enabled true/false | --tool-restore --pid PID --window-id ID]\nF6 uses SmartShadowManager --open-codex. Settings are available in SmartShadow.")
            return
        }
        if arguments.isEmpty { RuntimeBootstrap.run(); return }
        guard arguments == ["--managed-runtime"] else {
            fputs("Unknown helper operation; use the SmartShadow management entry.\n", stderr); exit(2)
        }
        guard SuggestionAcceptance.isValidOrAbsent else {
            fputs("Invalid acceptance thread; refusing to start without a valid scope.\n", stderr)
            exit(2)
        }
        // The old installed process must reach its normal shutdown safety point
        // before the new identity can own sockets, controller or phone resources.
        guard Bundle.main.bundleIdentifier == SmartShadowInstallation.helperBundleID,
              Bundle.main.bundleURL.standardizedFileURL.path == SmartShadowInstallation.helperPath,
              !NSRunningApplication.runningApplications(withBundleIdentifier: SmartShadowInstallation.legacyBundleID)
                .contains(where: { !$0.isTerminated }) else {
            fputs("Installed helper identity unavailable or legacy runtime still active.\n", stderr); return
        }
        let app = NSApplication.shared
        let delegate = CodexPlusApp()
        let leasePath = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/codex-plus/interaction-runtime.lock")
        do { try FileManager.default.createDirectory(at: leasePath.deletingLastPathComponent(), withIntermediateDirectories: true) }
        catch { fputs("Runtime directory unavailable.\n", stderr); exit(2) }
        let fd = Darwin.open(leasePath.path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0, flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            if fd >= 0 { close(fd) }
            fputs("Interaction runtime already owned.\n", stderr); return
        }
        delegate.runtimeLease = fd
        retainedDelegate = delegate
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        ProcessInfo.processInfo.disableAutomaticTermination("SmartShadow interactiond observes Codex workspace events")
        settings.onEnabledChange = { [weak self] in
            guard self?.management.allowsEffects == true else { return }
            self?.observer.stop()
            self?.observer.start()
        }
        settings.onSuggestionChange = { [weak self] in
            guard let self, self.management.allowsEffects else { return }
            self.launcher.setAutoSendSuggestions(self.settings.autoSendSuggestions)
        }
        settings.onDisplaySelectionChange = { [weak self] in if self?.management.allowsEffects == true { self?.observer.displaySelectionDidChange() } }
        settings.readDisplayDecision = { [weak self] in self?.observer.displayDecision() }
        observer.start()
        toolWindows.openOwnSettings = { [weak self] in self?.openManager(agent: true) }
        settings.readToolRouting = { [weak self] in
            guard let self else { return (false, false, "等待连接") }
            return (self.toolWindows.enabled, self.toolWindows.chromeUsesAgentDisplay, self.toolWindows.displaySummary)
        }
        settings.onToolRoutingChange = { [weak self] in if self?.management.allowsEffects == true { self?.toolWindows.setEnabled($0) } }
        settings.onChromeRoutingChange = { [weak self] in if self?.management.allowsEffects == true { self?.toolWindows.setChromeUsesAgentDisplay($0) } }
        toolWindows.start()
        management.readSettings = { [weak self] in
            guard let self, let selection = CodexWorkspaceDisplayPreference.load() else { throw ManagementProtocol.failure("settings_unavailable") }
            return .init(workspaceAutoExpand: CodexWorkspacePreference.enabled,
                         autoSendSuggestions: self.settings.autoSendSuggestions,
                         workspaceAutoExpandDisplaySelection: selection,
                         agentToolWindowsEnabled: self.toolWindows.enabled, chromeUsesAgentDisplay: self.toolWindows.chromeUsesAgentDisplay)
        }
        management.writeSettings = { [weak self] value in self?.settings.applyManagement(value) }
        management.readComponents = { [weak self] in self?.launcher.runtimeComponents() ?? [:] }
        management.readStatus = { [weak self] in
            guard let self else { return [:] }
            let tools = self.toolWindows.command(["command": "tool-status"])
            return ["launcher": self.launcher.status(), "tool_windows": ["enabled": self.toolWindows.enabled,
                    "chromeUsesAgentDisplay": self.toolWindows.chromeUsesAgentDisplay,
                    "displaySummary": self.toolWindows.displaySummary, "lastError": tools["lastError"] ?? NSNull()]]
        }
        management.prepareStop = { [weak self] in
            guard let self else { throw ManagementProtocol.failure("unavailable") }
            self.observer.stop()
            let windowsReady = (try? self.toolWindows.prepareLifecycle()) != nil
            let scope = try await self.launcher.prepareLifecycle()
            guard windowsReady else { throw ManagementProtocol.failure("tool_window_pending") }
            return scope
        }
        management.resumeLifecycle = { [weak self] in
            guard let self else { throw ManagementProtocol.failure("unavailable") }
            try await self.launcher.resumeLifecycle()
            self.toolWindows.resumeLifecycle()
            self.observer.start()
        }
        management.performAction = { [weak self] operation in
            guard let self else { throw ManagementProtocol.failure("unavailable") }
            switch operation {
            case .openCodex: self.launcher.open(source: "management-request")
            case .reconnect:
                guard !self.settings.autoSendSuggestions else { throw ManagementProtocol.failure("disable_auto_send_before_reconnect") }
                try self.launcher.requestEnhancementReconnect()
            default: throw ManagementProtocol.failure("unsupported")
            }
        }
        management.stopLifecycle = { NSApp.terminate(nil) }
        management.verifyPreparedScope = { [weak self] in await self?.launcher.verifyLifecycleScope($0) == true }
        do { try toolServer.start { [weak self] request in
            guard let self else { return .init(["ok": false]) }
            if request["command"] as? String == ManagementProtocol.command { return await self.management.handle(request) }
            guard self.management.allowsEffects || request["command"] as? String == "tool-status" else { return .init(["ok":false,"error":"lifecycle_quiesced"]) }
            return .init(self.toolWindows.command(request))
        } }
        catch { settings.error = "工具窗口接口启动失败。\(error.localizedDescription)" }
        launcher.onOpenSettings = { [weak self] in self?.showSettings() }
        launcher.onPlaceMobileWindow = { [weak self] host, request in self?.toolWindows.routeMobileAnchor(host, request: request) }
        launcher.start()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let icon = NSImage(systemSymbolName: "square.stack.3d.up", accessibilityDescription: "SmartShadow")
        icon?.isTemplate = true
        statusItem?.button?.image = icon
        statusItem?.button?.setAccessibilityLabel("SmartShadow")
        statusItem?.button?.toolTip = "SmartShadow"
        let menu = NSMenu()
        menu.delegate = self
        for (title, action) in [("打开 SmartShadow…", #selector(showSettings)), ("打开双屏 Codex（F6）", #selector(openCodex))] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self; menu.addItem(item)
        }
        menu.addItem(.separator())
        let stop = NSMenuItem(title: "停止交互服务", action: #selector(stopInteraction), keyEquivalent: "")
        stop.target = self; menu.addItem(stop)
        statusItem?.menu = menu
        do {
            try statusServer.start { [weak self] in
                guard let self else { return ["ok": false] }
                return ["ok": true, "app": "SmartShadow interactiond", "version": "4.2.0",
                        "build": Bundle.main.infoDictionary?["CFBundleVersion"] ?? "unknown",
                        "pid": ProcessInfo.processInfo.processIdentifier,
                        "workspace": self.observer.status(), "launcher": self.launcher.status(),
                        "toolWindows": self.toolWindows.command(["command": "tool-status"])]
            }
        } catch {
            settings.error = "状态接口启动失败。\(error.localizedDescription)"
        }

    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        // LaunchServices/login attachment is not an F6 action. Only the explicit
        // management request or menu opens Codex.
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        observer.stop()
        guard toolWindows.stop() else {
            settings.error = "Agent 窗口正在归还或尚未安全恢复，请通过工具状态核对。"
            return .terminateCancel
        }
        return launcher.stop { NSApp.reply(toApplicationShouldTerminate: true) } ? .terminateLater : .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        observer.stop()
        statusServer.stop()
        toolServer.stop()
        toolWindows.stop()
    }

    func menuWillOpen(_ menu: NSMenu) {
        settings.refresh()
    }

    @objc private func showSettings() {
        openManager(agent: false)
    }
    private func openManager(agent: Bool) {
        let url = URL(fileURLWithPath: SmartShadowInstallation.containerPath)
        var code: SecStaticCode?, requirement: SecRequirement?
        let expression = "anchor apple generic and identifier \"me.longbiaochen.smart-shadow.app\" and certificate leaf[subject.OU] = \"HJG65XBC25\""
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess,
              SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
              let code, SecStaticCodeCheckValidity(code, [], requirement) == errSecSuccess else {
            settings.error = "已安装的 SmartShadow 管理 App 身份核验失败。"; return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        if agent { configuration.arguments = ["--agent-settings"] }
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { [weak self] _, error in
            if let error { DispatchQueue.main.async { self?.settings.error = "管理 App 打开失败：\(error.localizedDescription)" } }
        }
    }

    @objc private func stopInteraction() {
        guard serviceRequest == nil else { return }
        do {
            try SmartShadowInstallation.verifyBundle(path: SmartShadowInstallation.containerPath, bundleID: SmartShadowInstallation.containerBundleID)
            let child = Process()
            child.executableURL = URL(fileURLWithPath: SmartShadowInstallation.containerPath + "/Contents/MacOS/SmartShadowManager")
            child.arguments = ["--stop-interactiond"]
            child.standardInput = FileHandle.nullDevice; child.standardOutput = FileHandle.nullDevice; child.standardError = FileHandle.nullDevice
            child.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.serviceRequest = nil } }
            try child.run(); serviceRequest = child
        } catch { settings.error = "正式停止入口不可用，请打开 SmartShadow 查看状态。" }
    }
    @objc private func openCodex() { launcher.open() }
}

final class SettingsModel: ObservableObject {
    let catalog = CodexWorkspaceDisplayCatalog()
    @Published private(set) var selection = CodexWorkspaceDisplayPreference.load()
    @Published private(set) var displayDecision: CodexWorkspaceDisplayDecision?
    @Published var enabled = CodexWorkspacePreference.enabled {
        didSet {
            SmartShadowPreferences.defaults.set(enabled, forKey: CodexWorkspacePreference.key)
            onEnabledChange?()
        }
    }
    @Published var autoSendSuggestions = !SuggestionAcceptance.isRequested && SmartShadowPreferences.defaults.bool(forKey: "autoSendSuggestions") {
        didSet {
            if !SuggestionAcceptance.isRequested { SmartShadowPreferences.defaults.set(autoSendSuggestions, forKey: "autoSendSuggestions") }
            onSuggestionChange?()
        }
    }
    var onSuggestionChange: (() -> Void)?
    @Published private(set) var toolWindowsEnabled = true
    @Published private(set) var chromeUsesAgentDisplay = true
    @Published private(set) var agentDisplaySummary = "等待连接"
    var readToolRouting: (() -> (Bool, Bool, String))?
    var onToolRoutingChange: ((Bool) -> Void)?
    var onChromeRoutingChange: ((Bool) -> Void)?
    func setToolRouting(_ enabled: Bool) { onToolRoutingChange?(enabled); refreshToolRouting() }
    func setChromeRouting(_ enabled: Bool) { onChromeRoutingChange?(enabled); refreshToolRouting() }
    func refreshToolRouting() {
        guard let state = readToolRouting?() else { return }
        toolWindowsEnabled = state.0; chromeUsesAgentDisplay = state.1; agentDisplaySummary = state.2
    }
    @Published var trusted = false
    @Published var error: String?
    var onEnabledChange: (() -> Void)?
    var onDisplaySelectionChange: (() -> Void)?
    var readDisplayDecision: (() -> CodexWorkspaceDisplayDecision?)?

    func refresh() {
        trusted = AXIsProcessTrusted()
        catalog.refresh()
        refreshToolRouting()
        selection = CodexWorkspaceDisplayPreference.load()
        displayDecision = readDisplayDecision?()
    }

    func applyManagement(_ value: ManagementProtocol.Settings) {
        if !value.agentToolWindowsEnabled && toolWindowsEnabled { setToolRouting(false) }
        if enabled != value.workspaceAutoExpand { enabled = value.workspaceAutoExpand }
        if autoSendSuggestions != value.autoSendSuggestions { autoSendSuggestions = value.autoSendSuggestions }
        saveSelection(value.workspaceAutoExpandDisplaySelection)
        if chromeUsesAgentDisplay != value.chromeUsesAgentDisplay { setChromeRouting(value.chromeUsesAgentDisplay) }
        if value.agentToolWindowsEnabled && !toolWindowsEnabled { setToolRouting(true) }
        refresh()
    }

    func setDisplayMode(_ mode: CodexWorkspaceDisplaySelection.Mode) {
        var value = selection ?? CodexWorkspaceDisplaySelection()
        value.setMode(mode, displays: catalog.displays)
        saveSelection(value)
    }

    func setDisplay(uuid: String, name: String, selected: Bool) {
        var value = selection ?? CodexWorkspaceDisplaySelection()
        if selection == nil { value.setMode(.selected, displays: []) }
        value.setSelected(uuid: uuid, name: name, selected: selected, displays: catalog.displays)
        saveSelection(value)
    }

    func resetDisplaySelection() { saveSelection(CodexWorkspaceDisplaySelection()) }

    func refreshDisplayDecision() { displayDecision = readDisplayDecision?() }

    private func saveSelection(_ value: CodexWorkspaceDisplaySelection) {
        guard value != selection else { return }
        CodexWorkspaceDisplayPreference.save(value)
        selection = value
        onDisplaySelectionChange?()
        displayDecision = readDisplayDecision?()
    }

    var displaySummary: String {
        guard let displayDecision else { return "当前 Codex 窗口：等待连接" }
        let name = displayDecision.display?.name ?? "未知屏幕"
        let detail: String
        switch displayDecision.reason {
        case .allDisplays, .selectedDisplay: detail = "允许自动展开"
        case .unselectedDisplay: detail = "保持当前工作区状态"
        case .noSelection: detail = "当前未选择屏幕，自动展开已暂停"
        case .ambiguousDisplay: detail = "屏幕归属有歧义"
        case .unavailableIdentity: detail = "屏幕身份暂不可用"
        case .invalidPreference: detail = "屏幕设置读取失败，请重新选择"
        case .unavailableWindow: detail = "等待 Codex 窗口"
        case .unknownDisplay: detail = "等待识别屏幕"
        }
        return "当前 Codex 窗口：\(name) · \(detail)"
    }

}
