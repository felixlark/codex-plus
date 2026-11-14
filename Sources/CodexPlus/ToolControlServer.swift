import Foundation
import Darwin
import CodexPlusCore

/// Command I/O stays off main; the router itself executes on main.
/// The original StatusServer remains read-only and unchanged.
final class ToolControlServer {
    private var listener: DispatchSourceRead?
    private var descriptor: Int32 = -1
    private var clients = Set<Int32>()
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
                let client = accept(self.descriptor, nil, nil)
                guard client >= 0 else { return }
                do { try ToolControlChannel.configureAcceptedSocket(client) }
                catch { close(client); return }
                self.clients.insert(client)
                let epoch = self.epoch
                DispatchQueue.global().async {
                    let frame = try? ToolControlChannel.readFrame(from: client)
                    let request = frame.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                    DispatchQueue.main.async { [weak self = self] in
                        guard let self, self.epoch == epoch, self.clients.remove(client) != nil else { return }
                        guard let request else { close(client); return }
                        let response = handle(request)
                        DispatchQueue.global().async {
                            defer { close(client) }
                            guard var data = try? JSONSerialization.data(withJSONObject: response) else { return }
                            data.append(0x0A)
                            try? ToolControlChannel.writeAll(data, to: client)
                        }
                    }
                }
            }
            listener = source
            source.resume()
        } catch { stop(); throw error }
    }

    func stop() {
        epoch = UUID()
        listener?.cancel(); listener = nil
        for fd in clients { _ = shutdown(fd, SHUT_RDWR); close(fd) }
        clients.removeAll()
        if descriptor >= 0 { close(descriptor); descriptor = -1; unlink(ToolControlChannel.path) }
    }
    deinit { stop() }
}
