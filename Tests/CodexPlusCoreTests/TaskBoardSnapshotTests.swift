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
    func testRunFinishedDoesNotCompleteCaseAndOldRevisionIsNotCurrent() throws {
        let value = try TaskBoardSnapshot.decode(["tasks":[row(1)]])
        XCTAssertEqual(value.runningCount, 1)
        XCTAssertEqual(value.completedCount, 0)
        XCTAssertEqual(value.tasks[0].currentActions.map(\.id), ["new"])
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
