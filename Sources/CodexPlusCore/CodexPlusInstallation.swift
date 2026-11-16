import AppKit
import Security
public enum CodexPlusInstallation {
    public static let bundleID = CodexPlusIdentity.current.selfBundleID
    public static let path = "/Applications/Codex Plus.app"
    public static func verifyRuntime(_ identity: ManagementProtocol.RuntimeIdentity) throws {
        let expression = try CodexPlusIdentity.current.selfRequirement()
        guard identity.pid > 0, identity.bundle_id == bundleID, identity.path == path,
              let app = NSRunningApplication(processIdentifier: identity.pid), !app.isTerminated,
              app.bundleIdentifier == bundleID, app.bundleURL?.path == path else { throw ManagementProtocol.failure("runtime_identity") }
        var code: SecCode?, requirement: SecRequirement?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String:identity.pid] as CFDictionary, [], &code) == errSecSuccess,
              SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
              let code, SecCodeCheckValidity(code, [], requirement) == errSecSuccess else { throw ManagementProtocol.failure("runtime_signature_identity") }
    }
}
