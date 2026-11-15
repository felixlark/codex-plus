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
    var prepareStop: (() async throws -> [String: Any])?
    var resumeLifecycle: (() async throws -> Void)?
    var stopLifecycle: (() -> Void)?
    var verifyPreparedScope: (([String: Any]) async -> Bool)?
    private var lifecyclePhase = "running"
    private var preparedScope: [String: Any]?
    private var prepareRequestID: UUID?
    var allowsEffects: Bool { lifecyclePhase == "running" }

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
        ["status", "lifecycle.prepare-stop", "lifecycle.stop", "lifecycle.resume"] + (readSettings == nil ? [] : ["settings.read"]) +
        (writeSettings == nil ? [] : ["settings.write"])
    }
    func handle(_ object: [String: Any]) async -> ToolControlServer.Reply {
        let request: ManagementProtocol.Request
        do { request = try .parse(object) }
        catch {
            return .init(["ok": false, "protocol": ManagementProtocol.version,
                    "request_id": ManagementProtocol.uuid(object["request_id"])?.uuidString as Any? ?? NSNull(),
                    "runtime": (try? identity.object) ?? [:], "capabilities": capabilities, "error": "invalid_request"])
        }
        func reply(_ result: [String: Any]? = nil, error: String? = nil, afterWrite: (() -> Void)? = nil) -> ToolControlServer.Reply {
            .init((try? ManagementProtocol.response(request: request, runtime: identity, capabilities: capabilities, result: result, error: error)) ?? ["ok": false, "error": "response_unavailable"], afterWrite: afterWrite)
        }
        if let expected = request.expectedRuntime, expected != instance { return reply(error: "runtime_changed") }
        do {
            switch request.operation {
            case .status:
                var result = readStatus?() ?? [:]
                result["lifecycle"] = ["phase": lifecyclePhase, "prepare_request_id": prepareRequestID?.uuidString as Any? ?? NSNull(), "owned_scope": preparedScope as Any? ?? NSNull()]
                result["permissions"] = ["accessibility": ["trusted": AXIsProcessTrusted(), "bundle_id": identity.bundle_id,
                                                           "path": identity.path, "pid": identity.pid]]
                return reply(result)
            case .settingsRead:
                guard let readSettings else { return reply(error: "unsupported") }
                let settings = try readSettings()
                return reply(["settings": try settings.object, "settings_revision": try settings.revision])
            case .settingsWrite:
                guard allowsEffects else { return reply(error: "lifecycle_quiesced") }
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
            case .prepareStop:
                if lifecyclePhase == "prepared", let scope = preparedScope { return reply(scope) }
                guard lifecyclePhase == "running", let prepareStop else { return reply(error: "prepare_unknown") }
                prepareRequestID = request.id
                lifecyclePhase = "preparing"
                do { preparedScope = try await prepareStop(); lifecyclePhase = "prepared"; return reply(preparedScope) }
                catch { lifecyclePhase = "prepare_unknown"; return reply(error: "prepare_unknown") }
            case .stop:
                guard lifecyclePhase == "prepared", let scope = preparedScope,
                      scope["scope_revision"] as? String == request.expectedScope else { return reply(error: "scope_changed") }
                lifecyclePhase = "verifying_stop"
                guard await verifyPreparedScope?(scope) == true else { lifecyclePhase = "prepare_unknown"; return reply(error:"scope_changed") }
                lifecyclePhase = "stop_requested"
                return reply(["state": "stop_requested", "accepted_scope": scope], afterWrite: { [weak self] in
                    self?.lifecyclePhase = "stopping"
                    self?.stopLifecycle?()
                })
            case .resume:
                guard lifecyclePhase == "prepared", let resumeLifecycle else { return reply(error: "prepare_unknown") }
                lifecyclePhase = "resuming"
                do { try await resumeLifecycle() }
                catch { lifecyclePhase = "prepare_unknown"; return reply(error: "resume_unknown") }
                lifecyclePhase = "running"; preparedScope = nil; prepareRequestID = nil
                return reply(["state":"running"])
            }
        } catch { return reply(error: "settings_unavailable") }
    }
}
