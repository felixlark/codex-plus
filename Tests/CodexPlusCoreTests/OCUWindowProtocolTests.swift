import XCTest
@testable import CodexPlusCore

final class OCUWindowProtocolTests: XCTestCase {
    func testOldOrPartialContractCannotMoveAnotherWindow() {
        func schema(_ id: [String: Any]?, _ placements: [String]) -> [String: Any] {
            var properties: [String: Any] = ["window_placement": ["enum": placements]]
            properties["window_id"] = id
            return ["properties": properties]
        }
        let all = ["keep", "agent_display", "restore", "release"]
        XCTAssertFalse(OCUWindowProtocol.supportsExactLifecycle([:]))
        XCTAssertFalse(OCUWindowProtocol.supportsExactLifecycle(schema(nil, all)))
        XCTAssertFalse(OCUWindowProtocol.supportsExactLifecycle(schema(["type": "string"], all)))
        XCTAssertFalse(OCUWindowProtocol.supportsExactLifecycle(schema(["type": "integer"], ["keep", "agent_display", "restore"])))
        XCTAssertTrue(OCUWindowProtocol.supportsExactLifecycle(schema(["type": "integer"], all)))
    }
}
