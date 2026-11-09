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
            print("Codex Plus 0.1.0\nUsage: CodexPlus [--status | --help]\nLaunch the installed app for its menu and settings.")
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
        do {
            try statusServer.start { [weak self] in
                guard let self else { return ["ok": false] }
                return ["ok": true, "app": "Codex Plus", "version": "0.1.0",
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
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 310),
                                  styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = "Codex Plus"
            window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: SettingsView(model: settings))
            window.center()
            settingsWindow = window
        }
        settingsWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func quit() { NSApp.terminate(nil) }
}

final class SettingsModel: ObservableObject {
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

    func refresh() {
        launchAtLogin = SMAppService.mainApp.status == .enabled
        trusted = AXIsProcessTrusted()
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

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Codex Plus").font(.title2.bold())
            Text("新建 Codex 任务或切换任务时，自动展开已收起的右侧工作区。")
                .foregroundColor(.secondary)
            Toggle("自动展开 Codex 工作区", isOn: $model.enabled)
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
        .frame(width: 460, alignment: .leading)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            model.refresh()
        }
    }
}
