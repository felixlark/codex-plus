import XCTest
@testable import CodexPlusCore

final class AgentDisplayStartupRecoveryTests: XCTestCase {
    func testUnavailableLoginSessionRetriesUntilSuccessThenStops() throws {
        var state = AgentDisplayStartupRecovery()
        XCTAssertNil(state.begin(now: 0, configured: false))
        let first = try XCTUnwrap(state.begin(now: 0, configured: true))
        XCTAssertNil(state.begin(now: 1, configured: true))
        XCTAssertFalse(state.complete(first, now: 1, ready: false, error: "not ready", retryInterval: 2))
        XCTAssertNil(state.begin(now: 2, configured: true))
        let retry = try XCTUnwrap(state.begin(now: 3, configured: true))
        XCTAssertTrue(state.complete(retry, now: 3, ready: true, error: nil, retryInterval: 2))
        XCTAssertTrue(state.isReady)
        XCTAssertNil(state.begin(now: 100, configured: true))
    }
    func testPauseResumeCannotOverlapProxyOrAcceptOldGeneration() throws {
        var state = AgentDisplayStartupRecovery()
        let old = try XCTUnwrap(state.begin(now: 0, configured: true))
        state.request(enabled: false)
        XCTAssertNil(state.begin(now: 1, configured: true))
        state.request(enabled: true)
        XCTAssertNil(state.begin(now: 2, configured: true))
        XCTAssertFalse(state.complete(old, now: 3, ready: true, error: nil, retryInterval: 2))
        XCTAssertFalse(state.isReady)
        let current = try XCTUnwrap(state.begin(now: 3, configured: true))
        XCTAssertFalse(state.complete(old, now: 3, ready: true, error: nil, retryInterval: 2))
        XCTAssertEqual(state.inFlight, current)
        XCTAssertTrue(state.complete(current, now: 3, ready: true, error: nil, retryInterval: 2))
    }
    func testPausedCompletionClearsOwnedProxyWithoutRestart() throws {
        var state = AgentDisplayStartupRecovery()
        let attempt = try XCTUnwrap(state.begin(now: 0, configured: true))
        state.request(enabled: false)
        XCTAssertFalse(state.complete(attempt, now: 1, ready: true, error: nil, retryInterval: 2))
        XCTAssertNil(state.inFlight)
        XCTAssertEqual(state.phase, .paused)
        XCTAssertNil(state.begin(now: 99, configured: true))
    }
    func testStartupEnvironmentHonorsTheFileInsteadOfInheritedOverrides() {
        let env = OCUStartupProtocol.environment(from: ["OPEN_COMPUTER_USE_VIRTUAL_DISPLAY_ENABLED": "true", "OPEN_COMPUTER_USE_VIRTUAL_DISPLAY_RESTORE_ON_SESSION_END": "false", "LANG": "en_US.UTF-8"], configurationPath: "/tmp/config.json")
        XCTAssertNil(env["OPEN_COMPUTER_USE_VIRTUAL_DISPLAY_ENABLED"])
        XCTAssertNil(env["OPEN_COMPUTER_USE_VIRTUAL_DISPLAY_RESTORE_ON_SESSION_END"])
        XCTAssertEqual(env["OPEN_COMPUTER_USE_CONFIG_FILE"], "/tmp/config.json")
        XCTAssertEqual(env["OPEN_COMPUTER_USE_AGENT_SOCKET_NAMESPACE"], "persistent-display")
        XCTAssertEqual(env["LANG"], "en_US.UTF-8")
    }
    func testStartupReplyRejectsTransientWrongNamespaceAndBooleanIdentities() throws {
        func result(_ receipt: [String: Any]) throws -> [String: Any] {
            ["isError": false, "content": [["type": "text", "text": String(decoding: try JSONSerialization.data(withJSONObject: receipt), as: UTF8.self)]]]
        }
        let valid: [String: Any] = ["protocol": 2, "geometry": "fit_restore_v1", "persistent": true, "namespace": "persistent-display", "display_id": 42]
        XCTAssertEqual(OCUStartupProtocol.readyDisplayID(try result(valid)), 42)
        for (key, value) in [("protocol", true), ("display_id", true), ("persistent", 1), ("persistent", false), ("namespace", "orange"), ("protocol", 1), ("geometry", "position_only"), ("geometry", NSNull())] as [(String, Any)] {
            var invalid = valid; invalid[key] = value
            XCTAssertNil(OCUStartupProtocol.readyDisplayID(try result(invalid)))
        }
    }
}
