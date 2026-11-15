import XCTest
@testable import CodexPlusCore

final class JSONLinePipeTests: XCTestCase {
    func testShortResponseReturnsBeforeWriterCloses() throws {
        let pipe = Pipe(), reader = JSONLinePipeReader(input: pipe.fileHandleForReading)
        let returned = expectation(description: "reply consumed before EOF"), group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async {
            let response = reader.response(matchingID: 7)
            XCTAssertEqual((response?["result"] as? [String: Any])?["text"] as? String, "完整回复")
            returned.fulfill(); group.leave()
        }
        XCTAssertTrue(JSONLinePipeWriter.write(["method": "notification"], to: pipe.fileHandleForWriting))
        XCTAssertTrue(JSONLinePipeWriter.write(["id": 7, "result": ["text": "完整回复"]], to: pipe.fileHandleForWriting))
        // The child would keep stdin/stdout open while waiting for request 8.
        wait(for: [returned], timeout: 2)
        try pipe.fileHandleForWriting.close()
        XCTAssertEqual(group.wait(timeout: .now() + 2), .success)
    }
    func testDeadlineReturnsWhileSilentWriterIsStillOpen() {
        let pipe = Pipe(), reader = JSONLinePipeReader(input: pipe.fileHandleForReading)
        let start = ProcessInfo.processInfo.systemUptime
        XCTAssertNil(reader.response(matchingID: 1, deadline: .now() + 0.05))
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - start, 1)
        XCTAssertTrue(JSONLinePipeWriter.write(["id": 2, "result": [:]], to: pipe.fileHandleForWriting))
        XCTAssertNotNil(reader.response(matchingID: 2, deadline: .now() + 1))
    }
    func testBrokenWriterReturnsFailureWithoutTerminatingTheProcess() throws {
        let pipe = Pipe()
        try pipe.fileHandleForReading.close()
        XCTAssertFalse(JSONLinePipeWriter.write(["id": 8], to: pipe.fileHandleForWriting))
        try pipe.fileHandleForWriting.close()
    }
}
