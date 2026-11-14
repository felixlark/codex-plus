import Foundation
import Darwin
import CodexPlusCore

/// Command I/O stays off main; the router itself executes on main.
/// The original StatusServer remains read-only and unchanged.
final class ToolControlServer {
    private final class Connection {
        let id = UUID()
        let fd: Int32
        private let lock = NSLock()
        private var closed = false
        init(_ fd: Int32) { self.fd = fd }
        func cancel() {
            lock.lock(); defer { lock.unlock() }
            if !closed { _ = shutdown(fd, SHUT_RDWR) }
        }
        // Only the I/O owner closes, after both read and write have finished.
        func finish() {
            lock.lock(); defer { lock.unlock() }
            if !closed { closed = true; close(fd) }
        }
    }
    private var listener: DispatchSourceRead?
    private var descriptor: Int32 = -1
    private var clients: [UUID: Connection] = [:]
    private var epoch = UUID()

    func start(handle: @escaping ([String: Any]) -> [String: Any]) throws {
        let directory = URL(fileURLWithPath: ToolControlChannel.path).deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        unlink(ToolControlChannel.path)
        descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw ToolControlChannel.posixError() }
        do {
            guard try ToolControlChannel.withAddress({ Darwin.bind(descriptor, $0, $1) }) == 0,
                  chmod(ToolControlChannel.path, S_IRUSR | S_IWUSR) == 0,
                  fcntl(descriptor, F_SETFL, O_NONBLOCK) == 0,
                  listen(descriptor, SOMAXCONN) == 0 else { throw ToolControlChannel.posixError() }
            let source = DispatchSource.makeReadSource(fileDescriptor: descriptor, queue: .main)
            source.setEventHandler { [weak self] in
                guard let self else { return }
                let fd = accept(self.descriptor, nil, nil)
                guard fd >= 0 else { return }
                do { try ToolControlChannel.configureAcceptedSocket(fd) }
                catch { close(fd); return }
                let connection = Connection(fd)
                self.clients[connection.id] = connection
                let epoch = self.epoch
                DispatchQueue.global().async { [weak self] in
                    defer {
                        connection.finish()
                        DispatchQueue.main.async { [weak self] in self?.clients.removeValue(forKey: connection.id) }
                    }
                    guard let frame = try? ToolControlChannel.readFrame(from: fd),
                          let request = try? JSONSerialization.jsonObject(with: frame) as? [String: Any] else { return }
                    let response: [String: Any]? = DispatchQueue.main.sync {
                        guard let self, self.epoch == epoch, self.clients[connection.id] != nil else { return nil }
                        return handle(request)
                    }
                    guard let response, var data = try? JSONSerialization.data(withJSONObject: response) else { return }
                    data.append(0x0A)
                    try? ToolControlChannel.writeAll(data, to: fd)
                }
            }
            listener = source
            source.resume()
        } catch { stop(); throw error }
    }

    func stop() {
        epoch = UUID()
        listener?.cancel(); listener = nil
        clients.values.forEach { $0.cancel() }
        clients.removeAll()
        if descriptor >= 0 { close(descriptor); descriptor = -1; unlink(ToolControlChannel.path) }
    }
    deinit { stop() }
}
