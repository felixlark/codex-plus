import XCTest
@testable import CodexPlusCore

final class MCPClientSessionTests: XCTestCase {
    private func fixture(_ mode: String, timeout: TimeInterval = 2) throws -> MCPClientSession {
        let script = #"""
import sys,json,time
mode=sys.argv[1]
for line in sys.stdin:
 r=json.loads(line); m=r.get('method')
 if 'id' not in r: continue
 if m==mode: time.sleep(60)
 print(json.dumps({'id':r['id'],'result':{}}),flush=True)
if mode=='eof': time.sleep(60)
"""#
        // A synthetic provider must not inherit XCTest DYLD injection hooks.
        return try MCPClientSession(executable: URL(fileURLWithPath: "/usr/bin/python3"), arguments: ["-u", "-c", script, mode], environment: ["PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8"], timeout: timeout)
    }
    func testNoReplyAtEachStartupStageReapsOnlyTheTemporaryClient() throws {
        let finished = expectation(description: "background client faults handled")
        DispatchQueue.global().async {
          do {
        for method in ["initialize", "tools/list", "tools/call"] {
            let session = try self.fixture(method)
            let start = ProcessInfo.processInfo.systemUptime
            for (index, step) in ["initialize", "tools/list", "tools/call"].enumerated() {
                let response = session.request(id: index + 1, method: step, params: [:])
                if step == method { XCTAssertNil(response); break }
                XCTAssertNotNil(response)
            }
            XCTAssertFalse(session.finish())
            XCTAssertFalse(session.isRunning)
            XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - start, 3)
            // No persistent in-flight slot: a fresh provider can succeed next.
            let next = try self.fixture("normal")
            XCTAssertNotNil(next.request(id: 1, method: "initialize", params: [:]))
            XCTAssertTrue(next.finish())
        }
          } catch { XCTFail("Client fixture failed: \(error)") }
          finished.fulfill()
        }
        wait(for: [finished], timeout: 15)
    }
    func testSuccessfulReplyButProxyIgnoringEOFHasBoundedCleanup() throws {
        let finished = expectation(description: "background EOF cleanup bounded")
        DispatchQueue.global().async {
          do {
        let session = try self.fixture("eof")
        XCTAssertNotNil(session.request(id: 1, method: "initialize", params: [:]))
        let start = ProcessInfo.processInfo.systemUptime
        XCTAssertFalse(session.finish())
        XCTAssertFalse(session.isRunning)
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - start, 3)
          } catch { XCTFail("Client fixture failed: \(error)") }
          finished.fulfill()
        }
        wait(for: [finished], timeout: 5)
    }
}
