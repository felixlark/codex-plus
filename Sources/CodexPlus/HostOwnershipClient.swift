import AppKit
import Security
import CodexPlusCore

/// A read-only client of SmartShadow's signed status authority. Missing v4
/// evidence is waiting, never permission to discover and adopt another page.
enum HostOwnershipClient {
    static let authorityPath = "/Applications/SmartShadow.app/Contents/Library/LoginItems/SmartShadowInteraction.app"
    static let authorityBundle = CodexPlusIdentity.current.authorityBundleID
    static let socketPath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/SmartShadow/interactiond/management.sock").path

    private static func verifyAuthority(_ pid: Int32) throws {
        guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated,
              app.bundleIdentifier == authorityBundle, app.bundleURL?.path == authorityPath else { throw ManagementProtocol.failure("ownership_authority_unavailable") }
        var code: SecCode?, requirement: SecRequirement?
        let expression = try CodexPlusIdentity.current.authorityRequirement()
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String:pid] as CFDictionary, [], &code) == errSecSuccess,
              SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
              let code, SecCodeCheckValidity(code, [], requirement) == errSecSuccess else { throw ManagementProtocol.failure("ownership_authority_signature") }
    }

    static func read() async throws -> [String: Any] {
        _ = try CodexPlusIdentity.current.requireOperational()
        let request: [String: Any] = ["command":"management-v1", "protocol":1,
                                    "request_id":UUID().uuidString, "operation":"status"]
        let response = try await ManagementConnection(path: socketPath, timeout: 10, verifyPeer: verifyAuthority).request(request)
        guard response["ok"] as? Bool == true,
              let runtime = response["runtime"] as? [String: Any],
              runtime["bundle_id"] as? String == authorityBundle,
              runtime["path"] as? String == authorityPath,
              let pid = runtime["pid"] as? Int32,
              let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated,
              app.bundleIdentifier == authorityBundle, app.bundleURL?.path == authorityPath else {
            throw ManagementProtocol.failure("ownership_authority_unavailable")
        }
        var code: SecCode?, requirement: SecRequirement?
        let expression = try CodexPlusIdentity.current.authorityRequirement()
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String:pid] as CFDictionary, [], &code) == errSecSuccess,
              SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
              let code, SecCodeCheckValidity(code, [], requirement) == errSecSuccess,
              let result = response["result"] as? [String: Any],
              let scope = result["codexTargetOwnership"] as? [String: Any],
              scope["schema"] as? String == "codex-target-ownership/v1",
              HumanTargetScope(scope) != nil,
              let host = scope["host"] as? [String: Any],
              let hostPID = host["pid"] as? Int32,
              let actual = ProcessIdentity.read(hostPID),
              (actual["start_seconds"] as? NSNumber) == (host["start_seconds"] as? NSNumber),
              (actual["start_microseconds"] as? NSNumber) == (host["start_microseconds"] as? NSNumber),
              let vendor = NSRunningApplication(processIdentifier: hostPID), !vendor.isTerminated,
              vendor.bundleIdentifier == "com.openai.codex", vendor.bundleURL?.path == "/Applications/ChatGPT.app" else {
            throw ManagementProtocol.failure("ownership_evidence_unavailable")
        }
        var vendorCode: SecCode?, vendorRequirement: SecRequirement?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String:hostPID] as CFDictionary, [], &vendorCode) == errSecSuccess,
              SecRequirementCreateWithString("anchor apple generic and identifier \"com.openai.codex\" and certificate leaf[subject.OU] = \"2DC432GLL2\"" as CFString, [], &vendorRequirement) == errSecSuccess,
              let vendorCode, SecCodeCheckValidity(vendorCode, [], vendorRequirement) == errSecSuccess else { throw ManagementProtocol.failure("vendor_process_signature") }
        return scope
    }
}
