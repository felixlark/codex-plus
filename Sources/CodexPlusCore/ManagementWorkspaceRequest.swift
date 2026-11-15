import Foundation

/// Only correlates one management request with its originating runtime instance.
/// It carries no business task or execution state and never initiates an action.
public struct ManagementWorkspaceRequest: Equatable {
    public let requestID: UUID
    public let runtimeID: UUID
    public init(requestID: UUID, runtimeID: UUID) { self.requestID = requestID; self.runtimeID = runtimeID }
    public var reconciliationFields: [String: Any] {
        ["expected_runtime": runtimeID.uuidString, "query_request_id": requestID.uuidString]
    }
    public func observing(_ status: [String: Any], runtimeID: UUID) -> Self? {
        guard (self.runtimeID == runtimeID || ManagementProtocol.uuid(status["origin_runtime"]) == self.runtimeID),
              ManagementProtocol.uuid(status["request_id"]) == requestID,
              let phase = status["phase"] as? String else { return self }
        return ["ready", "failed", "closed"].contains(phase) ? nil : self
    }
    public static func recovering(_ status: [String: Any], runtimeID: UUID) -> Self? {
        guard let id = ManagementProtocol.uuid(status["request_id"]), let phase = status["phase"] as? String,
              !["ready", "failed", "closed"].contains(phase) else { return nil }
        return .init(requestID: id, runtimeID: ManagementProtocol.uuid(status["origin_runtime"]) ?? runtimeID)
    }
}
