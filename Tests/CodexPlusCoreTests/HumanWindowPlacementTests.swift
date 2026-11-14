import XCTest
@testable import CodexPlusCore

final class HumanWindowPlacementTests: XCTestCase {
    func testReplacementWaitsForResizeBeforeMovingAndVerifying() {
        let target = CGRect(x: 1912, y: -1122, width: 2048, height: 1122)
        let initial = CGRect(x: -392, y: -1266, width: 2304, height: 1266)
        XCTAssertEqual(HumanWindowPlacement.next(frame: initial, target: target), .resize(target.size))
        // A successful AX write can still read back the old frame. It is pending,
        // not a reason to create another window or move using stale dimensions.
        XCTAssertEqual(HumanWindowPlacement.next(frame: initial, target: target), .resize(target.size))
        let resized = CGRect(origin: initial.origin, size: target.size)
        XCTAssertEqual(HumanWindowPlacement.next(frame: resized, target: target), .move(target.origin))
        XCTAssertEqual(HumanWindowPlacement.next(frame: target, target: target), .ready)
    }

    func testAlreadyPlacedExternalWindowRequiresNoMutation() {
        let external = CGRect(x: -392, y: -1266, width: 2304, height: 1266)
        XCTAssertEqual(HumanWindowPlacement.next(frame: external, target: external), .ready)
    }
}
