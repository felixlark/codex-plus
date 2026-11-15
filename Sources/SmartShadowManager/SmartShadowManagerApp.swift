import SwiftUI
import AppKit
import ServiceManagement
import CodexPlusCore

@MainActor final class ManagerDelegate: NSObject, NSApplicationDelegate {
    weak var model: ManagerModel?
    func applicationWillTerminate(_ notification: Notification) { model?.cancel() }
}

@main struct SmartShadowManagerApp: App {
    @NSApplicationDelegateAdaptor(ManagerDelegate.self) private var delegate
    @StateObject private var model = ManagerModel()
    var body: some Scene {
        WindowGroup("SmartShadow") {
            ManagerView(model: model)
                .onAppear { delegate.model = model }
        }
        .commands {
            CommandGroup(replacing: .appInfo) { Button("关于 SmartShadow") { NSApp.orderFrontStandardAboutPanel() } }
        }
    }
}

struct ManagerView: View {
    @ObservedObject var model: ManagerModel
    @StateObject private var catalog = CodexWorkspaceDisplayCatalog()
    @State private var login = SMAppService.mainApp.status == .enabled
    @State private var loginError: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("SmartShadow").font(.title2.bold())
                        Text("配置、组件状态与权限").foregroundColor(.secondary)
                    }
                    Spacer()
                    Button("启动或附着 interactiond") { model.attach() }.disabled(model.busy)
                    Button("刷新") { catalog.refresh(); model.refresh() }.disabled(model.busy)
                }
                Text(model.message).font(.callout).textSelection(.enabled)
                GroupBox("interactiond") {
                    VStack(alignment: .leading, spacing: 8) {
                        if let runtime = model.runtime {
                            Text("\(runtime.version) · build \(runtime.build) · PID \(runtime.pid)")
                            Text(runtime.path).font(.caption).foregroundColor(.secondary).textSelection(.enabled)
                            Text("controller：\(runtime.controller_version ?? "未知") · 移动接口：\(runtime.mobile_version ?? "未知")")
                                .font(.caption).foregroundColor(.secondary)
                        } else { Text("尚未核验运行主体").foregroundColor(.secondary) }
                        Text("小型任务看板尚未实现").foregroundColor(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
                }
                GroupBox("contextd · taskd") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(["contextd", "taskd"], id: \.self) { role in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(role).font(.headline)
                                if let observation = model.modules[role] {
                                    Text("进程：\(observation.job) · 配置：\(observation.configuration)")
                                    Text("\(observation.selection) · 运行报告：\(observation.report)")
                                    if let source = observation.source { Text("源码版本：\(source.prefix(12))").font(.caption) }
                                }
                                if let error = model.moduleErrors[role] { Text(error).foregroundColor(.secondary) }
                                else if model.modules[role] == nil { Text("尚未读取").foregroundColor(.secondary) }
                            }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
                }
                if let settings = model.settings {
                    GroupBox("页面增强") {
                        VStack(alignment: .leading, spacing: 10) {
                            setting("自动发送建议提示词", key: "autoSendSuggestions", value: settings.autoSendSuggestions)
                            setting("自动展开 Codex 工作区", key: "workspaceAutoExpand", value: settings.workspaceAutoExpand)
                            displaySettings(settings.workspaceAutoExpandDisplaySelection).disabled(!settings.workspaceAutoExpand)
                        }.padding(6)
                    }
                    GroupBox("Agent 窗口右屏路由") {
                        VStack(alignment: .leading, spacing: 10) {
                            setting("Agent 工具窗口使用右屏", key: "agentToolWindowsEnabled", value: settings.agentToolWindowsEnabled)
                            setting("Agent Chrome 窗口使用右屏", key: "chromeUsesAgentDisplay", value: settings.chromeUsesAgentDisplay)
                                .disabled(!settings.agentToolWindowsEnabled)
                            Text("窗口由 interactiond 持续托管；管理 App 退出后继续运行。")
                                .font(.caption).foregroundColor(.secondary)
                        }.padding(6)
                    }
                }
                GroupBox("权限与启动") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("interactiond 辅助功能权限：\(accessibilityStatus)")
                        Text(ManagementProtocol.runtimePath).font(.caption).foregroundColor(.secondary)
                        Button("查看 interactiond 系统权限") {
                            NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
                        }
                        Toggle("登录时启动管理 App", isOn: Binding(get: { login }, set: setLogin))
                        if let loginError { Text(loginError).foregroundColor(.red) }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(6)
                }
            }.padding(24)
        }
        .frame(minWidth: 580, idealWidth: 680, minHeight: 520, idealHeight: 740)
        .onAppear { model.start() }
    }
    private var accessibilityStatus: String {
        guard let permissions = model.status["permissions"] as? [String: Any],
              let ax = permissions["accessibility"] as? [String: Any],
              ax["bundle_id"] as? String == ManagementProtocol.runtimeBundleID,
              ax["path"] as? String == ManagementProtocol.runtimePath,
              let pid = ManagementProtocol.integer(ax["pid"]), let current = model.runtime, pid == Int(current.pid),
              let trusted = ManagementProtocol.boolean(ax["trusted"]) else { return "未知" }
        return trusted ? "已授权" : "未授权"
    }
    private func setting(_ title: String, key: String, value: Bool) -> some View {
        Toggle(title, isOn: Binding(get: { value }, set: { model.write([key: $0]) }))
            .disabled(model.busy || !model.capabilities.contains("settings.write"))
    }
    private func displaySettings(_ selection: CodexWorkspaceDisplaySelection) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("适用屏幕", selection: Binding(get: { selection.mode }, set: { mode in
                var value = selection; value.setMode(mode, displays: catalog.displays); writeSelection(value)
            })) {
                Text("所有屏幕").tag(CodexWorkspaceDisplaySelection.Mode.all)
                Text("所选屏幕").tag(CodexWorkspaceDisplaySelection.Mode.selected)
            }.pickerStyle(.segmented)
            ForEach(catalog.displays) { display in
                Toggle(display.name, isOn: Binding(get: { selection.mode == .all || selection.contains(display) }, set: { checked in
                    guard let uuid = display.uuid else { return }
                    var value = selection; value.setSelected(uuid: uuid, name: display.name, selected: checked, displays: catalog.displays)
                    writeSelection(value)
                })).disabled(selection.mode == .all || !display.identityUsable)
            }
            ForEach(selection.selectedDisplays.filter { saved in !catalog.displays.contains { $0.uuid == saved.uuid } }, id: \.uuid) { saved in
                Toggle("\(saved.lastKnownName)（离线）", isOn: Binding(get: { true }, set: { checked in
                    var value = selection; value.setSelected(uuid: saved.uuid, name: saved.lastKnownName, selected: checked, displays: catalog.displays)
                    writeSelection(value)
                }))
            }
        }.disabled(model.busy || !model.capabilities.contains("settings.write"))
    }
    private func writeSelection(_ value: CodexWorkspaceDisplaySelection) {
        guard let raw = try? JSONEncoder().encode(value), let object = try? JSONSerialization.jsonObject(with: raw) else { return }
        model.write(["workspaceAutoExpandDisplaySelection": object])
    }
    private func setLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
            loginError = nil
        } catch { loginError = error.localizedDescription }
        login = SMAppService.mainApp.status == .enabled
    }
}
