import XCTest
@testable import CodexPlusCore

final class DockSwitchPlacementTests: XCTestCase {
    func testSavedChatGPTPlacementIsReloadedAfterSettingsChange() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("config.json")
        func save(_ placement: String) throws {
            let data = Data("""
            {"dock_items":[
                {"name":"Codex","placement":"side_right_fill"},
                {"name":"ChatGPT","key":"RIGHT_SHIFT","screen":"0","placement":"\(placement)"}
            ]}
            """.utf8)
            try data.write(to: url, options: .atomic)
        }
        try save("external_fill")
        XCTAssertEqual(DockSwitchPlacement.load(appName: "ChatGPT", from: url), "external_fill")
        try save("external_right_half")
        XCTAssertEqual(DockSwitchPlacement.load(appName: " chatgpt.app ", from: url), "external_right_half")
        XCTAssertEqual(DockSwitchPlacement.load(appName: "Codex", from: url), "side_right_fill")
    }

    func testUnavailableConfigurationDoesNotInventPlacement() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertNil(DockSwitchPlacement.load(appName: "ChatGPT", from: url))
        for json in ["{", "{}", "{\"dock_items\":[]}",
                     "{\"dock_items\":[{\"name\":\"Codex\",\"placement\":\"external_fill\"}]}",
                     "{\"dock_items\":[{\"name\":\"ChatGPT\"}]}",
                     "{\"dock_items\":[{\"name\":\"ChatGPT\",\"placement\":\" \"}]}"] {
            try Data(json.utf8).write(to: url, options: .atomic)
            XCTAssertNil(DockSwitchPlacement.load(appName: "ChatGPT", from: url))
        }
    }
}
