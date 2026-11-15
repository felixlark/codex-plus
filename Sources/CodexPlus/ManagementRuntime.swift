import AppKit
import ApplicationServices
import CodexPlusCore

/// The existing signed native body owns effects; the management App is a client.
final class ManagementRuntime {
    private let instance = UUID()
    var readSettings: (() throws -> ManagementProtocol.Settings)?
    var writeSettings: ((ManagementProtocol.Settings) throws -> Void)?
    var readStatus: (() -> [String: Any])?
    var readComponents: (() -> [String: Any])?
    var openWorkbench: ((UUID) -> Bool)?
    var readWorkbench: ((UUID?) -> [String: Any]?)?

    private var identity: ManagementProtocol.RuntimeIdentity {
        let components = readComponents?() ?? [:]
        return .init(instanceID: instance, pid: ProcessInfo.processInfo.processIdentifier,
              bundleID: Bundle.main.bundleIdentifier ?? "unknown", path: Bundle.main.bundleURL.standardizedFileURL.path,
              version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
              build: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown",
              controllerProtocol: components["controller_protocol"] as? Int,
              controllerVersion: components["controller_version"] as? String,
              mobileProtocol: components["mobile_protocol"] as? Int,
              mobileVersion: components["mobile_version"] as? String)
    }
    private var capabilities: [String] {
        ["status"] + (readSettings == nil ? [] : ["settings.read"]) +
        (writeSettings == nil ? [] : ["settings.write"]) + (openWorkbench == nil ? [] : ["workspace.open"])
    }
    func handle(_ object: [String: Any]) -> [String: Any] {
        let request: ManagementProtocol.Request
        do { request = try .parse(object) }
        catch {
            return ["ok": false, "protocol": ManagementProtocol.version,
                    "request_id": ManagementProtocol.uuid(object["request_id"])?.uuidString as Any? ?? NSNull(),
                    "runtime": (try? identity.object) ?? [:], "capabilities": capabilities, "error": "invalid_request"]
        }
        func reply(_ result: [String: Any]? = nil, error: String? = nil) -> [String: Any] {
            (try? ManagementProtocol.response(request: request, runtime: identity, capabilities: capabilities, result: result, error: error)) ?? ["ok": false, "error": "response_unavailable"]
        }
        if let expected = request.expectedRuntime, expected != instance { return reply(error: "runtime_changed") }
        do {
            switch request.operation {
            case .status:
                var result = readStatus?() ?? [:]
                result["permissions"] = ["accessibility": ["trusted": AXIsProcessTrusted(), "bundle_id": identity.bundle_id,
                                                           "path": identity.path, "pid": identity.pid]]
                result["workspace_request"] = readWorkbench?(request.queryID) as Any? ?? NSNull()
                return reply(result)
            case .settingsRead:
                guard let readSettings else { return reply(error: "unsupported") }
                let settings = try readSettings()
                return reply(["settings": try settings.object, "settings_revision": try settings.revision])
            case .settingsWrite:
                guard let readSettings, let writeSettings else { return reply(error: "unsupported") }
                let current = try readSettings()
                guard try current.revision == request.expectedRevision else {
                    return reply(["settings": try current.object, "settings_revision": try current.revision], error: "conflict")
                }
                let next = try current.applying(request.changes ?? [:])
                if SuggestionAcceptance.isRequested, next.autoSendSuggestions != current.autoSendSuggestions {
                    return reply(error: "acceptance_scope")
                }
                try writeSettings(next)
                let actual = try readSettings()
                return reply(["settings": try actual.object, "settings_revision": try actual.revision])
            case .workspaceOpen:
                guard let openWorkbench else { return reply(error: "unsupported") }
                return openWorkbench(request.id) ? reply(["request_id": request.id.uuidString, "phase": "requested"]) : reply(error: "workspace_unavailable")
            }
        } catch { return reply(error: "settings_unavailable") }
    }
}
