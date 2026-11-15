import Foundation

struct ModuleObservation {
    let job: String
    let configuration: String
    let selection: String
    let source: String?
    let report: String
    let installed: Bool
}

/// One installed lifecycle CLI. Cancelling a view never interrupts a mutation.
final class ServiceControlClient: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var readOnly = true
    private var cancelled = false
    func cancel() {
        lock.lock(); defer { lock.unlock() }; cancelled = true
        if readOnly, let process, process.isRunning { process.terminate() }
    }
    func inspect(_ role: String) async throws -> ModuleObservation { try await request("inspect", role: role) }
    func control(_ action: String, role: String) async throws -> ModuleObservation {
        guard ["start", "stop"].contains(action) else { throw failure("invalid_action") }
        return try await request(action, role: role)
    }
    private func request(_ action: String, role: String) async throws -> ModuleObservation {
        guard ["contextd", "taskd", "interactiond"].contains(role) else { throw failure("invalid_role") }
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do { continuation.resume(returning: try self.perform(action, role: role)) }
                    catch { continuation.resume(throwing: error) }
                }
            }
        }, onCancel: { self.cancel() })
    }
    private func perform(_ action: String, role: String) throws -> ModuleObservation {
        let executable = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/dev-ops/bin/ss-service")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else { throw failure("正式控制器未安装") }
        let child = Process(), output = Pipe()
        child.executableURL = executable
        child.arguments = [action, "--component", role, "--holder", "smartshadow-manager", "--reason", action == "inspect" ? "读取组件状态" : "管理组件"]
        child.standardInput = FileHandle.nullDevice; child.standardOutput = output; child.standardError = FileHandle.nullDevice
        lock.lock()
        if cancelled { lock.unlock(); throw CancellationError() }
        readOnly = action == "inspect"
        do { try child.run(); process = child; lock.unlock() }
        catch { lock.unlock(); throw error }
        let raw = output.fileHandleForReading.readDataToEndOfFile(); child.waitUntilExit()
        lock.lock(); process = nil; let wasCancelled = cancelled; lock.unlock()
        try? output.fileHandleForReading.close()
        if wasCancelled && action == "inspect" { throw CancellationError() }
        guard let value = try JSONSerialization.jsonObject(with: raw) as? [String: Any],
              value["schema"] as? String == "smart-shadow.service-inspect/v1", value["component"] as? String == role else {
            throw failure(action == "inspect" ? "正式控制器尚不支持薄生命周期接口" : "操作结果未知，请刷新核对")
        }
        if child.terminationStatus != 0 { throw failure(value["error"] as? String ?? "操作未完成，请刷新核对") }
        let installed = value["installed"] as? Bool ?? false
        return ModuleObservation(job: value["state"] as? String ?? "unknown",
            configuration: value["configuration"] as? String ?? "unknown",
            selection: installed ? "正式安装" : "未安装",
            source: value["source_commit"] as? String,
            report: value["runtime_state"] as? String ?? "unknown", installed: installed)
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "SmartShadow.Service", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
