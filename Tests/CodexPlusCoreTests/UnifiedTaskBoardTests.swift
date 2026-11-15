import XCTest
@testable import CodexPlusCore

final class UnifiedTaskBoardTests: XCTestCase {
    private func cases() throws -> TaskBoardSnapshot {
        try TaskBoardSnapshot.decode(["tasks": (1...2).map { n in
            ["repository":"o/r", "number":n, "input_revision":"v", "paused":false,
             "coordination":["status":"delivery", "updated_at":"now", "actions":[
                ["action_id":"a\(n)", "host_id":"sol", "thread_id":"t", "run_id":"r\(n)", "state":"delivered", "input_revision":"v"]
             ]]] as [String: Any]
        }])
    }
    private func catalog(run: String = "r2", host: String = "sol", unknown: Bool = false) throws -> CodexTaskCatalog {
        let data: [String: Any] = ["complete": !unknown, "mappedHost":["id":host,"sourceCommit":"s"], "threads":[
            ["id":"t", "name":"current", "runId":run, "status":unknown ? "unknown" : "active", "activeFlags":[], "unknown":unknown]
        ]]
        return try JSONDecoder().decode(CodexTaskCatalog.self, from: JSONSerialization.data(withJSONObject: data))
    }
    func testOnlyExactCurrentRunMergesAndDoesNotCompleteBusiness() throws {
        let board = UnifiedTaskBoard(tasks: try cases(), codex: try catalog(), expectedSourceCommit:"s")
        XCTAssertEqual(board.items.count, 2)
        XCTAssertEqual(board.items.first { $0.id == "o/r#1" }?.threads.count, 0)
        XCTAssertEqual(board.items.first { $0.id == "o/r#2" }?.threads.count, 1)
        XCTAssertEqual(board.runningCount, 1)
        XCTAssertEqual(board.completedCount, 0)
        XCTAssertTrue(board.complete)
    }
    func testNewRunOrDifferentHostIsNotMerged() throws {
        for catalog in [try catalog(run:"r3"), try catalog(host:"remote")] {
            XCTAssertEqual(UnifiedTaskBoard(tasks: try cases(), codex:catalog, expectedSourceCommit:"s").items.count, 3)
        }
    }
    func testReadFailureIsUnknownAndDoesNotCountAsRunning() throws {
        let board = UnifiedTaskBoard(tasks: try cases(), codex:try catalog(unknown:true), expectedSourceCommit:"s")
        XCTAssertEqual(board.items.count, 3)
        XCTAssertEqual(board.runningCount, 0)
        XCTAssertFalse(board.complete)
        XCTAssertFalse(UnifiedTaskBoard(tasks:nil, codex:try catalog(), expectedSourceCommit:nil).complete)
    }
    func testParentAloneCannotMergeDifferentWork() throws {
        let data: [String: Any] = ["complete":true, "threads":[
            ["id":"t", "name":"parent", "runId":"r2", "status":"active", "activeFlags":[], "unknown":false],
            ["id":"child", "name":"child", "parentThreadId":"t", "runId":"c", "status":"active", "activeFlags":[], "unknown":false]
        ], "mappedHost":["id":"sol","sourceCommit":"s"]]
        let catalog = try JSONDecoder().decode(CodexTaskCatalog.self, from: JSONSerialization.data(withJSONObject:data))
        let board = UnifiedTaskBoard(tasks: try cases(), codex:catalog, expectedSourceCommit:"s")
        XCTAssertEqual(board.items.count, 3)
        XCTAssertFalse(board.complete)
    }
}
