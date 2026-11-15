import AppKit
import Combine
import CodexPlusCore
import Security

@MainActor final class ManagerModel: ObservableObject {
    @Published private(set) var settings: ManagementProtocol.Settings?
    @Published private(set) var revision: String?
    @Published private(set) var runtime: ManagementProtocol.RuntimeIdentity?
    @Published private(set) var capabilities: [String] = []
    @Published private(set) var status: [String: Any] = [:]
    @Published private(set) var busy = false
    @Published private(set) var message = "正在读取 interactiond…"
    @Published private(set) var pendingOpen: UUID?
    @Published private(set) var modules: [String: ModuleObservation] = [:]
    @Published private(set) var moduleErrors: [String: String] = [:]
    private var serviceConnection: ServiceControlClient?
    private var started = false
    private var current: Task<Void, Never>?
    private var connection: ManagementConnection?

    func cancel() { current?.cancel(); connection?.cancel(); serviceConnection?.cancel(); current = nil; connection = nil }
    func start() { guard !started else { return }; started = true; attach() }
    func refresh() {
        guard !busy else { return }
        perform {
            for role in ["contextd", "taskd"] {
                try Task.checkCancellation()
                let service = ServiceControlClient(); self.serviceConnection = service
                do { self.modules[role] = try await service.inspect(role); self.moduleErrors[role] = nil }
                catch is CancellationError { throw CancellationError() }
                catch { self.moduleErrors[role] = error.localizedDescription }
                self.serviceConnection = nil
            }
            let state = try await self.call(.status)
            self.status = state
            self.adoptPendingOpen(state)
            let result = try await self.call(.settingsRead)
            try self.acceptSettings(result)
            self.message = "已连接原 interactiond 运行主体"
        }
    }
    private func acceptSettings(_ result: [String: Any]) throws {
        guard let object = result["settings"] as? [String: Any], let revision = result["settings_revision"] as? String,
              ManagementProtocol.isDigest(revision) else { throw ManagementProtocol.failure("settings_response_unavailable") }
        let settings = try JSONDecoder().decode(ManagementProtocol.Settings.self, from: JSONSerialization.data(withJSONObject: object))
        guard try settings.revision == revision else { throw ManagementProtocol.failure("settings_revision_changed") }
        self.settings = settings; self.revision = revision
    }
    func write(_ changes: [String: Any]) {
        guard !busy, let runtime, let revision else { return }
        perform {
            do {
                let result = try await self.call(.settingsWrite, extra: ["expected_runtime": runtime.instance_id.uuidString,
                    "expected_settings_revision": revision, "changes": changes])
                try self.acceptSettings(result); self.message = "设置已由 interactiond 保存并读回"
            } catch {
                let reason = error.localizedDescription
                // Reconcile current values only; never repeat a settings write.
                if let actual = try? await self.call(.settingsRead) { try? self.acceptSettings(actual) }
                self.message = "写入回执未确认，已尝试只读核对当前值：\(reason)"
            }
        }
    }
    func openWorkbench() {
        guard !busy, pendingOpen == nil, let runtime else { return }
        let id = UUID(); pendingOpen = id
        perform {
            do {
                _ = try await self.call(.workspaceOpen, id: id, extra: ["expected_runtime": runtime.instance_id.uuidString])
                self.message = "工作台请求已接收；正在读取实际窗口状态"
            } catch { self.message = "工作台回执未知，保留原请求并只读核对：\(error.localizedDescription)" }
            await self.reconcileOpen(id: id, instance: runtime.instance_id)
        }
    }
    private func adoptPendingOpen(_ state: [String: Any]) {
        guard let open = state["workspace_request"] as? [String: Any],
              let id = ManagementProtocol.uuid(open["request_id"]), let phase = open["phase"] as? String else { return }
        pendingOpen = ["ready", "failed", "closed"].contains(phase) ? nil : id
    }
    func checkOpen() {
        guard !busy, let id = pendingOpen, let runtime else { return }
        perform { await self.reconcileOpen(id: id, instance: runtime.instance_id) }
    }
    private func reconcileOpen(id: UUID, instance: UUID) async {
        do {
            let result = try await call(.status, extra: ["expected_runtime": instance.uuidString, "query_request_id": id.uuidString])
            status = result
            adoptPendingOpen(result)
            guard let open = result["workspace_request"] as? [String: Any], open["request_id"] as? String == id.uuidString else {
                message = "原工作台请求结果未知，保留请求 ID"; return
            }
            let phase = open["phase"] as? String ?? "unknown"
            message = "工作台状态：\(phase)"
            if ["ready", "failed", "closed"].contains(phase) { pendingOpen = nil }
        } catch { message = "原工作台请求仍待核对：\(error.localizedDescription)" }
    }
    func attach() {
        guard !busy else { return }
        let existing = NSRunningApplication.runningApplications(withBundleIdentifier: ManagementProtocol.runtimeBundleID)
        if !existing.isEmpty { refresh(); return }
        guard FileManager.default.fileExists(atPath: ManagementProtocol.runtimePath) else { message = "未找到已安装的 interactiond 原生载体"; return }
        do {
            var code: SecStaticCode?, requirement: SecRequirement?
            let expression = "anchor apple generic and identifier \"me.longbiaochen.codex-plus\" and certificate leaf[subject.OU] = \"HJG65XBC25\""
            guard SecStaticCodeCreateWithPath(URL(fileURLWithPath: ManagementProtocol.runtimePath) as CFURL, [], &code) == errSecSuccess,
                  SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
                  let code, SecStaticCodeCheckValidity(code, [], requirement) == errSecSuccess else { throw ManagementProtocol.failure("installed_runtime_signature") }
        } catch { message = "运行主体身份核验失败"; refresh(); return }
        let config = NSWorkspace.OpenConfiguration(); config.activates = false; config.addsToRecentItems = false
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: ManagementProtocol.runtimePath), configuration: config) { _, error in
            Task { @MainActor in
                if let error { self.message = "启动失败：\(error.localizedDescription)" } else { self.refresh() }
            }
        }
    }
    private func perform(_ work: @escaping @MainActor () async throws -> Void) {
        busy = true
        current = Task { @MainActor in
            defer { self.busy = false; self.current = nil; self.connection = nil }
            do { try await work() }
            catch is CancellationError { self.message = "管理请求已取消" }
            catch { self.message = "未连接或接口尚不可用：\(error.localizedDescription)" }
        }
    }
    private func call(_ operation: ManagementProtocol.Operation, id: UUID = UUID(), extra: [String: Any] = [:]) async throws -> [String: Any] {
        try Task.checkCancellation()
        var request: [String: Any] = ["command": ManagementProtocol.command, "protocol": ManagementProtocol.version,
            "request_id": id.uuidString, "operation": operation.rawValue]
        for (key, value) in extra { request[key] = value }
        _ = try ManagementProtocol.Request.parse(request)
        let client = ManagementConnection(); connection = client
        let response = try await client.request(request); connection = nil
        try Task.checkCancellation()
        guard let object = response["runtime"] as? [String: Any] else { throw ManagementProtocol.failure("missing_runtime_identity") }
        let identity = try JSONDecoder().decode(ManagementProtocol.RuntimeIdentity.self, from: JSONSerialization.data(withJSONObject: object))
        try Self.verify(identity)
        if let expected = request["expected_runtime"] as? String, identity.instance_id.uuidString != expected { throw ManagementProtocol.failure("runtime_changed_result_unknown") }
        if operation == .settingsRead, let runtime, identity.instance_id != runtime.instance_id { throw ManagementProtocol.failure("runtime_changed_refresh_required") }
        runtime = identity; capabilities = response["capabilities"] as? [String] ?? []
        guard response["ok"] as? Bool == true else { throw ManagementProtocol.failure(response["error"] as? String ?? "management_request_failed") }
        return response["result"] as? [String: Any] ?? [:]
    }
    private static func verify(_ identity: ManagementProtocol.RuntimeIdentity) throws {
        guard identity.pid > 0, identity.bundle_id == ManagementProtocol.runtimeBundleID, identity.path == ManagementProtocol.runtimePath,
              let app = NSRunningApplication(processIdentifier: identity.pid), app.bundleIdentifier == identity.bundle_id,
              app.bundleURL?.standardizedFileURL.path == identity.path else { throw ManagementProtocol.failure("runtime_process_identity") }
        var code: SecCode?, requirement: SecRequirement?
        let attributes = [kSecGuestAttributePid as String: identity.pid] as CFDictionary
        let expression = "anchor apple generic and identifier \"me.longbiaochen.codex-plus\" and certificate leaf[subject.OU] = \"HJG65XBC25\""
        guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess,
              SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
              let code, SecCodeCheckValidity(code, [], requirement) == errSecSuccess else { throw ManagementProtocol.failure("runtime_signature_identity") }
    }
}
