import XCTest
import Darwin
@testable import CodexPlusCore

final class ToolCommandTests: XCTestCase {
    func testToolCLIValidatesBeforeAnyApplicationLaunch() throws {
        XCTAssertNil(ToolCommand.windowIdentity(pid: 2147483648, windowID: 1))
        XCTAssertNil(ToolCommand.windowIdentity(pid: 1, windowID: -1))
        XCTAssertNil(try ToolCommand.parse(["--status"]))
        XCTAssertEqual(try ToolCommand.parse(["--tool-status"])?["command"] as? String, "tool-status")
        let opened = try ToolCommand.parse(["--tool-open", "--app-path", "/Applications/Example.app", "--dedicated"])
        XCTAssertEqual(opened?["dedicated"] as? Bool, true)
        for args in [["--tool-unknown"], ["--tool-open"], ["--tool-open", "--app-path", "relative.app"], ["--tool-status", "--pid", "1"], ["--tool-place", "--pid", "1"], ["--tool-routing", "--enabled", "yes"]] {
            XCTAssertThrowsError(try ToolCommand.parse(args))
        }
    }

    func testFragmentedLargeJSONLineIsReceivedCompletely() throws {
        var pair: [Int32] = [0, 0]
        XCTAssertEqual(socketpair(AF_UNIX, SOCK_STREAM, 0, &pair), 0)
        defer { close(pair[0]); close(pair[1]) }
        // accept() inherits a nonblocking listener on macOS. A delayed sender
        // must remain connected until the complete request arrives.
        XCTAssertEqual(fcntl(pair[0], F_SETFL, O_NONBLOCK), 0)
        try ToolControlChannel.configureAcceptedSocket(pair[0])
        XCTAssertEqual(fcntl(pair[0], F_GETFL) & O_NONBLOCK, 0)
        let expected = Data(("{\"note\":\"" + String(repeating: "x", count: 12000) + "\"}").utf8)
        let writeFD = pair[1]
        let writer = expectation(description: "fragmented writer completes")
        DispatchQueue.global().async {
            defer { writer.fulfill() }
            for piece in [Data(expected.prefix(13)), Data(expected.dropFirst(13)), Data([0x0A])] {
                usleep(30_000)
                try? ToolControlChannel.writeAll(piece, to: writeFD)
            }
        }
        XCTAssertEqual(try ToolControlChannel.readFrame(from: pair[0]), expected)
        wait(for: [writer], timeout: 3)
    }

    func testIncompleteFrameIsRejectedAtEOF() throws {
        var pair: [Int32] = [0, 0]
        XCTAssertEqual(socketpair(AF_UNIX, SOCK_STREAM, 0, &pair), 0)
        defer { close(pair[0]); close(pair[1]) }
        try ToolControlChannel.writeAll(Data("{\"command\":\"tool-open\"}".utf8), to: pair[1])
        _ = shutdown(pair[1], SHUT_WR)
        XCTAssertThrowsError(try ToolControlChannel.readFrame(from: pair[0]))
    }
}
