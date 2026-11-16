import AppKit
import SwiftUI
import ServiceManagement
import CodexPlusCore

final class SettingsModel: ObservableObject {
    let catalog = CodexWorkspaceDisplayCatalog()
    @Published private(set) var selection = CodexWorkspaceDisplayPreference.load()
    @Published private(set) var displayDecision: CodexWorkspaceDisplayDecision?
    @Published var enabled = CodexWorkspacePreference.enabled {
        didSet {
            PlusPreferences.defaults.set(enabled, forKey: CodexWorkspacePreference.key)
            onEnabledChange?()
        }
    }
    @Published var autoSendSuggestions = !SuggestionAcceptance.isRequested && PlusPreferences.defaults.bool(forKey: "autoSendSuggestions") {
        didSet {
            if !SuggestionAcceptance.isRequested { PlusPreferences.defaults.set(autoSendSuggestions, forKey: "autoSendSuggestions") }
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
    @Published var launchAtLogin = false
    @Published var trusted = false
    @Published var error: String?
    var onEnabledChange: (() -> Void)?
    var onDisplaySelectionChange: (() -> Void)?
    var readDisplayDecision: (() -> CodexWorkspaceDisplayDecision?)?

    func refresh() {
        launchAtLogin = SMAppService.mainApp.status == .enabled
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

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            error = nil
        } catch {
            self.error = "登录启动设置失败。\(error.localizedDescription)"
        }
        refresh()
    }

    func requestAccessibility() {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
        refresh()
    }
}

