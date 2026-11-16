import AppKit
import Combine
import CodexPlusCore
import Security
import ServiceManagement

@MainActor final class ManagerModel: ObservableObject {
    @Published private(set) var settings: ManagementProtocol.Settings?
    @Published private(set) var revision: String?
    @Published private(set) var runtime: ManagementProtocol.RuntimeIdentity?
    @Published private(set) var capabilities: [String] = []
    @Published private(set) var status: [String: Any] = [:]
    @Published private(set) var busy = false
    @Published private(set) var message = "正在读取服务状态…"
    @Published private(set) var modules: [String: ModuleObservation] = [:]
    @Published private(set) var moduleErrors: [String: String] = [:]
    @Published private(set) var loginEnabled = SMAppService.loginItem(identifier: SmartShadowInstallation.helperBundleID).status == .enabled
    @Published private(set) var loginError: String?
    private var serviceConnection: ServiceControlClient?
    private var started = false
    private var current: Task<Void, Never>?
    private var connection: ManagementConnection?

    func cancel() { current?.cancel(); connection?.cancel(); serviceConnection?.cancel(); current = nil; connection = nil }
    func start() { guard !started else { return }; started = true; refresh() }
    func refresh() {
        guard !busy else { return }
        perform {
            for role in ["contextd", "taskd", "interactiond"] {
                try Task.checkCancellation()
                let service = ServiceControlClient(); self.serviceConnection = service
                do { self.modules[role] = try await service.inspect(role); self.moduleErrors[role] = nil }
                catch is CancellationError { throw CancellationError() }
                catch { self.moduleErrors[role] = error.localizedDescription }
                self.serviceConnection = nil
            }
            do {
                self.status = try await self.call(.status)
                try self.acceptSettings(try await self.call(.settingsRead))
                self.message = "已读取服务与 interactiond 设置"
            } catch {
                self.settings = nil; self.revision = nil; self.runtime = nil; self.capabilities = []
                self.message = "服务状态已读取；interactiond 设置暂不可用"
            }
        }
    }
    func control(_ action: String, role: String) {
        guard !busy else { return }
        perform {
            let service = ServiceControlClient(); self.serviceConnection = service
            do {
                self.modules[role] = try await service.control(action, role: role)
                self.moduleErrors[role] = nil
                self.message = "\(role)：\(self.modules[role]?.job ?? "unknown")"
                if role == "interactiond", action == "start" {
                    self.status = try await self.call(.status)
                    try self.acceptSettings(try await self.call(.settingsRead))
                } else if role == "interactiond", action == "stop" {
                    self.status = [:]; self.runtime = nil; self.settings = nil; self.revision = nil; self.capabilities = []
                }
            } catch {
                self.moduleErrors[role] = error.localizedDescription
                self.message = "操作结果以刷新读回为准"
                // Unknown mutations are never repeated. Read only the current state.
                let read = ServiceControlClient(); self.serviceConnection = read
                if let actual = try? await read.inspect(role) { self.modules[role] = actual }
            }
            self.serviceConnection = nil
        }
    }
    func configure(_ role: String, path: String) {
        guard !busy, let observed = modules[role], observed.job == "stopped",
              let expected = observed.configurationSHA256, ManagementProtocol.isDigest(expected) else { return }
        perform {
            let service = ServiceControlClient(); self.serviceConnection = service
            do {
                self.modules[role] = try await service.configure(role, path: path, expectedSHA256: expected)
                self.moduleErrors[role] = nil
                self.message = "\(role)：配置已保存并读回"
            } catch {
                self.moduleErrors[role] = error.localizedDescription
                self.message = "配置写入未确认，请核对当前摘要"
                let read = ServiceControlClient(); self.serviceConnection = read
                if let actual = try? await read.inspect(role) { self.modules[role] = actual }
            }
            self.serviceConnection = nil
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
            } catch let rejection as Rejected {
                if rejection.code == .conflict, (try? self.acceptSettings(rejection.result)) != nil {
                    self.message = "设置已变化，本次修改未写入；已读取当前值"
                } else {
                    if let actual = try? await self.call(.settingsRead) { try? self.acceptSettings(actual) }
                    self.message = rejection.code == .conflict ? "设置已变化，本次修改未写入" : "当前运行接口不支持本次设置，未写入"
                }
            } catch {
                let reason = error.localizedDescription
                // Reconcile current values only; never repeat a settings write.
                if let actual = try? await self.call(.settingsRead) { try? self.acceptSettings(actual) }
                self.message = "写入回执未确认，已尝试只读核对当前值：\(reason)"
            }
        }
    }
    /// This button is an explicit start; merely opening the UI never calls it.
    func attach() { control("start", role: "interactiond") }
    func setLogin(_ enabled: Bool) {
        guard !busy else { return }
        perform {
            let login = SMAppService.loginItem(identifier: SmartShadowInstallation.helperBundleID)
            defer { self.loginEnabled = login.status == .enabled }
            do {
                let service = ServiceControlClient(); self.serviceConnection = service
                defer { self.serviceConnection = nil }
                if enabled {
                    // register() may launch a login helper immediately. Start it
                    // through the official controller first, then register that
                    // same installed identity rather than create an unmanaged run.
                    self.modules["interactiond"] = try await service.control("start", role: "interactiond")
                    try login.register()
                } else {
                    // Apple unregister() terminates a live login item. A future
                    // login preference must never bypass prepare/drain/stop.
                    self.modules["interactiond"] = try await service.inspect("interactiond")
                    guard self.modules["interactiond"]?.job == "stopped",
                          [SmartShadowInstallation.helperBundleID, SmartShadowInstallation.legacyBundleID].allSatisfy({ id in
                              !NSRunningApplication.runningApplications(withBundleIdentifier: id).contains(where: { !$0.isTerminated })
                          }) else { throw ManagementProtocol.failure("请先通过停止按钮正常停止 interactiond，再关闭登录启动；之后仍可手动启动后台。") }
                    try await login.unregister()
                }
                self.loginError = nil
                self.message = login.status == .requiresApproval ? "登录启动等待系统设置批准" : "登录启动设置已读回"
            } catch {
                self.loginError = error.localizedDescription
                self.message = "登录设置未确认；未重放请求，请按当前服务状态核对"
            }
        }
    }
    func action(_ operation: ManagementProtocol.Operation) {
        guard !busy, let runtime, [.openCodex, .reconnect].contains(operation) else { return }
        perform {
            _ = try await self.call(operation, extra: ["expected_runtime": runtime.instance_id.uuidString])
            self.status = try await self.call(.status)
            self.message = "请求已交给 interactiond；结果以当前状态为准"
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
    private struct Rejected: LocalizedError {
        let code: ManagementProtocol.Rejection
        let result: [String: Any]
        var errorDescription: String? { code == .unsupported ? "当前运行接口不支持此操作" : "设置已变化，请刷新" }
    }
    private func call(_ operation: ManagementProtocol.Operation, extra: [String: Any] = [:]) async throws -> [String: Any] {
        try Task.checkCancellation()
        var request: [String: Any] = ["command": ManagementProtocol.command, "protocol": ManagementProtocol.version,
            "request_id": UUID().uuidString, "operation": operation.rawValue]
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
        if let code = ManagementProtocol.rejection(in: response) {
            throw Rejected(code: code, result: response["result"] as? [String: Any] ?? [:])
        }
        guard response["ok"] as? Bool == true else { throw ManagementProtocol.failure(response["error"] as? String ?? "management_request_failed_result_unknown") }
        return response["result"] as? [String: Any] ?? [:]
    }
    private static func verify(_ identity: ManagementProtocol.RuntimeIdentity) throws {
        try SmartShadowInstallation.verifyRuntime(identity)
    }
}
