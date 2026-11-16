import AppKit
import Security
public enum CodexPlusInstallation {
    public static let bundleID = "me.longbiaochen.codex-plus"
    public static let path = "/Applications/Codex Plus.app"
    public static func verifyRuntime(_ identity: ManagementProtocol.RuntimeIdentity) throws {
        guard identity.pid > 0, identity.bundle_id == bundleID, identity.path == path,
              let app = NSRunningApplication(processIdentifier: identity.pid), !app.isTerminated,
              app.bundleIdentifier == bundleID, app.bundleURL?.path == path else { throw ManagementProtocol.failure("runtime_identity") }
        var code: SecCode?, requirement: SecRequirement?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String:identity.pid] as CFDictionary, [], &code) == errSecSuccess,
              SecRequirementCreateWithString("anchor apple generic and identifier \"me.longbiaochen.codex-plus\" and certificate leaf[subject.OU] = \"HJG65XBC25\"" as CFString, [], &requirement) == errSecSuccess,
              let code, SecCodeCheckValidity(code, [], requirement) == errSecSuccess else { throw ManagementProtocol.failure("runtime_signature_identity") }
    }
}
