import Foundation
import CodexPlusCore

/// Owns a short-lived reader, not the Electron application or app-server.
final class TaskCatalogClient: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false
    func cancel() {
        lock.lock(); defer { lock.unlock() }
        cancelled = true
        if let process, process.isRunning { process.terminate() }
    }
    func read(sourceCommit: String?) async throws -> CodexTaskCatalog {
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do { continuation.resume(returning: try self.perform(sourceCommit)) }
                    catch { continuation.resume(throwing: error) }
                }
            }
        }, onCancel: { self.cancel() })
    }
    private func perform(_ sourceCommit: String?) throws -> CodexTaskCatalog {
        guard let script = Bundle.module.url(forResource: "task-catalog", withExtension: "mjs", subdirectory: "Resources") else {
            throw NSError(domain: "TaskCatalog", code: 1)
        }
        let child = Process(), output = Pipe()
        child.executableURL = URL(fileURLWithPath: "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node")
        child.arguments = [script.path, sourceCommit ?? ""]
        child.standardInput = FileHandle.nullDevice; child.standardOutput = output; child.standardError = FileHandle.nullDevice
        lock.lock()
        if cancelled { lock.unlock(); throw CancellationError() }
        do { try child.run(); process = child; lock.unlock() }
        catch { lock.unlock(); throw error }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        child.waitUntilExit(); try? output.fileHandleForReading.close()
        lock.lock(); process = nil; let didCancel = cancelled; lock.unlock()
        if didCancel { throw CancellationError() }
        return try JSONDecoder().decode(CodexTaskCatalog.self, from: data)
    }
}
