import AppKit
import ApplicationServices
import CodexPlusCore
import ServiceManagement
import SwiftUI

@main
final class CodexPlusApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private static var retainedDelegate: CodexPlusApp?
    private let observer = CodexWorkspaceObserver()
    private let statusServer = StatusServer()
    private var statusItem: NSStatusItem?
    private var settingsWindow: NSWindow?
    private let settings = SettingsModel()

    static func main() {
        if CommandLine.arguments.contains("--status") {
            do {
                FileHandle.standardOutput.write(try StatusChannel.readStatus())
            } catch {
                fputs("Codex Plus status unavailable: \(error.localizedDescription)\n", stderr)
                exit(1)
            }
            return
        }
        if CommandLine.arguments.contains("--help") {
            print("Codex Plus 0.2.0\nUsage: CodexPlus [--status | --help]\nLaunch the installed app for its menu and settings.")
            return
        }
        let currentPID = ProcessInfo.processInfo.processIdentifier
        if NSRunningApplication.runningApplications(withBundleIdentifier: CodexWorkspacePreference.domain)
            .contains(where: { $0.processIdentifier != currentPID && !$0.isTerminated }) { return }
        let app = NSApplication.shared
        let delegate = CodexPlusApp()
        retainedDelegate = delegate
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        ProcessInfo.processInfo.disableAutomaticTermination("Codex Plus observes Codex workspace events")
        settings.onEnabledChange = { [weak self] in
            self?.observer.stop()
            self?.observer.start()
        }
        settings.onDisplaySelectionChange = { [weak self] in self?.observer.displaySelectionDidChange() }
        settings.readDisplayDecision = { [weak self] in self?.observer.displayDecision() }
        observer.start()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.image = NSImage(systemSymbolName: "rectangle.split.2x1", accessibilityDescription: "Codex Plus")
        statusItem?.button?.toolTip = "Codex Plus"
        let menu = NSMenu()
        menu.delegate = self
        menu.addItem(NSMenuItem(title: "设置…", action: #selector(showSettings), keyEquivalent: ","))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出 Codex Plus", action: #selector(quit), keyEquivalent: "q"))
        statusItem?.menu = menu
        let mainMenu = NSMenu()
        let appMenu = NSMenu()
        let settingsItem = NSMenuItem(title: "设置…", action: #selector(showSettings), keyEquivalent: ",")
        settingsItem.target = self
        appMenu.addItem(settingsItem)
        appMenu.addItem(.separator())
        let quitItem = NSMenuItem(title: "退出 Codex Plus", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        appMenu.addItem(quitItem)
        let appMenuItem = NSMenuItem()
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)
        NSApp.mainMenu = mainMenu
        do {
            try statusServer.start { [weak self] in
                guard let self else { return ["ok": false] }
                return ["ok": true, "app": "Codex Plus", "version": "0.2.0",
                        "pid": ProcessInfo.processInfo.processIdentifier,
                        "launchAtLogin": SMAppService.mainApp.status == .enabled,
                        "workspace": self.observer.status()]
            }
        } catch {
            settings.error = "状态接口启动失败。\(error.localizedDescription)"
        }
        if !UserDefaults.standard.bool(forKey: "hasShownSettings") {
            showSettings()
            UserDefaults.standard.set(true, forKey: "hasShownSettings")
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showSettings()
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        observer.stop()
        statusServer.stop()
    }

    func menuWillOpen(_ menu: NSMenu) {
        settings.refresh()
    }

    @objc private func showSettings() {
        settings.refresh()
        if settingsWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 520),
                                  styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Codex Plus"
            window.isReleasedWhenClosed = false
            window.contentMinSize = NSSize(width: 500, height: 340)
            window.contentView = NSHostingView(rootView: SettingsView(model: settings, catalog: settings.catalog))
            window.center()
            settingsWindow = window
        }
        settingsWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func quit() { NSApp.terminate(nil) }
}

final class SettingsModel: ObservableObject {
    let catalog = CodexWorkspaceDisplayCatalog()
    @Published private(set) var selection = CodexWorkspaceDisplayPreference.load()
    @Published private(set) var displayDecision: CodexWorkspaceDisplayDecision?
    @Published var enabled = CodexWorkspacePreference.enabled {
        didSet {
            UserDefaults.standard.set(enabled, forKey: CodexWorkspacePreference.key)
            onEnabledChange?()
        }
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
        selection = CodexWorkspaceDisplayPreference.load()
        displayDecision = readDisplayDecision?()
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

struct SettingsView: View {
    @ObservedObject var model: SettingsModel
    @ObservedObject var catalog: CodexWorkspaceDisplayCatalog

    var body: some View {
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            Text("Codex Plus").font(.title2.bold())
            Text("新建 Codex 任务或切换任务时，自动展开已收起的右侧工作区。")
                .foregroundColor(.secondary)
            Toggle("自动展开 Codex 工作区", isOn: $model.enabled)
            displaySettings.disabled(!model.enabled)
            Text("ChatGPT 视图保持收起，已展开的任务保留现有标签页。")
                .font(.callout).foregroundColor(.secondary)
            Toggle("登录时启动", isOn: Binding(
                get: { model.launchAtLogin }, set: { model.setLaunchAtLogin($0) }
            ))
            HStack {
                Text(model.trusted ? "辅助功能权限已授权" : "需要辅助功能权限")
                Spacer()
                Button(model.trusted ? "查看权限" : "授权辅助功能…") { model.requestAccessibility() }
            }
            if let error = model.error { Text(error).foregroundColor(.red).font(.callout) }
          }
          .padding(26)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 500, minHeight: 340)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            model.refresh()
        }
        .onReceive(catalog.$displays) { _ in model.refreshDisplayDecision() }
    }

    private var displaySettings: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("适用屏幕", selection: Binding(
                get: { model.selection?.mode ?? .selected }, set: { model.setDisplayMode($0) }
            )) {
                Text("所有屏幕").tag(CodexWorkspaceDisplaySelection.Mode.all)
                Text("所选屏幕").tag(CodexWorkspaceDisplaySelection.Mode.selected)
            }
            .pickerStyle(.segmented)
            Text("选择后自动保存；在下一次新建或切换任务时应用。")
                .font(.callout).foregroundColor(.secondary)
            if model.selection == nil {
                Text("屏幕设置读取失败，请重新选择").foregroundColor(.red)
                Button("重设屏幕选择") { model.resetDisplaySelection() }
            }
            ForEach(catalog.displays) { display in
                Toggle(isOn: Binding(
                    get: { model.selection?.mode == .all || model.selection?.contains(display) == true },
                    set: { checked in
                        if let uuid = display.uuid { model.setDisplay(uuid: uuid, name: display.name, selected: checked) }
                    }
                )) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(displayTitle(display))
                        Text(display.identityUsable
                             ? "\(display.isBuiltin ? "内屏" : "外屏") · \(Int(display.bounds.width)) × \(Int(display.bounds.height)) pt"
                             : "屏幕身份暂不可用")
                            .font(.caption).foregroundColor(.secondary)
                    }
                }
                .disabled(model.selection?.mode == .all || !display.identityUsable)
            }
            ForEach(offlineSelections, id: \.uuid) { saved in
                Toggle(isOn: Binding(get: { true }, set: { checked in
                    model.setDisplay(uuid: saved.uuid, name: saved.lastKnownName, selected: checked)
                })) {
                    Text("\(saved.lastKnownName) · 已断开").foregroundColor(.secondary)
                }
                .disabled(model.selection?.mode == .all)
            }
            if model.selection?.mode == .selected && model.selection?.selectedDisplays.isEmpty == true {
                Text("当前未选择屏幕，自动展开已暂停").font(.callout).foregroundColor(.secondary)
            }
            Text(model.displaySummary).font(.callout).foregroundColor(.secondary)
        }
    }

    private var offlineSelections: [CodexWorkspaceDisplaySelection.SelectedDisplay] {
        (model.selection?.selectedDisplays ?? []).filter { saved in !catalog.displays.contains { $0.uuid == saved.uuid } }
    }

    private func displayTitle(_ display: CodexWorkspaceDisplay) -> String {
        guard catalog.displays.filter({ $0.name == display.name }).count > 1 else { return display.name }
        return "\(display.name) · (\(Int(display.bounds.minX)), \(Int(display.bounds.minY))) · \(display.uuid?.suffix(6) ?? "")"
    }
}
