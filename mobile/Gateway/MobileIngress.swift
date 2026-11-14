import Foundation
import Network
import Darwin

// Fixed in-process TLS ingress. Original peer identity is claimed once before TLS.
final class MobileIngress {
    struct Claim { let id: UUID; let peer: String; let active: Bool }
    final class Pair {
        let id = UUID(), outer: Int32, inner: Int32, sourcePort: UInt16, peer: String
        var active = true, claimed = false, cancelled = false, remaining = 2
        var connection: NWConnection?
        init(_ outer: Int32, _ inner: Int32, _ sourcePort: UInt16, _ peer: String) { self.outer = outer; self.inner = inner; self.sourcePort = sourcePort; self.peer = peer }
    }
    let queue: DispatchQueue, generation = UUID(), internalPort: UInt16
    private var listener: Int32 = -1, pairs = [UUID: Pair](), ports = [UInt16: UUID](), stopped = false
    private(set) var port: UInt16 = 0
    init(address: String, internalPort: UInt16, queue: DispatchQueue) throws {
        self.internalPort = internalPort; self.queue = queue
        listener = socket(AF_INET, SOCK_STREAM, 0)
        guard listener >= 0 else { throw POSIXError(.EIO) }
        var yes: Int32 = 1; setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var local = Self.address(address, 0)
        let result = withUnsafePointer(to: &local) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        // SOMAXCONN is the Darwin kernel listen backlog, not an application quota.
        guard result == 0, Darwin.listen(listener, SOMAXCONN) == 0 else { Darwin.close(listener); throw POSIXError(.EADDRNOTAVAIL) }
        var size = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &local) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { _ = getsockname(listener, $0, &size) } }
        port = UInt16(bigEndian: local.sin_port)
        DispatchQueue.global().async { [self] in acceptLoop() }
    }
    static func address(_ ip: String, _ port: UInt16) -> sockaddr_in {
        var a = sockaddr_in(); a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); a.sin_family = sa_family_t(AF_INET); a.sin_port = port.bigEndian
        _ = ip.withCString { inet_pton(AF_INET, $0, &a.sin_addr) }; return a
    }
    static func isTail(_ ip: String) -> Bool {
        mobileIPv4(ip) != nil
    }
    private func acceptLoop() {
        while true {
            var peer = sockaddr_in(), length = socklen_t(MemoryLayout<sockaddr_in>.size)
            let outer = withUnsafeMutablePointer(to: &peer) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.accept(listener, $0, &length) } }
            guard outer >= 0 else { return }
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            _ = inet_ntop(AF_INET, &peer.sin_addr, &buffer, socklen_t(buffer.count))
            let ip = String(cString: buffer)
            guard Self.isTail(ip) else { Darwin.close(outer); continue }
            let inner = socket(AF_INET, SOCK_STREAM, 0)
            guard inner >= 0 else { Darwin.close(outer); continue }
            for fd in [outer, inner] { var yes: Int32 = 1; setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size)) }
            var source = Self.address("127.0.0.1", 0)
            let bound = withUnsafePointer(to: &source) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(inner, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
            guard bound == 0 else { Darwin.close(outer); Darwin.close(inner); continue }
            length = socklen_t(MemoryLayout<sockaddr_in>.size)
            withUnsafeMutablePointer(to: &source) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { _ = getsockname(inner, $0, &length) } }
            let pair = Pair(outer, inner, UInt16(bigEndian: source.sin_port), ip)
            let registered = queue.sync { () -> Bool in guard !stopped, ports[pair.sourcePort] == nil else { return false }; pairs[pair.id] = pair; ports[pair.sourcePort] = pair.id; return true }
            guard registered else { Darwin.close(outer); Darwin.close(inner); continue }
            var target = Self.address("127.0.0.1", internalPort)
            let connected = withUnsafePointer(to: &target) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(inner, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
            if connected != 0 { queue.async { pair.remaining = 0; self.revoke(pair) }; continue }
            DispatchQueue.global().async { self.pump(pair, from: outer, to: inner) }
            DispatchQueue.global().async { self.pump(pair, from: inner, to: outer) }
        }
    }
    private func pump(_ pair: Pair, from: Int32, to: Int32) {
        var buffer = [UInt8](repeating: 0, count: 65536)
        transfer: while true {
            let count = Darwin.read(from, &buffer, buffer.count)
            if count <= 0 { break }
            var sent = 0
            while sent < count {
                let n = buffer.withUnsafeBytes { Darwin.write(to, $0.baseAddress!.advanced(by: sent), count - sent) }
                if n <= 0 { break transfer }; sent += n
            }
        }
        queue.async { pair.remaining -= 1; self.revoke(pair); self.freeIfSafe(pair) }
    }
    // Called from exactly this generation's internal listener before TLS starts.
    func claim(_ connection: NWConnection, generation: UUID) -> Claim? {
        guard generation == self.generation, !stopped, case .hostPort(let host, let port) = connection.endpoint,
              host == .ipv4(IPv4Address("127.0.0.1")!), let id = ports[port.rawValue], let pair = pairs[id], !pair.claimed else { return nil }
        pair.claimed = true; pair.connection = connection
        return Claim(id: pair.id, peer: pair.peer, active: pair.active)
    }
    func active(_ id: UUID, connection: NWConnection) -> Bool { guard let pair = pairs[id] else { return false }; return pair.active && pair.connection === connection }
    func cancelled(_ id: UUID, connection: NWConnection) {
        guard let pair = pairs[id], pair.connection === connection else { return }
        pair.cancelled = true; pair.connection = nil; revoke(pair); freeIfSafe(pair)
    }
    private func revoke(_ pair: Pair) {
        pair.active = false; shutdown(pair.outer, SHUT_RDWR); shutdown(pair.inner, SHUT_RDWR); pair.connection?.cancel()
    }
    private func freeIfSafe(_ pair: Pair) {
        // Unclaimed inactive records keep their exclusively bound FD until accept
        // plus cancellation, or entire generation retirement; no tuple reuse gap.
        guard pair.remaining == 0, pair.cancelled || stopped else { return }
        guard pairs.removeValue(forKey: pair.id) != nil else { return }
        if ports[pair.sourcePort] == pair.id { ports.removeValue(forKey: pair.sourcePort) }
        Darwin.close(pair.outer); Darwin.close(pair.inner)
    }
    func stop() {
        guard !stopped else { return }; stopped = true
        shutdown(listener, SHUT_RDWR); Darwin.close(listener); listener = -1
        for pair in Array(pairs.values) { revoke(pair); freeIfSafe(pair) }
    }
    func inspect() -> [String: Int] { ["pairs": pairs.count, "pending": pairs.values.filter { !$0.claimed }.count] }
}
