import XCTest
@testable import CodexPlusCore

final class ToolWindowPolicyTests: XCTestCase {
    func testOwnershipDoesNotExpandFromOpeningAProcessOrFromTemporalCoincidence() {
        let resource = URL(fileURLWithPath: "/tmp/tool.txt")
        for bundle in ["com.apple.Terminal", "com.microsoft.VSCode", "com.google.Chrome", "unknown.app"] {
            XCTAssertEqual(ToolWindowPolicy.scope(bundleID: bundle, dedicated: false, resource: nil, existingDocuments: []), .none)
            XCTAssertEqual(ToolWindowPolicy.scope(bundleID: bundle, dedicated: false, resource: URL(string: "https://example.com")!, existingDocuments: []), .none)
            XCTAssertEqual(ToolWindowPolicy.scope(bundleID: bundle, dedicated: false, resource: resource, existingDocuments: []), .document(resource))
            XCTAssertEqual(ToolWindowPolicy.scope(bundleID: bundle, dedicated: false, resource: resource, existingDocuments: [resource]), .none)
        }
        XCTAssertEqual(ToolWindowPolicy.scope(bundleID: "my.generated.tool", dedicated: true, resource: nil, existingDocuments: []), .dedicated)
        XCTAssertEqual(ToolWindowPolicy.scope(bundleID: "com.openai.codex", dedicated: true, resource: nil, existingDocuments: []), .none)
    }
    func testReusingAManualWindowConsumesTheFileClaimBeforeLaterReopen() {
        let a = URL(fileURLWithPath: "/tmp/tool-a.txt")
        let b = URL(fileURLWithPath: "/tmp/manual-b.txt")
        let initial = ToolWindowPolicy.remainingClaims([a], knownDocuments: [b])
        XCTAssertEqual(initial, [a])
        let reusedAsTab = ToolWindowPolicy.remainingClaims(initial, knownDocuments: [a])
        XCTAssertTrue(reusedAsTab.isEmpty)
        XCTAssertTrue(ToolWindowPolicy.remainingClaims(reusedAsTab, knownDocuments: []).isEmpty)
    }
    private func display(_ id: UInt32, x: Double, internalDisplay: Bool = false) -> CodexWorkspaceDisplay {
        let rect = CGRect(x: x, y: -900, width: 1200, height: 900)
        return CodexWorkspaceDisplay(displayID: id, uuid: nil, name: "Same model", isBuiltin: internalDisplay, bounds: rect, scaleFactor: 2, identityUsable: false)
    }

    func testVisibleWorkAreaUsesAXCoordinatesOnNonPrimaryScreens() {
        let visible = CGRect(x: 2000, y: 982, width: 2048, height: 1122)
        XCTAssertEqual(ToolWindowPolicy.workArea(visibleFrame: visible, primaryHeight: 982), CGRect(x: 2000, y: -1122, width: 2048, height: 1122))
        XCTAssertEqual(ToolWindowPolicy.workArea(visibleFrame: CGRect(x: 0, y: 71, width: 1512, height: 878), primaryHeight: 982), CGRect(x: 0, y: 33, width: 1512, height: 878))
    }

    func testNoExternalTargetDoesNotFallBackOntoChatScreen() {
        XCTAssertNil(ToolWindowPolicy.target([]))
        XCTAssertNil(ToolWindowPolicy.target([display(1, x: 0, internalDisplay: true)]))
        XCTAssertEqual(ToolWindowPolicy.target([display(2, x: -1200), display(1, x: 0, internalDisplay: true), display(3, x: 1200)])?.displayID, 3)
    }

    func testFitPreservesSmallToolsAndContainsOversizeToolsInWorkArea() {
        let area = CGRect(x: 2000, y: -1100, width: 2000, height: 1100)
        let small = ToolWindowPolicy.destination(frame: CGRect(x: -900, y: 33, width: 600, height: 400), area: area)
        XCTAssertEqual(small, CGRect(x: 2700, y: -750, width: 600, height: 400))
        XCTAssertEqual(ToolWindowPolicy.destination(frame: CGRect(x: 0, y: 0, width: 2400, height: 1400), area: area), area)
        XCTAssertFalse(ToolWindowPolicy.contained(CGRect(x: 1900, y: -1100, width: 1900, height: 1000), in: area))
        XCTAssertTrue(ToolWindowPolicy.contained(small, in: area))
    }

    func testSheetsMenusFullscreenAndMinimizedWindowsStayWithTheirOwner() {
        XCTAssertTrue(ToolWindowPolicy.eligible(role: "AXWindow", subrole: "AXStandardWindow", minimized: false, fullscreen: false))
        for (role, subrole, minimized, fullscreen) in [
            ("AXSheet", "", false, false), ("AXMenu", "", false, false),
            ("AXWindow", "AXStandardWindow", true, false), ("AXWindow", "AXStandardWindow", false, true)
        ] {
            XCTAssertFalse(ToolWindowPolicy.eligible(role: role, subrole: subrole, minimized: minimized, fullscreen: fullscreen))
        }
        XCTAssertTrue(ToolWindowPolicy.protectedBundles.contains("com.openai.codex"))
        XCTAssertFalse(ToolWindowPolicy.utilityBundles.contains("com.apple.TextEdit"))
        XCTAssertFalse(ToolWindowPolicy.utilityBundles.contains("com.google.Chrome"))
    }
}
