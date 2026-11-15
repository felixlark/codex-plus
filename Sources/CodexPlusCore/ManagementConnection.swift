import Foundation
import Darwin

/// A cancellable client connection. Cancellation shuts down only this request's
/// socket; the worker retains close ownership so a reused descriptor is never hit.
public final class ManagementConnection: @unchecked Sendable {
    private let lock = NSLock()
    private var descriptor: Int32 = -1
    private var cancelled = false
    public init() {}
    public func cancel() {
        lock.lock(); defer { lock.unlock() }
        cancelled = true
        if descriptor >= 0 { _ = shutdown(descriptor, SHUT_RDWR) }
    }
    public func request(_ value: [String: Any]) async throws -> [String: Any] {
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                DispatchQueue.global(qos: .userInitiated).async {
                    do { continuation.resume(returning: try self.perform(value)) }
                    catch { continuation.resume(throwing: error) }
                }
            }
        }, onCancel: { self.cancel() })
    }
    private func perform(_ value: [String: Any]) throws -> [String: Any] {
        lock.lock(); let initiallyCancelled = cancelled; lock.unlock()
        if initiallyCancelled { throw CancellationError() }
        try Self.validateSocket()
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw ToolControlChannel.posixError() }
        lock.lock()
        if cancelled { lock.unlock(); close(fd); throw CancellationError() }
        descriptor = fd; lock.unlock()
        defer {
            lock.lock(); descriptor = -1; close(fd); lock.unlock()
        }
        guard try ToolControlChannel.withAddress({ connect(fd, $0, $1) }) == 0 else { throw ToolControlChannel.posixError() }
        var uid: uid_t = 0, gid: gid_t = 0
        guard getpeereid(fd, &uid, &gid) == 0, uid == getuid() else { throw ManagementProtocol.failure("peer_identity") }
        lock.lock(); let wasCancelled = cancelled; lock.unlock()
        if wasCancelled { throw CancellationError() }
        try Self.validateSocket()
        ToolControlChannel.suppressSIGPIPE(fd)
        var raw = try JSONSerialization.data(withJSONObject: value); raw.append(0x0A)
        try ToolControlChannel.writeAll(raw, to: fd); _ = shutdown(fd, SHUT_WR)
        let frame = try ToolControlChannel.readFrame(from: fd)
        guard let object = try JSONSerialization.jsonObject(with: frame) as? [String: Any],
              ManagementProtocol.integer(object["protocol"]) == ManagementProtocol.version,
              object["request_id"] as? String == value["request_id"] as? String,
              ManagementProtocol.boolean(object["ok"]) != nil else { throw ManagementProtocol.failure("incompatible_response_result_unknown") }
        return object
    }
    private static func validateSocket() throws {
        let path = ToolControlChannel.path, parent = (path as NSString).deletingLastPathComponent
        var p = stat(), s = stat()
        guard lstat(parent, &p) == 0, p.st_mode & S_IFMT == S_IFDIR, p.st_uid == getuid(), p.st_mode & 0o022 == 0,
              URL(fileURLWithPath: parent).resolvingSymlinksInPath().path == parent,
              lstat(path, &s) == 0, s.st_mode & S_IFMT == S_IFSOCK, s.st_uid == getuid(), s.st_mode & 0o777 == 0o600 else {
            throw ManagementProtocol.failure("management_socket_unavailable_or_identity_changed")
        }
    }
}
