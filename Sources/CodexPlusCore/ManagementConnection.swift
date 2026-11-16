import Foundation
import Darwin

/// A cancellable client connection. Cancellation shuts down only this request's
/// socket; the worker retains close ownership so a reused descriptor is never hit.
public final class ManagementConnection: @unchecked Sendable {
    private let lock = NSLock()
    private var descriptor: Int32 = -1
    private var cancelled = false
    private let socketPath: String
    private let timeout: TimeInterval?
    private let verifyPeer: ((Int32) throws -> Void)?
    public init(path: String = ToolControlChannel.path, timeout: TimeInterval? = nil, verifyPeer: ((Int32) throws -> Void)? = nil) {
        socketPath = path; self.timeout = timeout; self.verifyPeer = verifyPeer
    }
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
        let deadline = timeout.map { ProcessInfo.processInfo.systemUptime + $0 }
        try validateSocket()
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw ToolControlChannel.posixError() }
        lock.lock()
        if cancelled { lock.unlock(); close(fd); throw CancellationError() }
        descriptor = fd; lock.unlock()
        defer {
            lock.lock(); descriptor = -1; close(fd); lock.unlock()
        }
        let flags = fcntl(fd, F_GETFL)
        guard flags >= 0, fcntl(fd, F_SETFL, flags | O_NONBLOCK) == 0 else { throw ToolControlChannel.posixError() }
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(socketPath.utf8CString)
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw ToolControlChannel.posixError() }
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes.map { UInt8(bitPattern: $0) }) }
        let connected = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        if connected != 0 {
            guard errno == EINPROGRESS else { throw ToolControlChannel.posixError() }
            try wait(fd, for: Int16(POLLOUT), until: deadline)
            var error: Int32 = 0, size = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) == 0, error == 0 else { throw ToolControlChannel.posixError(error) }
        }
        var uid: uid_t = 0, gid: gid_t = 0
        guard getpeereid(fd, &uid, &gid) == 0, uid == getuid() else { throw ManagementProtocol.failure("peer_identity") }
        var peerPID: Int32 = 0
        if let verifyPeer {
            var length = socklen_t(MemoryLayout<Int32>.size)
            guard getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &peerPID, &length) == 0, peerPID > 0 else { throw ManagementProtocol.failure("peer_process_unavailable") }
            try verifyPeer(peerPID)
        }
        lock.lock(); let wasCancelled = cancelled; lock.unlock()
        if wasCancelled { throw CancellationError() }
        try validateSocket()
        ToolControlChannel.suppressSIGPIPE(fd)
        var raw = try JSONSerialization.data(withJSONObject: value); raw.append(0x0A)
        try raw.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                try wait(fd, for: Int16(POLLOUT), until: deadline)
                let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 && [EINTR, EAGAIN].contains(errno) { continue }
                guard count > 0 else { throw ToolControlChannel.posixError() }; offset += count
            }
        }
        _ = shutdown(fd, SHUT_WR)
        var frame = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while frame.firstIndex(of: 0x0A) == nil {
            try wait(fd, for: Int16(POLLIN), until: deadline)
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count < 0 && [EINTR, EAGAIN].contains(errno) { continue }
            guard count > 0 else { throw ToolControlChannel.posixError(count == 0 ? ECONNRESET : errno) }
            frame.append(contentsOf: buffer.prefix(count))
        }
        frame = Data(frame[..<frame.firstIndex(of: 0x0A)!])
        try check(deadline)
        guard let object = try JSONSerialization.jsonObject(with: frame) as? [String: Any],
              ManagementProtocol.integer(object["protocol"]) == ManagementProtocol.version,
              object["request_id"] as? String == value["request_id"] as? String,
              ManagementProtocol.boolean(object["ok"]) != nil else { throw ManagementProtocol.failure("incompatible_response_result_unknown") }
        if verifyPeer != nil {
            guard let runtime = object["runtime"] as? [String: Any], ManagementProtocol.integer(runtime["pid"]) == Int(peerPID) else { throw ManagementProtocol.failure("peer_process_changed") }
        }
        try check(deadline)
        return object
    }
    private func check(_ deadline: TimeInterval?) throws {
        lock.lock(); let stopped = cancelled; lock.unlock()
        if stopped { throw CancellationError() }
        if let deadline, ProcessInfo.processInfo.systemUptime >= deadline { throw ManagementProtocol.failure("management_request_timed_out") }
    }
    private func wait(_ fd: Int32, for events: Int16, until deadline: TimeInterval?) throws {
        while true {
            try check(deadline)
            let milliseconds = deadline.map { Int32(min(Double(Int32.max), max(1, ceil(($0 - ProcessInfo.processInfo.systemUptime) * 1000)))) } ?? -1
            var item = pollfd(fd: fd, events: events, revents: 0)
            let result = poll(&item, 1, milliseconds)
            if result < 0 && errno == EINTR { continue }
            try check(deadline)
            guard result > 0 else { throw ToolControlChannel.posixError(result == 0 ? ETIMEDOUT : errno) }
            return
        }
    }
    private func validateSocket() throws {
        let path = socketPath, parent = (path as NSString).deletingLastPathComponent
        var p = stat(), s = stat()
        guard lstat(parent, &p) == 0, p.st_mode & S_IFMT == S_IFDIR, p.st_uid == getuid(), p.st_mode & 0o022 == 0,
              URL(fileURLWithPath: parent).resolvingSymlinksInPath().path == parent,
              lstat(path, &s) == 0, s.st_mode & S_IFMT == S_IFSOCK, s.st_uid == getuid(), s.st_mode & 0o777 == 0o600 else {
            throw ManagementProtocol.failure("management_socket_unavailable_or_identity_changed")
        }
    }
}
