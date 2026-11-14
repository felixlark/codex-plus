import Foundation
import Darwin

public enum ToolCommand {
    public static func windowIdentity(pid: Int, windowID: Int) -> (pid: Int32, windowID: UInt32)? {
        guard pid > 0, windowID > 0, let process = Int32(exactly: pid), let window = UInt32(exactly: windowID) else { return nil }
        return (process, window)
    }
    public static func parse(_ arguments: [String]) throws -> [String: Any]? {
        guard let first = arguments.first, first.hasPrefix("--tool-") else { return nil }
        let command = String(first.dropFirst(2))
        let allowed: [String: Set<String>] = [
            "tool-open": ["--app-path", "--url", "--dedicated"],
            "tool-place": ["--pid", "--window-id"], "tool-routing": ["--enabled"],
            "tool-status": [], "tool-exempt": [], "tool-recover": []
        ]
        guard let options = allowed[command] else { throw failure("Unknown tool command") }
        var values: [String: String] = [:]
        var dedicated = false
        var index = 1
        while index < arguments.count {
            let name = arguments[index]
            guard options.contains(name), values[name] == nil else { throw failure("Unexpected or duplicate option: \(name)") }
            if name == "--dedicated" { guard !dedicated else { throw failure("Duplicate --dedicated") }; dedicated = true; index += 1; continue }
            guard index + 1 < arguments.count else { throw failure("Missing value for \(name)") }
            values[name] = arguments[index + 1]; index += 2
        }
        var request: [String: Any] = ["command": command]
        switch command {
        case "tool-open":
            guard let path = values["--app-path"], path.hasPrefix("/"), path.hasSuffix(".app") else { throw failure("--app-path requires an absolute app bundle path") }
            request["appPath"] = path; request["dedicated"] = dedicated
            if let raw = values["--url"] {
                guard let url = URL(string: raw), ["file", "http", "https"].contains(url.scheme ?? "") else { throw failure("--url requires file/http/https") }
                request["url"] = raw
            }
        case "tool-place":
            guard let pid = values["--pid"].flatMap(Int.init), pid > 0, pid <= Int(Int32.max),
                  let id = values["--window-id"].flatMap(UInt32.init), id > 0 else { throw failure("--pid and --window-id are required") }
            request["pid"] = pid; request["windowID"] = Int(id)
        case "tool-routing":
            guard let flag = values["--enabled"], ["true", "false"].contains(flag) else { throw failure("--enabled requires true or false") }
            request["enabled"] = flag == "true"
        default: break
        }
        return request
    }

    private static func failure(_ message: String) -> NSError {
        NSError(domain: "CodexPlus.ToolCommand", code: 2, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

/// One JSON line per connection; deliberately no launch/reopen/retry fallback.
public enum ToolControlChannel {
    public static let path = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/codex-plus/tool-control.sock").path

    public static func withAddress<T>(_ operation: (UnsafePointer<sockaddr>, socklen_t) -> T) throws -> T {
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8CString)
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw posixError(ENAMETOOLONG) }
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes.map { UInt8(bitPattern: $0) }) }
        return withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { operation($0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
    }

    public static func configureAcceptedSocket(_ fd: Int32) throws {
        let flags = fcntl(fd, F_GETFL)
        guard flags >= 0, fcntl(fd, F_SETFL, flags & ~O_NONBLOCK) == 0 else { throw posixError() }
        suppressSIGPIPE(fd)
    }

    public static func request(_ command: [String: Any]) throws -> Data {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw posixError() }
        defer { close(fd) }
        guard try withAddress({ connect(fd, $0, $1) }) == 0 else { throw posixError() }
        suppressSIGPIPE(fd)
        var data = try JSONSerialization.data(withJSONObject: command)
        data.append(0x0A)
        do {
            try writeAll(data, to: fd)
            _ = shutdown(fd, SHUT_WR)
            var response = try readFrame(from: fd)
            response.append(0x0A)
            return response
        } catch {
            throw NSError(domain: "CodexPlus.ToolControl", code: 1, userInfo: [NSLocalizedDescriptionKey: "Tool request result unknown; inspect --tool-status before retrying. \(error.localizedDescription)"])
        }
    }

    public static func readFrame(from fd: Int32) throws -> Data {
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = read(fd, &buffer, buffer.count)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { throw posixError(count == 0 ? ECONNRESET : errno) }
            data.append(contentsOf: buffer.prefix(count))
            if let end = data.firstIndex(of: 0x0A) { return Data(data[..<end]) }
        }
    }

    public static func writeAll(_ data: Data, to fd: Int32) throws {
        try data.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { throw posixError() }
                offset += count
            }
        }
    }

    public static func suppressSIGPIPE(_ fd: Int32) {
        var flag: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &flag, socklen_t(MemoryLayout<Int32>.size))
    }
    public static func posixError(_ code: Int32 = errno) -> NSError { NSError(domain: NSPOSIXErrorDomain, code: Int(code)) }
}
