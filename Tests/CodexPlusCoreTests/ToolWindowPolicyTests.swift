import XCTest
@testable import CodexPlusCore

final class ToolWindowPolicyTests: XCTestCase {
    func testOnlyExplicitFileClaimsAndProtectedBundles() {
        let resource = URL(fileURLWithPath: "/tmp/tool.txt")
        for bundle in ["com.apple.TextEdit", "com.google.Chrome", "me.longbiaochen.dock-switch.settings", "com.deskvncviewer.desktop", "my.generated.tool"] {
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
    func testOnlyOwnedIsolatedVirtualDisplayQualifies() {
        let existing: [UInt32: CGRect] = [1: CGRect(x: 0, y: 0, width: 1500, height: 980), 2: CGRect(x: 1500, y: -1100, width: 2000, height: 1100)]
        var after = existing; after[30] = CGRect(x: 3500, y: 0, width: 1920, height: 1080)
        func valid(_ map: [UInt32: CGRect], id: UInt32 = 30, primary: UInt32 = 1, mirrored: Bool = false) -> Bool {
            ToolWindowPolicy.isIsolatedDisplay(id: id, before: existing, after: map, primaryBefore: 1, primaryAfter: primary, mirrored: mirrored)
        }
        XCTAssertTrue(valid(after))
        XCTAssertFalse(valid(after, id: 2)) // Physical right screen is never a fallback.
        XCTAssertFalse(valid(after, primary: 30))
        XCTAssertFalse(valid(after, mirrored: true))
        var overlap = after; overlap[30] = existing[2]; XCTAssertFalse(valid(overlap))
        var moved = after; moved[1] = CGRect(x: 10, y: 0, width: 1500, height: 980); XCTAssertFalse(valid(moved))
        XCTAssertFalse(valid(existing))
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
    func testPartialAXMoveRollsBackAndFailedRollbackRetainsRecovery() {
        let original = CGRect(x: 50, y: 60, width: 800, height: 600)
        let target = CGRect(x: 4000, y: 20, width: 500, height: 400)
        var frame = original
        let rolledBack = ToolWindowPolicy.parkTransaction(original: original, target: target, write: { rect in
            if rect == target { frame.size = rect.size } // Resize succeeded, position failed.
            else { frame = rect }
        }, read: { frame })
        XCTAssertEqual(rolledBack, .rolledBack)
        XCTAssertEqual(frame, original)
        let failed = ToolWindowPolicy.parkTransaction(original: original, target: target, write: { _ in frame.size = target.size }, read: { frame })
        XCTAssertEqual(failed, .recoveryRequired(frame))
        XCTAssertNotEqual(frame, original)
        let unverified = ToolWindowPolicy.parkTransaction(original: original, target: target, write: { _ in }, read: { nil })
        XCTAssertEqual(unverified, .recoveryRequired(nil))
    }
}
