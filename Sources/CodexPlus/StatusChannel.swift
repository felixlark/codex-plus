import Darwin
import Foundation

enum StatusChannel {
    static let path = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("codex-plus/status.sock").path

    static func address() throws -> sockaddr_un {
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8CString)
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(ENAMETOOLONG))
        }
        withUnsafeMutableBytes(of: &address.sun_path) { target in
            target.copyBytes(from: bytes.map { UInt8(bitPattern: $0) })
        }
        return address
    }

    static func withAddress<T>(_ operation: (UnsafePointer<sockaddr>, socklen_t) -> T) throws -> T {
        var address = try address()
        return withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                operation($0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
    }

    static func readStatus() throws -> Data {
        let socketFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard socketFD >= 0 else { throw posixError() }
        defer { close(socketFD) }
        guard try withAddress({ connect(socketFD, $0, $1) }) == 0 else { throw posixError() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = read(socketFD, &buffer, buffer.count)
            if count == 0 { return data }
            if count < 0 {
                if errno == EINTR { continue }
                throw posixError()
            }
            data.append(contentsOf: buffer.prefix(count))
        }
    }

    static func posixError() -> NSError {
        NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }
}

/// A read-only, user-owned endpoint. Connecting returns current metadata on the
/// app's main queue. The endpoint accepts no commands or payloads.
final class StatusServer {
    private var source: DispatchSourceRead?
    private var descriptor: Int32 = -1

    func start(snapshot: @escaping () -> [String: Any]) throws {
        let directory = URL(fileURLWithPath: StatusChannel.path).deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        unlink(StatusChannel.path)
        descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw StatusChannel.posixError() }
        do {
            guard try StatusChannel.withAddress({ Darwin.bind(descriptor, $0, $1) }) == 0 else {
                throw StatusChannel.posixError()
            }
            guard chmod(StatusChannel.path, S_IRUSR | S_IWUSR) == 0,
                  fcntl(descriptor, F_SETFL, O_NONBLOCK) == 0,
                  // Use the macOS socket backlog bound, not an application resource cap.
                  listen(descriptor, SOMAXCONN) == 0 else {
                throw StatusChannel.posixError()
            }
            let listener = DispatchSource.makeReadSource(fileDescriptor: descriptor, queue: .main)
            listener.setEventHandler { [weak self] in
                guard let self else { return }
                let client = accept(self.descriptor, nil, nil)
                guard client >= 0 else { return }
                defer { close(client) }
                var noSignal: Int32 = 1
                _ = setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noSignal,
                               socklen_t(MemoryLayout<Int32>.size))
                guard var data = try? JSONSerialization.data(withJSONObject: snapshot(),
                                                             options: [.prettyPrinted, .sortedKeys]) else { return }
                data.append(0x0A)
                data.withUnsafeBytes { bytes in
                    var offset = 0
                    while offset < bytes.count {
                        let written = write(client, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                        if written < 0 && errno == EINTR { continue }
                        guard written > 0 else { return }
                        offset += written
                    }
                }
            }
            listener.resume()
            source = listener
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        source?.cancel()
        source = nil
        if descriptor >= 0 {
            close(descriptor)
            descriptor = -1
            unlink(StatusChannel.path)
        }
    }

    deinit { stop() }
}
