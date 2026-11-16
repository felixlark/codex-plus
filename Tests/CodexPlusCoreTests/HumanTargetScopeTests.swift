import XCTest
@testable import CodexPlusCore
final class HumanTargetScopeTests: XCTestCase {
    private func value() -> [String:Any] {
        ["schema":"codex-target-ownership/v1","enhancementsOwner":"codex-plus",
         "host":["pid":123,"start_seconds":1,"start_microseconds":2,"appPath":"/Applications/ChatGPT.app","endpoint":"ws://127.0.0.1:1234/devtools/browser/original"],
         "targets":[["targetId":"human","purpose":"human","windowID":7,"browserWindowId":8,"webContentsId":9,"instance":"instance","frameId":"frame"],
                    ["targetId":"phone","purpose":"mobile","windowID":17,"browserWindowId":18,"webContentsId":19,"instance":"phone","frameId":"phone-frame"]]]
    }
    func testOnlyExactHumanWindowAndHostArePermitted() throws {
        let scope=try XCTUnwrap(HumanTargetScope(value()))
        XCTAssertTrue(scope.permits(pid:123,windowID:7))
        XCTAssertFalse(scope.permits(pid:123,windowID:17))
        XCTAssertFalse(scope.permits(pid:456,windowID:7))
        XCTAssertFalse(scope.permits(pid:123,windowID:99))
    }
    func testIncompleteUnknownAndDuplicateClaimsDoNotAuthoriseNativeEffects() {
        for field in ["webContentsId","browserWindowId","instance","frameId"] {
            var v=value(),targets=v["targets"] as! [[String:Any]];targets[0].removeValue(forKey:field);v["targets"]=targets
            XCTAssertNil(HumanTargetScope(v))
        }
        var v=value(),targets=v["targets"] as! [[String:Any]];targets[0]["purpose"]="unknown";v["targets"]=targets
        XCTAssertNil(HumanTargetScope(v))
        v=value();v["targets"]=[targets[1],targets[1]];XCTAssertNil(HumanTargetScope(v))
        v=value();v["enhancementsOwner"]="smart-shadow";XCTAssertNil(HumanTargetScope(v))
        XCTAssertNil(HumanTargetScope([:]))
    }
    func testBooleanWindowIdentityIsRejected() {
        var v=value(),targets=v["targets"] as! [[String:Any]];targets[0]["windowID"]=true;v["targets"]=targets
        XCTAssertNil(HumanTargetScope(v))
    }
}
