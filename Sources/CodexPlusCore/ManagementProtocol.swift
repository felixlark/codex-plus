import Foundation
import CryptoKit
import CoreFoundation

/// Shared management data only. The native interactiond body owns all effects.
public enum ManagementProtocol {
    public static let version = 1
    public static let command = "management-v1"
    public static let runtimeBundleID = SmartShadowInstallation.helperBundleID
    public static let runtimePath = SmartShadowInstallation.helperPath
    public enum Operation: String { case status, settingsRead = "settings.read", settingsWrite = "settings.write", prepareStop = "lifecycle.prepare-stop", stop = "lifecycle.stop", resume = "lifecycle.resume", openCodex = "codex.open", reconnect = "enhancements.reconnect" }
    public enum Rejection: String { case unsupported, conflict }
    /// Only these protocol codes attest a pre-effect rejection. Arbitrary
    /// failures may follow an effect and must remain unknown to the client.
    public static func rejection(in response: [String: Any]) -> Rejection? {
        guard boolean(response["ok"]) == false, let code = response["error"] as? String else { return nil }
        return Rejection(rawValue: code)
    }
    public struct Request {
        public let id: UUID
        public let operation: Operation
        public let expectedRuntime: UUID?
        public let expectedRevision: String?
        public let changes: [String: Any]?
        public let expectedScope: String?
        public static func parse(_ value: [String: Any]) throws -> Self {
            let base: Set<String> = ["command", "protocol", "request_id", "operation"]
            guard value["command"] as? String == command, integer(value["protocol"]) == version,
                  let id = uuid(value["request_id"]), let op = (value["operation"] as? String).flatMap(Operation.init(rawValue:)) else { throw failure("invalid_request") }
            var allowed = base
            switch op {
            case .status: allowed.formUnion(["expected_runtime"])
            case .settingsRead: break
            case .settingsWrite: allowed.formUnion(["expected_runtime", "expected_settings_revision", "changes"])
            case .prepareStop, .resume, .openCodex, .reconnect: allowed.insert("expected_runtime")
            case .stop: allowed.formUnion(["expected_runtime", "expected_scope_revision"])
            }
            guard Set(value.keys).isSubset(of: allowed) else { throw failure("unexpected_field") }
            let runtime = uuid(value["expected_runtime"])
            if value["expected_runtime"] != nil && runtime == nil { throw failure("invalid_runtime") }
            if [.settingsWrite, .prepareStop, .stop, .resume, .openCodex, .reconnect].contains(op) { guard runtime != nil else { throw failure("runtime_required") } }
            let scope = value["expected_scope_revision"] as? String
            if op == .stop { guard let scope, isDigest(scope) else { throw failure("scope_required") } }
            let revision = value["expected_settings_revision"] as? String
            let changes = value["changes"] as? [String: Any]
            if op == .settingsWrite {
                guard let revision, isDigest(revision), let changes, !changes.isEmpty else { throw failure("settings_required") }
                try Settings.validateChanges(changes)
            }
            return Self(id: id, operation: op, expectedRuntime: runtime, expectedRevision: revision, changes: changes, expectedScope: scope)
        }
    }
    public struct RuntimeIdentity: Codable, Equatable {
        public let instance_id: UUID
        public let pid: Int32
        public let bundle_id: String
        public let path: String
        public let version: String
        public let build: String
        public let controller_protocol: Int?
        public let controller_version: String?
        public let mobile_protocol: Int?
        public let mobile_version: String?
        public init(instanceID: UUID, pid: Int32, bundleID: String, path: String, version: String, build: String,
                    controllerProtocol: Int? = nil, controllerVersion: String? = nil, mobileProtocol: Int? = nil, mobileVersion: String? = nil) {
            instance_id = instanceID; self.pid = pid; bundle_id = bundleID; self.path = path; self.version = version; self.build = build
            controller_protocol = controllerProtocol; controller_version = controllerVersion
            mobile_protocol = mobileProtocol; mobile_version = mobileVersion
        }
        public var object: [String: Any] { get throws {
            var result = try JSONSerialization.jsonObject(with: JSONEncoder().encode(self)) as! [String: Any]
            for key in ["controller_protocol", "controller_version", "mobile_protocol", "mobile_version"] where result[key] == nil { result[key] = NSNull() }
            return result
        } }
    }
    public static func response(request: Request, runtime: RuntimeIdentity, capabilities: [String], result: [String: Any]? = nil, error: String? = nil) throws -> [String: Any] {
        var object: [String: Any] = ["ok": error == nil, "protocol": version, "request_id": request.id.uuidString,
            "runtime": try runtime.object, "capabilities": capabilities]
        if let result { object["result"] = result }
        if let error { object["error"] = error }
        return object
    }
    public struct Settings: Codable, Equatable {
        public var workspaceAutoExpand: Bool
        public var autoSendSuggestions: Bool
        public var workspaceAutoExpandDisplaySelection: CodexWorkspaceDisplaySelection
        public var agentToolWindowsEnabled: Bool
        public var chromeUsesAgentDisplay: Bool
        public static let keys: Set<String> = ["workspaceAutoExpand", "autoSendSuggestions", "workspaceAutoExpandDisplaySelection", "agentToolWindowsEnabled", "chromeUsesAgentDisplay"]
        public init(workspaceAutoExpand: Bool, autoSendSuggestions: Bool, workspaceAutoExpandDisplaySelection: CodexWorkspaceDisplaySelection,
                    agentToolWindowsEnabled: Bool, chromeUsesAgentDisplay: Bool) {
            self.workspaceAutoExpand = workspaceAutoExpand; self.autoSendSuggestions = autoSendSuggestions
            self.workspaceAutoExpandDisplaySelection = workspaceAutoExpandDisplaySelection
            self.agentToolWindowsEnabled = agentToolWindowsEnabled; self.chromeUsesAgentDisplay = chromeUsesAgentDisplay
        }
        public var object: [String: Any] { get throws { try JSONSerialization.jsonObject(with: JSONEncoder().encode(self)) as! [String: Any] } }
        public var revision: String { get throws { try SHA256.hash(data: JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])).map { String(format: "%02x", $0) }.joined() } }
        public static func validateChanges(_ changes: [String: Any]) throws {
            guard Set(changes.keys).isSubset(of: keys) else { throw failure("unknown_setting") }
            for (key, value) in changes {
                if key == "workspaceAutoExpandDisplaySelection" {
                    guard let object = value as? [String: Any], Set(object.keys) == ["version", "mode", "hasCustomSelection", "selectedDisplays"],
                          integer(object["version"]) == 1, boolean(object["hasCustomSelection"]) != nil,
                          let rows = object["selectedDisplays"] as? [[String: Any]],
                          rows.allSatisfy({ Set($0.keys) == ["uuid", "lastKnownName"] && $0["lastKnownName"] is String }),
                          let raw = try? JSONSerialization.data(withJSONObject: object), CodexWorkspaceDisplaySelection.decode(raw) != nil else { throw failure("invalid_display_selection") }
                } else { guard boolean(value) != nil else { throw failure("invalid_setting_type") } }
            }
        }
        public func applying(_ changes: [String: Any]) throws -> Settings {
            try Self.validateChanges(changes)
            var value = try object
            for (key, change) in changes { value[key] = change }
            return try JSONDecoder().decode(Settings.self, from: JSONSerialization.data(withJSONObject: value))
        }
    }
    public static func boolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }; return number.boolValue
    }
    public static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite,
              number.doubleValue == Double(number.intValue) else { return nil }; return number.intValue
    }
    public static func uuid(_ value: Any?) -> UUID? { (value as? String).flatMap(UUID.init(uuidString:)) }
    public static func isDigest(_ value: String) -> Bool { value.count == 64 && value.allSatisfy { "0123456789abcdef".contains($0) } }
    public static func failure(_ code: String) -> NSError { NSError(domain: "SmartShadow.Management", code: 1, userInfo: [NSLocalizedDescriptionKey: code]) }
}
