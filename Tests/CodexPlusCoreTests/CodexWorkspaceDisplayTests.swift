import XCTest
@testable import CodexPlusCore

final class CodexWorkspaceDisplayTests: XCTestCase {
    private let a = "00000000-0000-0000-0000-000000000001"
    private let b = "00000000-0000-0000-0000-000000000002"

    private func screen(_ id: UInt32 = 1, uuid: String?, x: CGFloat = 0, y: CGFloat = 0,
                        width: CGFloat = 1000, height: CGFloat = 800, scale: Double = 1) -> CodexWorkspaceDisplay {
        .init(displayID: id, uuid: uuid, name: "Same monitor", isBuiltin: id == 1,
              bounds: CGRect(x: x, y: y, width: width, height: height), scaleFactor: scale, identityUsable: uuid != nil)
    }

    private func frame(_ x: CGFloat, _ y: CGFloat) -> CGRect { CGRect(x: x - 50, y: y - 50, width: 100, height: 100) }

    func testMissingPreferencePreservesGlobalDefaultAndSavedEmptySurvivesRestart() throws {
        let domain = "codex-plus-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        defaults.set(false, forKey: CodexWorkspacePreference.key)
        var selection = try XCTUnwrap(CodexWorkspaceDisplayPreference.load(defaults: defaults))
        XCTAssertEqual(selection.mode, .all)
        selection.setMode(.selected, displays: [screen(uuid: a)])
        selection.setSelected(uuid: a, name: "Same monitor", selected: false, displays: [])
        selection.setMode(.all, displays: [])
        selection.setMode(.selected, displays: [screen(uuid: a)])
        CodexWorkspaceDisplayPreference.save(selection, defaults: defaults)
        let reopened = try XCTUnwrap(UserDefaults(suiteName: domain))
        XCTAssertEqual(CodexWorkspaceDisplayPreference.load(defaults: reopened), selection)
        XCTAssertTrue(selection.selectedDisplays.isEmpty)
        XCTAssertFalse(reopened.bool(forKey: CodexWorkspacePreference.key))
    }

    func testFirstCustomSelectionOnlyIncludesUsableOnlineIdentities() {
        let screens = CodexWorkspaceDisplayCatalog.markUniqueIdentities([
            screen(uuid: a), screen(2, uuid: b), screen(3, uuid: nil)
        ])
        var selection = CodexWorkspaceDisplaySelection()
        selection.setMode(.selected, displays: screens)
        XCTAssertEqual(selection.selectedDisplays.map(\.uuid), [a, b])
        selection.setMode(.all, displays: screens)
        selection.setMode(.selected, displays: screens + [screen(4, uuid: "00000000-0000-0000-0000-000000000004")])
        XCTAssertEqual(selection.selectedDisplays.map(\.uuid), [a, b])
    }

    func testSameNameDisplaysHaveIndependentSelectionAndOfflineRetention() throws {
        let first = screen(uuid: a)
        let second = screen(2, uuid: b, x: 1000)
        var selection = CodexWorkspaceDisplaySelection()
        selection.setMode(.selected, displays: [first, second])
        selection.setSelected(uuid: b, name: second.name, selected: false, displays: [first, second])
        XCTAssertTrue(selection.contains(first))
        XCTAssertFalse(selection.contains(second))
        selection.setMode(.all, displays: [second])
        selection.setMode(.selected, displays: [second])
        let decoded = try XCTUnwrap(CodexWorkspaceDisplaySelection.decode(JSONEncoder().encode(selection)))
        XCTAssertEqual(decoded.selectedDisplays.map(\.uuid), [a])
        XCTAssertTrue(decoded.contains(first))
    }

    func testMalformedPreferenceIsPreservedUntilExplicitSave() throws {
        let domain = "codex-plus-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: domain))
        defer { defaults.removePersistentDomain(forName: domain) }
        for raw: Any in ["wrong type", Data("broken".utf8)] {
            defaults.set(raw, forKey: CodexWorkspaceDisplayPreference.key)
            XCTAssertNil(CodexWorkspaceDisplayPreference.load(defaults: defaults))
            XCTAssertNotNil(defaults.object(forKey: CodexWorkspaceDisplayPreference.key))
        }
        var value = CodexWorkspaceDisplaySelection()
        value.version = 2
        XCTAssertNil(CodexWorkspaceDisplaySelection.decode(try JSONEncoder().encode(value)))
        value.version = 1
        value.hasCustomSelection = true
        value.selectedDisplays = [.init(uuid: "bad", lastKnownName: "Test")]
        XCTAssertNil(CodexWorkspaceDisplaySelection.decode(try JSONEncoder().encode(value)))
        value.selectedDisplays = [.init(uuid: a, lastKnownName: "Test"), .init(uuid: a, lastKnownName: "Test")]
        XCTAssertNil(CodexWorkspaceDisplaySelection.decode(try JSONEncoder().encode(value)))
        CodexWorkspaceDisplayPreference.save(.init(), defaults: defaults)
        XCTAssertEqual(CodexWorkspaceDisplayPreference.load(defaults: defaults)?.mode, .all)
    }

    func testDuplicateOrMissingUUIDNeverAuthorizesSelectedMode() {
        let displays = CodexWorkspaceDisplayCatalog.markUniqueIdentities([
            screen(uuid: a), screen(2, uuid: a, x: 1000), screen(3, uuid: nil, x: 2000)
        ])
        XCTAssertTrue(displays.allSatisfy { !$0.identityUsable })
        var selection = CodexWorkspaceDisplaySelection()
        selection.setMode(.selected, displays: [])
        selection.setSelected(uuid: a, name: "Same monitor", selected: true, displays: [])
        for x: CGFloat in [500, 1500, 2500] {
            let decision = CodexWorkspaceDisplayPolicy.decide(selection: selection, windowFrame: frame(x, 400), displays: displays)
            XCTAssertEqual(decision.reason, .unavailableIdentity)
            XCTAssertFalse(decision.eligible)
        }
    }

    func testGeometryUsesWindowCenterAcrossNegativeVerticalAndScaledScreens() {
        let displays = [screen(uuid: a), screen(2, uuid: b, x: -1080, y: -1800, width: 1080, height: 1920, scale: 2)]
        XCTAssertEqual(CodexWorkspaceDisplayPolicy.resolve(windowFrame: frame(-500, -500), displays: displays).display?.uuid, b)
        XCTAssertEqual(CodexWorkspaceDisplayPolicy.resolve(windowFrame: frame(500, 400), displays: displays).display?.uuid, a)
        XCTAssertEqual(CodexWorkspaceDisplayPolicy.resolve(windowFrame: CGRect(x: -100, y: 0, width: 800, height: 100), displays: displays).display?.uuid, a)
    }

    func testGeometryBoundariesGapsOverlapAndInvalidFrames() {
        let left = screen(uuid: a)
        let right = screen(2, uuid: b, x: 1000)
        XCTAssertEqual(CodexWorkspaceDisplayPolicy.resolve(windowFrame: frame(1000, 400), displays: [left, right]).display?.uuid, b)
        XCTAssertEqual(CodexWorkspaceDisplayPolicy.resolve(windowFrame: frame(2000, 400), displays: [left, right]).reason, .unknownDisplay)
        XCTAssertEqual(CodexWorkspaceDisplayPolicy.resolve(windowFrame: frame(1500, 400), displays: [left]).reason, .unknownDisplay)
        XCTAssertEqual(CodexWorkspaceDisplayPolicy.resolve(windowFrame: frame(500, 400), displays: [left, screen(2, uuid: b)]).reason, .ambiguousDisplay)
        for rect: CGRect? in [nil, .zero, CGRect(x: CGFloat.nan, y: 0, width: 1, height: 1), CGRect(x: 0, y: 0, width: -1, height: 1)] {
            XCTAssertEqual(CodexWorkspaceDisplayPolicy.resolve(windowFrame: rect, displays: [left]).reason, .unavailableWindow)
        }
    }

    func testAllModePreservesExistingBehaviorWithUnavailableGeometry() {
        XCTAssertTrue(CodexWorkspaceDisplayPolicy.decide(selection: .init(), windowFrame: nil, displays: []).eligible)
        XCTAssertEqual(CodexWorkspaceDisplayPolicy.decide(selection: nil, windowFrame: nil, displays: []).reason, .invalidPreference)
        var value = CodexWorkspaceDisplaySelection()
        value.setMode(.selected, displays: [])
        XCTAssertEqual(CodexWorkspaceDisplayPolicy.decide(selection: value, windowFrame: nil, displays: []).reason, .noSelection)
    }

    func testActionBoundaryRejectsMovedDisconnectedAndDeselectedScreens() {
        let displays = [screen(uuid: a), screen(2, uuid: b, x: 1000)]
        var selection = CodexWorkspaceDisplaySelection()
        selection.setMode(.selected, displays: displays)
        let previous = CodexWorkspaceDisplayPolicy.decide(selection: selection, windowFrame: frame(500, 400), displays: displays)
        let same = CodexWorkspaceDisplayPolicy.decide(selection: selection, windowFrame: frame(510, 410), displays: displays)
        XCTAssertTrue(CodexWorkspaceDisplayPolicy.permitsAction(selection: selection, previous: previous, current: same))
        let moved = CodexWorkspaceDisplayPolicy.decide(selection: selection, windowFrame: frame(1500, 400), displays: displays)
        XCTAssertFalse(CodexWorkspaceDisplayPolicy.permitsAction(selection: selection, previous: previous, current: moved))
        let disconnected = CodexWorkspaceDisplayPolicy.decide(selection: selection, windowFrame: frame(500, 400), displays: [])
        XCTAssertFalse(CodexWorkspaceDisplayPolicy.permitsAction(selection: selection, previous: previous, current: disconnected))
        selection.setSelected(uuid: a, name: "Same monitor", selected: false, displays: displays)
        let deselected = CodexWorkspaceDisplayPolicy.decide(selection: selection, windowFrame: frame(500, 400), displays: displays)
        XCTAssertFalse(CodexWorkspaceDisplayPolicy.permitsAction(selection: selection, previous: previous, current: deselected))
    }
}
