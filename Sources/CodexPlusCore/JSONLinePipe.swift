import Foundation
import Darwin

/// One reader owns one newline-delimited pipe. A short response must return
/// while the writer is still alive and waiting for the next request.
public final class JSONLinePipeReader {
    private let input: FileHandle
    private var buffer = Data()
    public init(input: FileHandle) { self.input = input }

    public func response(matchingID id: Int, deadline: DispatchTime? = nil) -> [String: Any]? {
        while true {
            while let newline = buffer.firstIndex(of: 10) {
                let line = buffer.prefix(upTo: newline)
                buffer.removeSubrange(...newline)
                if let object = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any], object["id"] as? Int == id { return object }
            }
            if let deadline {
                let now = DispatchTime.now().uptimeNanoseconds
                guard now < deadline.uptimeNanoseconds else { return nil }
                let milliseconds = min(UInt64(Int32.max), (deadline.uptimeNanoseconds - now + 999_999) / 1_000_000)
                var descriptor = pollfd(fd: input.fileDescriptor, events: Int16(POLLIN | POLLHUP), revents: 0)
                let ready = Darwin.poll(&descriptor, 1, Int32(milliseconds))
                if ready < 0 && errno == EINTR { continue }
                guard ready > 0 else { return nil }
            }
            var bytes = [UInt8](repeating: 0, count: 4096)
            let count = bytes.withUnsafeMutableBytes { Darwin.read(input.fileDescriptor, $0.baseAddress, $0.count) }
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { return nil }
            buffer.append(contentsOf: bytes.prefix(count))
        }
    }
}

public enum JSONLinePipeWriter {
    /// Scope broken-pipe protection to this descriptor, not the whole app.
    public static func write(_ object: [String: Any], to output: FileHandle) -> Bool {
        guard fcntl(output.fileDescriptor, F_SETNOSIGPIPE, 1) == 0,
              var bytes = try? JSONSerialization.data(withJSONObject: object) else { return false }
        bytes.append(10)
        do { try output.write(contentsOf: bytes); return true } catch { return false }
    }
}
