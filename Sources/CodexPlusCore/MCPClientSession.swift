import Foundation
import Darwin

/// A temporary stdio client only. It never signals the shared service owner.
public final class MCPClientSession {
    private let process = Process()
    private let input = Pipe(), output = Pipe()
    private let exited = DispatchSemaphore(value: 0)
    private let deadline: DispatchTime
    private let ioDeadline: DispatchTime
    private var finished = false
    private let reader: JSONLinePipeReader
    public private(set) var timedOut = false
    public var processIdentifier: Int32 { process.processIdentifier }
    public var isRunning: Bool { process.isRunning }

    public init(executable: URL, arguments: [String], environment: [String: String], timeout: TimeInterval) throws {
        guard timeout.isFinite, timeout > 0 else { throw NSError(domain: "MCPClientSession", code: 1) }
        let now = DispatchTime.now()
        deadline = now + timeout
        // The configured total includes reaping: reserve the final 10% for it.
        ioDeadline = now + timeout * 0.9
        reader = JSONLinePipeReader(input: output.fileHandleForReading)
        process.executableURL = executable; process.arguments = arguments; process.environment = environment
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        let exited = self.exited
        process.terminationHandler = { _ in exited.signal() }
        try process.run()
    }

    public func request(id: Int, method: String, params: [String: Any]) -> [String: Any]? {
        guard !finished, JSONLinePipeWriter.write(["jsonrpc": "2.0", "id": id, "method": method, "params": params], to: input.fileHandleForWriting) else { return nil }
        let response = reader.response(matchingID: id, deadline: ioDeadline)
        if response == nil, DispatchTime.now() >= ioDeadline { timedOut = true }
        return response
    }

    public func notify(method: String) {
        _ = JSONLinePipeWriter.write(["jsonrpc": "2.0", "method": method], to: input.fileHandleForWriting)
    }

    @discardableResult public func finish() -> Bool {
        guard !finished else { return !timedOut }
        finished = true
        try? input.fileHandleForWriting.close()
        if exited.wait(timeout: ioDeadline) == .success { return !timedOut }
        timedOut = true
        // Only this owned proxy PID. Closing its socket leaves persistent OCU intact.
        if process.isRunning { _ = Darwin.kill(process.processIdentifier, SIGKILL) }
        _ = exited.wait(timeout: deadline)
        return false
    }

    deinit {
        if !finished {
            try? input.fileHandleForWriting.close()
            if process.isRunning { _ = Darwin.kill(process.processIdentifier, SIGKILL) }
        }
    }
}
