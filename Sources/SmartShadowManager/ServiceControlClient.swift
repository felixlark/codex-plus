import Foundation

struct ModuleObservation: Identifiable {
    let id: String
    let job: String
    let configuration: String
    let selection: String
    let source: String?
    let report: String
}

/// Read-only consumer of the installed ss-service. It never constructs a
/// publication plan, changes a release, controls launchd or retries a mutation.
final class ServiceControlClient: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false
    func cancel() {
        lock.lock(); defer { lock.unlock() }; cancelled = true
        if let process, process.isRunning { process.terminate() }
    }
    func inspect(_ role: String) async throws -> ModuleObservation {
        guard ["contextd", "taskd"].contains(role) else { throw failure("invalid_role") }
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do { continuation.resume(returning: try self.perform(role)) }
                    catch { continuation.resume(throwing: error) }
                }
            }
        }, onCancel: { self.cancel() })
    }
    private func perform(_ role: String) throws -> ModuleObservation {
        let executable = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/dev-ops/bin/ss-service")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else { throw failure("正式控制器未安装") }
        let child = Process(), output = Pipe()
        child.executableURL = executable
        child.arguments = ["inspect", "--component", role, "--holder", "smartshadow-manager", "--reason", "读取组件状态"]
        child.standardInput = FileHandle.nullDevice; child.standardOutput = output; child.standardError = FileHandle.nullDevice
        lock.lock()
        if cancelled { lock.unlock(); throw CancellationError() }
        do { try child.run(); process = child; lock.unlock() }
        catch { lock.unlock(); throw error }
        let raw = output.fileHandleForReading.readDataToEndOfFile(); child.waitUntilExit()
        lock.lock(); process = nil; let wasCancelled = cancelled; lock.unlock()
        try? output.fileHandleForReading.close()
        if wasCancelled { throw CancellationError() }
        guard child.terminationStatus == 0, let value = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
              value["schema"] as? String == "ss-service.component-inspect/v1", value["component"] as? String == role,
              value["service_actions"] as? Int == 0 else { throw failure("正式控制器尚不支持该角色的状态读取") }
        let job = value["job"] as? [String: Any] ?? [:], config = value["configuration"] as? [String: Any] ?? [:]
        let layout = value["layout"] as? [String: Any] ?? [:], package = value["package"] as? [String: Any] ?? [:]
        let report = value["runtime_report"] as? [String: Any] ?? [:]
        let selected = layout["configuration_selected"] as? Bool
        return ModuleObservation(id: role, job: job["state"] as? String ?? "unknown",
            configuration: config["state"] as? String ?? "unknown", selection: selected.map { $0 ? "已选中配置" : "配置未选中" } ?? "选择未知",
            source: package["source_commit"] as? String, report: report["state"] as? String ?? "unknown")
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "SmartShadow.Service", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
