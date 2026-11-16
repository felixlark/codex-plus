import XCTest
import Darwin
@testable import CodexPlusCore

final class ManagementConnectionTests: XCTestCase {
    func testNativeDeadlineEndsAnUnresponsiveSocketRead() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("cp-" + UUID().uuidString.prefix(8)).resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("s").path
        let server = socket(AF_UNIX, SOCK_STREAM, 0)
        XCTAssertGreaterThanOrEqual(server, 0)
        defer { close(server) }
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8CString)
        XCTAssertLessThanOrEqual(bytes.count, MemoryLayout.size(ofValue: address.sun_path))
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes.map { UInt8(bitPattern: $0) }) }
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(server, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
        XCTAssertEqual(bound, 0); XCTAssertEqual(chmod(path, 0o600), 0); XCTAssertEqual(listen(server, 1), 0)
        let release = DispatchSemaphore(value: 0), finished = expectation(description: "socket worker returned")
        DispatchQueue.global().async {
            let client = accept(server, nil, nil)
            if client >= 0 { _ = try? ToolControlChannel.readFrame(from: client); release.wait(); close(client) }
            finished.fulfill()
        }
        let started = ProcessInfo.processInfo.systemUptime
        do {
            _ = try await ManagementConnection(path: path, timeout: 0.05).request(["command":ManagementProtocol.command,"protocol":1,"request_id":UUID().uuidString,"operation":"status"])
            XCTFail("Unresponsive authority must not return a usable scope")
        } catch { XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - started, 1) }
        release.signal()
        await fulfillment(of: [finished], timeout: 1)
    }
}
