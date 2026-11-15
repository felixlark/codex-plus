import XCTest
@testable import CodexPlusCore

final class OCUWindowProtocolTests: XCTestCase {
    func testOldOrPartialContractCannotMoveAnotherWindow() {
        func schema(_ id: [String: Any]?, _ placements: [String]) -> [String: Any] {
            var properties: [String: Any] = ["window_placement": ["enum": placements]]
            properties["window_id"] = id
            return ["properties": properties]
        }
        let all = ["keep", "right_display"]
        XCTAssertFalse(OCUWindowProtocol.supportsExactRightPlacement([:]))
        XCTAssertFalse(OCUWindowProtocol.supportsExactRightPlacement(schema(nil, all)))
        XCTAssertFalse(OCUWindowProtocol.supportsExactRightPlacement(schema(["type": "string"], all)))
        XCTAssertFalse(OCUWindowProtocol.supportsExactRightPlacement(schema(["type": "integer"], ["keep", "agent_display", "restore", "release"])))
        XCTAssertTrue(OCUWindowProtocol.supportsExactRightPlacement(schema(["type": "integer"], all)))
    }
}
