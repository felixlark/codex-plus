import Foundation
import AppKit
import Security
import CodexPlusCore

enum LifecycleCommand {
    static func run(_ args: [String]) -> Bool {
        guard args.first?.hasPrefix("--lifecycle-") == true else { return false }
        Task {
            do {
                let operations = ["--lifecycle-status":"status", "--lifecycle-prepare-stop":"lifecycle.prepare-stop", "--lifecycle-stop":"lifecycle.stop", "--lifecycle-resume":"lifecycle.resume"]
                guard let operation = operations[args[0]] else { throw ManagementProtocol.failure("invalid_operation") }
                var request: [String: Any] = ["command":ManagementProtocol.command, "protocol":1, "request_id":UUID().uuidString, "operation":operation]
                var i = 1
                while i < args.count {
                    guard i + 1 < args.count else { throw ManagementProtocol.failure("invalid_option") }
                    let field = ["--expected-instance":"expected_runtime", "--expected-scope":"expected_scope_revision"][args[i]]
                    guard let field, request[field] == nil else { throw ManagementProtocol.failure("invalid_option") }
                    request[field] = args[i+1]; i += 2
                }
                _ = try ManagementProtocol.Request.parse(request)
                // Authenticate the original respondent before sending any lifecycle effect.
                if operation != "status" {
                    let probe: [String: Any] = ["command":ManagementProtocol.command,"protocol":1,"request_id":UUID().uuidString,"operation":"status"]
                    let value = try await ManagementConnection().request(probe)
                    let actual = try JSONDecoder().decode(ManagementProtocol.RuntimeIdentity.self, from: JSONSerialization.data(withJSONObject:value["runtime"] as Any))
                    try verify(actual)
                    guard actual.instance_id.uuidString.lowercased() == (request["expected_runtime"] as? String)?.lowercased() else { throw ManagementProtocol.failure("runtime_changed") }
                }
                let response = try await ManagementConnection().request(request)
                let identity = try JSONDecoder().decode(ManagementProtocol.RuntimeIdentity.self, from: JSONSerialization.data(withJSONObject:response["runtime"] as Any))
                if operation != "lifecycle.stop" || response["ok"] as? Bool != true { try verify(identity) }
                FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:response, options:[.sortedKeys]) + Data([10]))
                exit(response["ok"] as? Bool == true ? 0 : 1)
            } catch { fputs("Lifecycle request unavailable or result unknown.\n", stderr); exit(1) }
        }
        dispatchMain()
    }
    private static func verify(_ identity: ManagementProtocol.RuntimeIdentity) throws {
        guard identity.path == ManagementProtocol.runtimePath, identity.bundle_id == ManagementProtocol.runtimeBundleID,
              let app = NSRunningApplication(processIdentifier:identity.pid), app.bundleURL?.path == identity.path else { throw ManagementProtocol.failure("runtime_identity") }
        var code: SecCode?, requirement: SecRequirement?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String:identity.pid] as CFDictionary, [], &code) == errSecSuccess,
              SecRequirementCreateWithString("anchor apple generic and identifier \"me.longbiaochen.codex-plus\" and certificate leaf[subject.OU] = \"HJG65XBC25\"" as CFString, [], &requirement) == errSecSuccess,
              let code, SecCodeCheckValidity(code, [], requirement) == errSecSuccess else { throw ManagementProtocol.failure("runtime_signature") }
    }
}
