import XCTest
@testable import CodexPlusCore

final class ToolWindowPolicyTests: XCTestCase {
    func testOnlyExplicitFileClaimsAndProtectedBundles() {
        let resource = URL(fileURLWithPath: "/tmp/tool.txt")
        for bundle in ["com.apple.TextEdit", "com.google.Chrome", "io.github.example.generated-settings", "com.deskvncviewer.desktop", "my.generated.tool"] {
            XCTAssertEqual(ToolWindowPolicy.scope(bundleID: bundle, resource: nil, existingDocuments: []), .none)
            XCTAssertEqual(ToolWindowPolicy.scope(bundleID: bundle, resource: URL(string: "https://example.com")!, existingDocuments: []), .none)
            XCTAssertEqual(ToolWindowPolicy.scope(bundleID: bundle, resource: resource, existingDocuments: []), .document(resource.resolvingSymlinksInPath()))
            XCTAssertEqual(ToolWindowPolicy.scope(bundleID: bundle, resource: resource, existingDocuments: [resource.resolvingSymlinksInPath()]), .none)
        }
        for bundle in ToolWindowPolicy.protectedBundles {
            XCTAssertEqual(ToolWindowPolicy.scope(bundleID: bundle, resource: resource, existingDocuments: []), .none)
        }
    }
    func testConsumedManualTabClaimNeverReturnsOnReopen() {
        let a = URL(fileURLWithPath: "/tmp/tool-a.txt"), b = URL(fileURLWithPath: "/tmp/tool-b.txt")
        let initial = ToolWindowPolicy.remainingClaims([a], knownDocuments: [b])
        let consumed = ToolWindowPolicy.remainingClaims(initial, knownDocuments: [a])
        XCTAssertTrue(consumed.isEmpty)
        XCTAssertTrue(ToolWindowPolicy.remainingClaims(consumed, knownDocuments: []).isEmpty)
    }
    func testRightmostPhysicalDisplayUsesCurrentNegativeCoordinateTopology() {
        XCTAssertNil(ToolWindowPolicy.rightmostDisplay([:]))
        let left = CGRect(x: -392, y: -1266, width: 2304, height: 1266)
        let right = CGRect(x: 1912, y: -1122, width: 2048, height: 1122)
        XCTAssertEqual(ToolWindowPolicy.rightmostDisplay([1: .zero, 2: left, 3: right]), 3)
        XCTAssertEqual(ToolWindowPolicy.rightmostDisplay([2: left]), 2)
        XCTAssertEqual(ToolWindowPolicy.rightmostDisplay([3: right, 4: right]), 4)
    }
    func testWindowIdentityNeverUsesOverlappingGeometry() {
        let launch = Date(timeIntervalSince1970: 10)
        func matches(pid: Int32 = 42, id: UInt32 = 90, date: Date? = launch) -> Bool {
            ToolWindowPolicy.matchesIdentity(pid: 42, windowID: 90, launchDate: launch, livePID: pid, liveWindowID: id, liveLaunchDate: date)
        }
        XCTAssertTrue(matches())
        XCTAssertFalse(matches(id: 91)) // Another AX window at the exact same frame.
        XCTAssertFalse(matches(pid: 43))
        XCTAssertFalse(matches(date: Date(timeIntervalSince1970: 11))) // Reused PID.
        XCTAssertFalse(matches(id: 0, date: nil)) // Stale/unavailable AX identity.
        XCTAssertFalse(ToolWindowPolicy.sameFrame(CGRect(x: 0, y: 0, width: 600, height: 400), CGRect(x: 50, y: 0, width: 600, height: 400)))
    }
    func testFitAndSpecialWindowExclusions() {
        let area = CGRect(x: 4000, y: 20, width: 1880, height: 1040)
        let small = ToolWindowPolicy.destination(frame: CGRect(x: 0, y: 0, width: 600, height: 400), area: area)
        XCTAssertEqual(small.size, CGSize(width: 600, height: 400))
        XCTAssertTrue(ToolWindowPolicy.contained(small, in: area))
        XCTAssertEqual(ToolWindowPolicy.destination(frame: CGRect(x: 0, y: 0, width: 2400, height: 1400), area: area), area)
        XCTAssertTrue(ToolWindowPolicy.eligible(role: "AXWindow", subrole: "AXStandardWindow", minimized: false, fullscreen: false))
        for (role, subrole, minimized, fullscreen) in [("AXSheet", "", false, false), ("AXMenu", "", false, false), ("AXWindow", "AXStandardWindow", true, false), ("AXWindow", "AXStandardWindow", false, true)] {
            XCTAssertFalse(ToolWindowPolicy.eligible(role: role, subrole: subrole, minimized: minimized, fullscreen: fullscreen))
        }
    }
    func testLateDocumentCannotMarkReusedManualRequestAsParked() {
        let a = URL(fileURLWithPath: "/tmp/a.txt")
        XCTAssertTrue(ToolWindowPolicy.canReportParked(requestID: "A", resource: a, latestRequestID: "A", actualDocument: a))
        // A is pending; B returns early as already open; A then appears.
        XCTAssertFalse(ToolWindowPolicy.canReportParked(requestID: "A", resource: a, latestRequestID: "B", actualDocument: a))
        XCTAssertFalse(ToolWindowPolicy.canReportParked(requestID: nil, resource: nil, latestRequestID: "B", actualDocument: a))
    }
}
