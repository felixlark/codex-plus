import XCTest
@testable import CodexPlusCore

final class SmartShadowPreferencesTests: XCTestCase {
    func testMigrationPreservesFalseAndDisplayBytesWithoutImportingUnrelatedState() throws {
        let sourceName = "test.legacy.\(UUID())", targetName = "test.smartshadow.\(UUID())"
        let source = UserDefaults(suiteName: sourceName)!, target = UserDefaults(suiteName: targetName)!
        defer { source.removePersistentDomain(forName: sourceName); target.removePersistentDomain(forName: targetName) }
        let display = try JSONEncoder().encode(CodexWorkspaceDisplaySelection())
        source.set(false, forKey: "workspaceAutoExpand")
        source.set(display, forKey: "workspaceAutoExpandDisplaySelection")
        source.set(true, forKey: "autoSendSuggestions")
        source.set("unrelated fixture", forKey: "unrelatedState")
        let original = source.persistentDomain(forName: sourceName)! as NSDictionary
        SmartShadowPreferences.migrate(from: source, to: target)
        XCTAssertEqual(target.object(forKey: "workspaceAutoExpand") as? Bool, false)
        XCTAssertEqual(target.data(forKey: "workspaceAutoExpandDisplaySelection"), display)
        XCTAssertTrue(target.bool(forKey: "autoSendSuggestions"))
        XCTAssertNil(target.object(forKey: "unrelatedState"))
        XCTAssertEqual(original, source.persistentDomain(forName: sourceName)! as NSDictionary)
    }

    func testMigrationDoesNotOverwriteNewPreferencesOrSynchronizeLaterLegacyChanges() {
        let sourceName = "test.legacy.\(UUID())", targetName = "test.smartshadow.\(UUID())"
        let source = UserDefaults(suiteName: sourceName)!, target = UserDefaults(suiteName: targetName)!
        defer { source.removePersistentDomain(forName: sourceName); target.removePersistentDomain(forName: targetName) }
        source.set(true, forKey: "agentToolWindowsEnabled")
        target.set(false, forKey: "agentToolWindowsEnabled")
        SmartShadowPreferences.migrate(from: source, to: target)
        XCTAssertFalse(target.bool(forKey: "agentToolWindowsEnabled"))
        source.set(true, forKey: "autoSendSuggestions")
        SmartShadowPreferences.migrate(from: source, to: target)
        XCTAssertNil(target.object(forKey: "autoSendSuggestions"))
    }
}
