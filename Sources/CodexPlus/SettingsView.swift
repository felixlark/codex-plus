import AppKit
import SwiftUI
import CodexPlusCore

struct SettingsView: View {
    @ObservedObject var model: SettingsModel
    @ObservedObject var catalog: CodexWorkspaceDisplayCatalog
    @ObservedObject var launcher: CodexLauncher

    var body: some View {
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            Text("Codex Plus").font(.title2.bold())
            Text("按 F6 打开双屏 Codex，项目随任务活动自动置顶。Codex Plus 在菜单栏运行。")
            Text(launcher.summary).font(.callout).foregroundColor(.secondary)
            Button("打开双屏 Codex（F6）") { launcher.open() }
            Divider()
            Text("页面增强").font(.headline)
            Text(launcher.pageSummary).font(.callout).foregroundColor(.secondary)
            Text("项目排序：\(launcher.orderSummary)").font(.callout).foregroundColor(.secondary)
            Text("侧栏布局：\(launcher.sidebarSummary)").font(.callout).foregroundColor(.secondary)
            Text("展开与折叠只影响当前窗口。移动到其他屏幕或新开窗口时，恢复该屏幕上次的布局；同屏已有窗口保持各自状态。布局仅保存在本机。")
                .font(.caption).foregroundColor(.secondary)
            Button("重新接入页面增强") { launcher.reconnectEnhancements() }
                .disabled(model.autoSendSuggestions)
            Text("更新后可在此重新接入；先关闭自动发送。有未提交输入、附件或对话框时不执行。")
                .font(.caption).foregroundColor(.secondary)
            if let result = launcher.reconnectResult { Text(result).font(.callout).foregroundColor(.secondary) }
            Toggle("自动发送建议提示词", isOn: $model.autoSendSuggestions)
            Text("无需打开任务。普通建议经审查后在后台发送；敏感或无法确认范围的建议不自动发送。关闭后停止尚未提交的动作。")
                .font(.callout).foregroundColor(.secondary)
            Text("建议提示词：\(launcher.suggestionSummary)").font(.callout).foregroundColor(.secondary)
            if SuggestionAcceptance.threadID != nil {
                Text("验收模式：仅处理指定测试任务；自动发送开关不保存到日常偏好。")
                    .font(.caption).foregroundColor(.secondary)
            }
            Divider()
            Text("新建 Codex 任务或切换任务时，自动展开已收起的右侧工作区。")
                .foregroundColor(.secondary)
            Toggle("自动展开 Codex 工作区", isOn: $model.enabled)
            displaySettings.disabled(!model.enabled)
            Text("ChatGPT 视图保持收起，已展开的任务保留现有标签页。")
                .font(.callout).foregroundColor(.secondary)
            Divider()
            Text("Agent 窗口右屏路由").font(.headline)
            Text(model.agentDisplaySummary).font(.callout).foregroundColor(.secondary)
            Text("Agent 工具窗口使用当前最右侧物理屏；不创建虚拟屏。")
                .font(.caption).foregroundColor(.secondary)
            Toggle("Agent 工具窗口使用右屏", isOn: Binding(
                get: { model.toolWindowsEnabled }, set: { model.setToolRouting($0) }
            ))
            Toggle("Agent Chrome 窗口使用右屏", isOn: Binding(
                get: { model.chromeUsesAgentDisplay }, set: { model.setChromeRouting($0) }
            ))
            .disabled(!model.toolWindowsEnabled)
            Text("只路由明确登记的 Agent 窗口；人工窗口保留。超大窗口适配右屏，手动移动后解除托管，停止路由不搬回原屏。")
                .font(.caption).foregroundColor(.secondary)
            Button("刷新物理屏状态") { model.refresh() }
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
        .onReceive(catalog.$displays) { _ in model.refreshDisplayDecision(); model.refreshToolRouting() }
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
