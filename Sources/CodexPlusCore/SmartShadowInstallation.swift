import AppKit
import Security

/// One installed container, with a separately signed, independently lived runtime.
public enum SmartShadowInstallation {
    public static let containerBundleID = "me.longbiaochen.smart-shadow.app"
    public static let containerPath = "/Applications/SmartShadow.app"
    public static let helperBundleID = "me.longbiaochen.smart-shadow.interactiond"
    public static let helperRelativePath = "Contents/Library/LoginItems/SmartShadowInteraction.app"
    public static let helperPath = containerPath + "/" + helperRelativePath
    public static let helperExecutablePath = helperPath + "/Contents/MacOS/SmartShadowInteraction"
    public static let legacyBundleID = "me.longbiaochen.codex-plus"

    public static func requirement(bundleID: String) -> String {
        "anchor apple generic and identifier \"\(bundleID)\" and certificate leaf[subject.OU] = \"HJG65XBC25\""
    }
    public static func verifyBundle(path: String, bundleID: String) throws {
        var code: SecStaticCode?, requirement: SecRequirement?
        guard SecStaticCodeCreateWithPath(URL(fileURLWithPath: path) as CFURL, [], &code) == errSecSuccess,
              SecRequirementCreateWithString(Self.requirement(bundleID: bundleID) as CFString, [], &requirement) == errSecSuccess,
              let code, SecStaticCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSCheckNestedCode | kSecCSStrictValidate), requirement) == errSecSuccess else {
            throw ManagementProtocol.failure("installed_signature_identity")
        }
    }
    public static func verifyRuntime(_ identity: ManagementProtocol.RuntimeIdentity) throws {
        guard identity.pid > 0, identity.bundle_id == helperBundleID, identity.path == helperPath,
              let app = NSRunningApplication(processIdentifier: identity.pid), !app.isTerminated,
              app.bundleIdentifier == helperBundleID, app.bundleURL?.standardizedFileURL.path == helperPath,
              app.executableURL?.standardizedFileURL.path == helperExecutablePath else {
            throw ManagementProtocol.failure("runtime_process_identity")
        }
        try verifyBundle(path: containerPath, bundleID: containerBundleID)
        try verifyBundle(path: helperPath, bundleID: helperBundleID)
        var code: SecCode?, requirement: SecRequirement?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String: identity.pid] as CFDictionary, [], &code) == errSecSuccess,
              SecRequirementCreateWithString(Self.requirement(bundleID: helperBundleID) as CFString, [], &requirement) == errSecSuccess,
              let code, SecCodeCheckValidity(code, [], requirement) == errSecSuccess else {
            throw ManagementProtocol.failure("runtime_signature_identity")
        }
    }
}
