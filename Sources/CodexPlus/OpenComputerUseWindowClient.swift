import Foundation
import CodexPlusCore

/// Exact-window operations use the installed official OCU stdio MCP surface.
/// Observe capabilities and act in the same session; leave Plus's main thread
/// free so OCU can query Plus's own Agent Settings through accessibility.
final class OpenComputerUseWindowClient {
    static let executable = "/Applications/Open Computer Use (Dev).app/Contents/MacOS/OpenComputerUse"
    enum Outcome {
        case accepted, unavailable, unsupported, unknown(String)
        var diagnostic: String {
            switch self {
            case .accepted: return "accepted"
            case .unavailable: return "client-unavailable"
            case .unsupported: return "exact-lifecycle-unsupported"
            case .unknown(let reason): return reason
            }
        }
    }

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
            let reader = JSONLinePipeReader(input: output.fileHandleForReading)
            func request(_ id: Int, _ method: String, _ params: [String: Any]) -> [String: Any]? {
                guard JSONLinePipeWriter.write(["jsonrpc": "2.0", "id": id, "method": method, "params": params], to: input.fileHandleForWriting) else { return nil }
                return reader.response(matchingID: id)
            }
            var outcome: Outcome = .unsupported
            let initialized = request(1, "initialize", ["protocolVersion": "2025-03-26", "capabilities": [:], "clientInfo": ["name": "Codex Plus", "version": "0.10.0"]])?["result"] != nil
            if initialized {
                _ = JSONLinePipeWriter.write(["jsonrpc": "2.0", "method": "notifications/initialized"], to: input.fileHandleForWriting)
            }
            if initialized, let listed = request(2, "tools/list", [:])?["result"] as? [String: Any],
               let tools = listed["tools"] as? [[String: Any]],
               let schema = tools.first(where: { $0["name"] as? String == "get_app_state" })?["inputSchema"] as? [String: Any],
               OCUWindowProtocol.supportsExactLifecycle(schema) {
                // An error may follow a partial move. Caller must inspect the
                // exact identity/frame; never replay an unknown operation.
                if let arguments {
                    let reply = request(3, "tools/call", ["name": "get_app_state", "arguments": arguments])
                    let result = reply?["result"] as? [String: Any]
                    if result?["isError"] as? Bool == false { outcome = .accepted }
                    else {
                        let content = result?["content"] as? [[String: Any]]
                        let reason = content?.first(where: { $0["type"] as? String == "text" })?["text"] as? String
                            ?? (reply?["error"] as? [String: Any])?["message"] as? String ?? "unconfirmed-tool-reply"
                        // Only the first error line; never retain AX trees or image data.
                        outcome = .unknown(String((reason.split(separator: "\n").first ?? "unconfirmed-tool-reply").prefix(1000)))
                    }
                } else { outcome = .accepted }
            }
            try? input.fileHandleForWriting.close()
            process.waitUntilExit()
            DispatchQueue.main.async { completion(outcome) }
        }
    }
}
