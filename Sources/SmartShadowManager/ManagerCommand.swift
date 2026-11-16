import Foundation
import CodexPlusCore

/// Explicit F6/start-stop requests use the same installed controller as the UI.
/// A normal UI launch never enters this path and never starts a stopped helper.
@MainActor enum ManagerCommand {
    static func run(_ arguments: [String]) -> Bool {
        guard let first = arguments.first, ["--open-codex", "--stop-interactiond"].contains(first) else { return false }
        guard arguments.count == 1 else { fputs("Unexpected option.\n", stderr); exit(2) }
        Task { @MainActor in
            do {
                let service = ServiceControlClient()
                _ = try await service.control(first == "--open-codex" ? "start" : "stop", role: "interactiond")
                if first == "--open-codex" {
                    let probe: [String: Any] = ["command": ManagementProtocol.command, "protocol": ManagementProtocol.version,
                        "request_id": UUID().uuidString, "operation": "status"]
                    let response = try await ManagementConnection().request(probe)
                    let identity = try JSONDecoder().decode(ManagementProtocol.RuntimeIdentity.self,
                        from: JSONSerialization.data(withJSONObject: response["runtime"] as Any))
                    try SmartShadowInstallation.verifyRuntime(identity)
                    let request: [String: Any] = ["command": ManagementProtocol.command, "protocol": ManagementProtocol.version,
                        "request_id": UUID().uuidString, "operation": "codex.open", "expected_runtime": identity.instance_id.uuidString]
                    _ = try ManagementProtocol.Request.parse(request)
                    let result = try await ManagementConnection().request(request)
                    guard let object = result["runtime"] as? [String: Any] else { throw ManagementProtocol.failure("missing_runtime_identity") }
                    let actual = try JSONDecoder().decode(ManagementProtocol.RuntimeIdentity.self,
                        from: JSONSerialization.data(withJSONObject: object))
                    guard actual.instance_id == identity.instance_id else { throw ManagementProtocol.failure("runtime_changed_result_unknown") }
                    try SmartShadowInstallation.verifyRuntime(actual)
                    guard ManagementProtocol.boolean(result["ok"]) == true else { throw ManagementProtocol.failure("open_result_unknown") }
                }
                print("{\"ok\":true}"); exit(0)
            } catch {
                fputs("SmartShadow request unconfirmed; inspect the original service before retrying.\n", stderr); exit(1)
            }
        }
        dispatchMain()
    }
}

@main enum SmartShadowEntry {
    @MainActor static func main() {
        if ManagerCommand.run(Array(CommandLine.arguments.dropFirst())) { return }
        SmartShadowManagerApp.main()
    }
}
