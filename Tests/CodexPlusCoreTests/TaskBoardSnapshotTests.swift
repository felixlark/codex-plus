import XCTest
@testable import CodexPlusCore

final class TaskBoardSnapshotTests: XCTestCase {
    private func row(_ number: Int, status: String = "running", paused: Bool = false) -> [String: Any] {
        ["repository":"owner/repo", "number":number, "input_revision":"current", "paused":paused,
         "coordination":["status":status, "agent_id":NSNull(), "updated_at":"2026-11-15T00:00:00Z", "actions":[
            ["action_id":"old", "input_revision":"old", "thread_id":"thread", "run_id":"run", "state":"delivered", "receipt":NSNull()],
            ["action_id":"new", "input_revision":"current", "thread_id":"thread", "run_id":"run", "state":"finished", "receipt":NSNull()]
         ]]]
    }
    func testRunFinishedDoesNotCompleteCaseAndOldUnrelatedAttemptIsNotCurrent() throws {
        let value = try TaskBoardSnapshot.decode(["tasks":[row(1)]])
        XCTAssertEqual(value.runningCount, 1)
        XCTAssertEqual(value.completedCount, 0)
        XCTAssertEqual(value.tasks[0].visibleActions.map(\.id), ["new"])
    }
    func testInputUpdateKeepsRunningAttemptAndDeliveredReceipt() throws {
        var value = row(1)
        var coordination = value["coordination"] as! [String: Any]
        var actions = coordination["actions"] as! [[String: Any]]
        actions[0]["state"] = "running"
        coordination["actions"] = actions; value["coordination"] = coordination
        XCTAssertEqual(try TaskBoardSnapshot.decode(["tasks":[value]]).tasks[0].visibleActions.count, 2)
        actions[0]["state"] = "delivered"; actions[0]["receipt"] = "https://github.com/owner/repo/issues/1#issuecomment-1"
        coordination["actions"] = actions; value["coordination"] = coordination
        XCTAssertEqual(try TaskBoardSnapshot.decode(["tasks":[value]]).tasks[0].visibleActions.count, 2)
    }
    func testPauseOverridesRunningAndTasksAreCountedOnce() throws {
        let value = try TaskBoardSnapshot.decode(["tasks":[row(1, paused:true), row(2, status:"completed")]])
        XCTAssertEqual(value.tasks.count, 2)
        XCTAssertEqual(value.runningCount, 0)
        XCTAssertEqual(value.completedCount, 1)
        XCTAssertEqual(value.tasks[0].status, "paused")
    }
    func testDuplicateOrInvalidTaskIdentityIsRejected() {
        XCTAssertThrowsError(try TaskBoardSnapshot.decode(["tasks":[row(1), row(1)]]))
        var bad = row(1); bad["repository"] = "owner/repo/../../bad"
        XCTAssertThrowsError(try TaskBoardSnapshot.decode(["tasks":[bad]]))
    }
}
