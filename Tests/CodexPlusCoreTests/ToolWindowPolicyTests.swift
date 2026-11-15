import XCTest
@testable import CodexPlusCore

final class ToolWindowPolicyTests: XCTestCase {
    func testChromeAndFileRequestsKeepTheirIndependentObservationLifetime() {
        let file = URL(fileURLWithPath: "/tmp/chrome-file.html")
        let pending: Set<URL> = [file]
        let consumed = ToolWindowPolicy.remainingClaims(pending, knownDocuments: pending)
        XCTAssertTrue(ToolWindowPolicy.retainsObservation(defaultChrome: true, documents: consumed))
        XCTAssertTrue(ToolWindowPolicy.retainsObservation(defaultChrome: true, documents: nil))
        XCTAssertTrue(ToolWindowPolicy.retainsObservation(defaultChrome: false, documents: pending))
        XCTAssertFalse(ToolWindowPolicy.retainsObservation(defaultChrome: false, documents: consumed))
        XCTAssertFalse(ToolWindowPolicy.retainsObservation(defaultChrome: false, documents: nil))
    }
    func testChromeDefaultNeverClaimsWebAppsOrOtherBrowsers() {
        XCTAssertTrue(ToolWindowPolicy.defaultsToAgentDisplay(bundleID: "com.google.Chrome", enabled: true))
        XCTAssertFalse(ToolWindowPolicy.defaultsToAgentDisplay(bundleID: "com.google.Chrome", enabled: false))
        for bundle in ["com.google.Chrome.app.ehpoaimemjameeijlpblkfpomemadkke", "com.google.Chrome.beta", "com.apple.Safari", "com.openai.codex", ""] {
            XCTAssertFalse(ToolWindowPolicy.defaultsToAgentDisplay(bundleID: bundle, enabled: true))
        }
    }
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
    func testOnlyExactPersistentOCUDisplayQualifies() {
        let map: [UInt32: CGRect] = [1: CGRect(x: 0, y: 0, width: 1512, height: 982),
            28: CGRect(x: 1512, y: 0, width: 1920, height: 1080)]
        func valid(id: UInt32 = 28, primary: UInt32 = 1, vendor: UInt32 = 0x0CAC,
            model: UInt32 = 0x0CAC, serial: UInt32 = 3250512631, builtin: Bool = false,
            mirrored: Bool = false, online: [UInt32: CGRect]? = nil) -> Bool {
            ToolWindowPolicy.isPersistentAgentDisplay(id: id, primary: primary,
                vendor: vendor, model: model, serial: serial, expectedSerial: 3250512631,
                builtin: builtin, mirrored: mirrored, online: online ?? map)
        }
        XCTAssertTrue(valid())
        XCTAssertFalse(valid(id: 1)); XCTAssertFalse(valid(primary: 28))
        XCTAssertFalse(valid(vendor: 0)); XCTAssertFalse(valid(model: 0xC0D1))
        XCTAssertFalse(valid(serial: 1)); XCTAssertFalse(valid(builtin: true))
        XCTAssertFalse(valid(mirrored: true)); XCTAssertFalse(valid(online: [:]))
        var overlap = map; overlap[28] = map[1]; XCTAssertFalse(valid(online: overlap))
        XCTAssertFalse(valid(online: [1: map[1]!]))
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
