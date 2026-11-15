import Foundation
import Combine
import CodexPlusCore

/// This client owns only its short-lived MCP reader, never taskd or a Codex Run.
private final class TaskBoardClient: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false
    func cancel() {
        lock.lock(); defer { lock.unlock() }
        cancelled = true
        if let process, process.isRunning { process.terminate() }
    }
    func read(_ command: McpCommand) async throws -> TaskBoardSnapshot {
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do { continuation.resume(returning: try self.perform(command)) }
                    catch { continuation.resume(throwing: error) }
                }
            }
        }, onCancel: { self.cancel() })
    }
    private func perform(_ command: McpCommand) throws -> TaskBoardSnapshot {
        guard command.executable.hasPrefix("/"), FileManager.default.isExecutableFile(atPath: command.executable) else { throw failure("正式 taskd 读取入口不可用") }
        let child = Process(), input = Pipe(), output = Pipe()
        child.executableURL = URL(fileURLWithPath: command.executable); child.arguments = command.arguments
        child.standardInput = input; child.standardOutput = output; child.standardError = FileHandle.nullDevice
        lock.lock()
        if cancelled { lock.unlock(); throw CancellationError() }
        do { try child.run(); process = child; lock.unlock() } catch { lock.unlock(); throw error }
        defer {
            try? input.fileHandleForWriting.close()
            if child.isRunning { child.terminate() }
            child.waitUntilExit()
            try? output.fileHandleForReading.close()
            lock.lock(); process = nil; lock.unlock()
        }
        let reader = JSONLinePipeReader(input: output.fileHandleForReading)
        func request(_ id: Int, _ method: String, _ params: [String: Any]) throws -> [String: Any] {
            guard JSONLinePipeWriter.write(["jsonrpc":"2.0", "id":id, "method":method, "params":params], to: input.fileHandleForWriting),
                  let response = reader.response(matchingID: id), response["error"] == nil,
                  let result = response["result"] as? [String: Any], result["isError"] as? Bool != true else { throw failure("任务读取未成功；未显示旧数据") }
            return result
        }
        _ = try request(1, "initialize", ["protocolVersion":"2025-03-26", "capabilities":[:], "clientInfo":["name":"smartshadow-task-board", "version":"1"]])
        guard JSONLinePipeWriter.write(["jsonrpc":"2.0", "method":"notifications/initialized"], to: input.fileHandleForWriting) else { throw failure("任务读取连接已断开") }
        let result = try request(2, "tools/call", ["name":"tasks_read", "arguments":[:]])
        guard let content = result["structuredContent"] as? [String: Any] else { throw failure("taskd 未提供当前任务投影") }
        return try TaskBoardSnapshot.decode(content)
    }
    private func failure(_ text: String) -> NSError { NSError(domain: "TaskBoard", code: 1, userInfo: [NSLocalizedDescriptionKey:text]) }
}

@MainActor final class TaskBoardModel: ObservableObject {
    @Published private(set) var updatedAt: Date?
    @Published private(set) var busy = false
    @Published private(set) var error: String?
    @Published private(set) var codexError: String?
    @Published private(set) var board = UnifiedTaskBoard(tasks: nil, codex: nil, expectedSourceCommit: nil)
    private var work: Task<Void, Never>?
    private var service: ServiceControlClient?
    private var client: TaskBoardClient?
    private var catalog: TaskCatalogClient?
    func refresh() {
        guard !busy else { return }
        busy = true; error = nil; codexError = nil
        work = Task {
            defer { busy = false; work = nil; service = nil; client = nil; catalog = nil }
            var tasks: TaskBoardSnapshot?, source: String?, codex: CodexTaskCatalog?
            do {
                let service = ServiceControlClient(); self.service = service
                let observation = try await service.inspect("taskd")
                source = observation.source
                try Task.checkCancellation()
                guard observation.installed, let command = observation.mcp else { throw NSError(domain:"TaskBoard", code:1, userInfo:[NSLocalizedDescriptionKey:"taskd 正式读取入口尚未安装"]) }
                let client = TaskBoardClient(); self.client = client
                let value = try await client.read(command)
                try Task.checkCancellation()
                tasks = value
            } catch is CancellationError { }
            catch { self.error = error.localizedDescription }
            if Task.isCancelled { return }
            do {
                let catalog = TaskCatalogClient(); self.catalog = catalog
                codex = try await catalog.read(sourceCommit: source)
                self.codexError = codex?.error
            } catch is CancellationError { return }
            catch { self.codexError = "Codex 当前任务读取不可用" }
            if Task.isCancelled { return }
            board = UnifiedTaskBoard(tasks: tasks, codex: codex, expectedSourceCommit: source)
            updatedAt = Date()
        }
    }
    func cancel() { work?.cancel(); service?.cancel(); client?.cancel(); catalog?.cancel() }
}
