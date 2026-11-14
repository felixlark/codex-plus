import Foundation
import CodexPlusCore

/// Exact-window operations use the installed official OCU stdio MCP surface.
/// Observe capabilities and act in the same session; leave Plus's main thread
/// free so OCU can query Plus's own Agent Settings through accessibility.
final class OpenComputerUseWindowClient {
    static let executable = "/Applications/Open Computer Use (Dev).app/Contents/MacOS/OpenComputerUse"
    enum Outcome { case accepted, unavailable, unsupported, unknown }

    func call(arguments: [String: Any]? = nil, completion: @escaping (Outcome) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let process = Process(), input = Pipe(), output = Pipe()
            process.executableURL = URL(fileURLWithPath: Self.executable)
            process.arguments = ["mcp"]
            var environment = ProcessInfo.processInfo.environment
            environment["OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE"] = "persistent-display"
            environment["OPEN_COMPUTER_USE_CONFIG_FILE"] = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/open-computer-use-persistent/config.json").path
            environment["OPEN_COMPUTER_USE_VIRTUAL_DISPLAY_ENABLED"] = "true"
            environment["OPEN_COMPUTER_USE_VIRTUAL_DISPLAY_RESTORE_ON_SESSION_END"] = "false"
            environment["OPEN_COMPUTER_USE_ACTION_READ_BACK"] = "0"
            environment["OPEN_COMPUTER_USE_VISUAL_CURSOR"] = "0"
            process.environment = environment
            process.standardInput = input; process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            do { try process.run() } catch {
                DispatchQueue.main.async { completion(.unavailable) }; return
            }
            var buffer = Data()
            func request(_ id: Int, _ method: String, _ params: [String: Any]) -> [String: Any]? {
                guard var bytes = try? JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "id": id, "method": method, "params": params]) else { return nil }
                bytes.append(10)
                do { try input.fileHandleForWriting.write(contentsOf: bytes) } catch { return nil }
                while true {
                    while let newline = buffer.firstIndex(of: 10) {
                        let line = buffer.prefix(upTo: newline); buffer.removeSubrange(...newline)
                        if let object = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any], object["id"] as? Int == id { return object }
                    }
                    guard let bytes = try? output.fileHandleForReading.read(upToCount: 4096), !bytes.isEmpty else { return nil }
                    buffer.append(bytes)
                }
            }
            var outcome: Outcome = .unsupported
            let initialized = request(1, "initialize", ["protocolVersion": "2025-03-26", "capabilities": [:], "clientInfo": ["name": "Codex Plus", "version": "0.10.0"]])?["result"] != nil
            if initialized, var notification = try? JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "method": "notifications/initialized"]) {
                notification.append(10); try? input.fileHandleForWriting.write(contentsOf: notification)
            }
            if initialized, let listed = request(2, "tools/list", [:])?["result"] as? [String: Any],
               let tools = listed["tools"] as? [[String: Any]],
               let schema = tools.first(where: { $0["name"] as? String == "get_app_state" })?["inputSchema"] as? [String: Any],
               OCUWindowProtocol.supportsExactLifecycle(schema) {
                // An error may follow a partial move. Caller must inspect the
                // exact identity/frame; never replay an unknown operation.
                if let arguments {
                    let result = request(3, "tools/call", ["name": "get_app_state", "arguments": arguments])?["result"] as? [String: Any]
                    outcome = result?["isError"] as? Bool == false ? .accepted : .unknown
                } else { outcome = .accepted }
            }
            try? input.fileHandleForWriting.close()
            process.waitUntilExit()
            DispatchQueue.main.async { completion(outcome) }
        }
    }
}
