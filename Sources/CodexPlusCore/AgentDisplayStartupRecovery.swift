import Foundation

/// One login recovery, with one in-flight proxy even across pause/resume.
public struct AgentDisplayStartupRecovery {
    public enum Phase: String { case waiting, recovering, ready, paused }
    public struct Attempt: Equatable { let id: UUID; let generation: UInt64 }
    private var generation: UInt64 = 0
    private var retryAt: TimeInterval = 0
    public private(set) var phase: Phase = .waiting
    public private(set) var inFlight: Attempt?
    public private(set) var lastError: String?
    public var isReady: Bool { phase == .ready }
    public init() {}

    public mutating func request(enabled: Bool) {
        generation &+= 1
        phase = enabled ? .waiting : .paused
        retryAt = 0; lastError = nil
        // An old proxy still owns its one slot until its bounded completion.
    }
    public mutating func begin(now: TimeInterval, configured: Bool) -> Attempt? {
        guard phase == .waiting, configured, inFlight == nil, now >= retryAt else { return nil }
        let attempt = Attempt(id: UUID(), generation: generation)
        inFlight = attempt; phase = .recovering
        return attempt
    }
    @discardableResult public mutating func complete(_ attempt: Attempt, now: TimeInterval, ready: Bool, error: String?, retryInterval: TimeInterval) -> Bool {
        guard inFlight == attempt else { return false }
        inFlight = nil
        guard attempt.generation == generation else { return false }
        phase = ready ? .ready : .waiting
        lastError = ready ? nil : error
        retryAt = now + retryInterval
        return ready
    }
}

public enum OCUStartupProtocol {
    public static func environment(from base: [String: String], configurationPath: String) -> [String: String] {
        var result = base
        result["OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE"] = "persistent-display"
        result["OPEN_COMPUTER_USE_CONFIG_FILE"] = configurationPath
        result["OPEN_COMPUTER_USE_ACTION_READ_BACK"] = "0"
        result["OPEN_COMPUTER_USE_VISUAL_CURSOR"] = "0"
        result.removeValue(forKey: "OPEN_COMPUTER_USE_VIRTUAL_DISPLAY_ENABLED")
        result.removeValue(forKey: "OPEN_COMPUTER_USE_VIRTUAL_DISPLAY_RESTORE_ON_SESSION_END")
        return result
    }
    public static func readyDisplayID(_ result: [String: Any]) -> UInt32? {
        guard result["isError"] as? Bool == false,
              let content = result["content"] as? [[String: Any]],
              let text = content.first(where: { $0["type"] as? String == "text" })?["text"] as? String,
              let receipt = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any],
              let version = receipt["protocol"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 2,
              receipt["geometry"] as? String == "fit_restore_v1",
              let persistent = receipt["persistent"] as? NSNumber, CFGetTypeID(persistent) == CFBooleanGetTypeID(), persistent.boolValue,
              receipt["namespace"] as? String == "persistent-display",
              let id = receipt["display_id"] as? NSNumber, CFGetTypeID(id) != CFBooleanGetTypeID(),
              id.doubleValue.rounded() == id.doubleValue, id.doubleValue > 0, id.doubleValue <= Double(UInt32.max) else { return nil }
        return UInt32(id.doubleValue)
    }
}
