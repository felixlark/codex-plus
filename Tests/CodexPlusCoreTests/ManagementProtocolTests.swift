import XCTest
@testable import CodexPlusCore

final class ManagementProtocolTests: XCTestCase {
    private let runtime = UUID()
    private func request(_ operation: String) -> [String: Any] {
        ["command": "management-v1", "protocol": 1, "request_id": UUID().uuidString, "operation": operation]
    }
    private func settings() -> ManagementProtocol.Settings {
        .init(workspaceAutoExpand: true, autoSendSuggestions: false,
              workspaceAutoExpandDisplaySelection: .init(), agentToolWindowsEnabled: true, chromeUsesAgentDisplay: true)
    }
    func testReadDoesNotRequireRuntimeButRejectsWriteFieldsAndBooleanVersion() throws {
        XCTAssertEqual(try ManagementProtocol.Request.parse(request("settings.read")).operation, .settingsRead)
        var value = request("settings.read"); value["changes"] = [:]
        XCTAssertThrowsError(try ManagementProtocol.Request.parse(value))
        value = request("status"); value["protocol"] = true
        XCTAssertThrowsError(try ManagementProtocol.Request.parse(value))
        value = request("status"); value["protocol"] = 1.5
        XCTAssertThrowsError(try ManagementProtocol.Request.parse(value))
    }
    func testMutationsRequireExactRuntimeAndSettingsRevision() throws {
        var value = request("workspace.open")
        XCTAssertThrowsError(try ManagementProtocol.Request.parse(value))
        value["expected_runtime"] = runtime.uuidString
        XCTAssertEqual(try ManagementProtocol.Request.parse(value).expectedRuntime, runtime)
        value = request("settings.write"); value["expected_runtime"] = runtime.uuidString
        value["changes"] = ["workspaceAutoExpand": false]
        XCTAssertThrowsError(try ManagementProtocol.Request.parse(value))
        value["expected_settings_revision"] = try settings().revision
        XCTAssertEqual(try ManagementProtocol.Request.parse(value).changes?["workspaceAutoExpand"] as? Bool, false)
        value["arbitrary_command"] = "never execute"
        XCTAssertThrowsError(try ManagementProtocol.Request.parse(value))
    }
    func testStatusRequestQueriesOnlyAnExactRuntimeAndOriginalRequestID() throws {
        var value = request("status"); value["query_request_id"] = UUID().uuidString
        XCTAssertThrowsError(try ManagementProtocol.Request.parse(value))
        value["expected_runtime"] = runtime.uuidString
        XCTAssertNotNil(try ManagementProtocol.Request.parse(value).queryID)
        value["query_request_id"] = "invalid"
        XCTAssertThrowsError(try ManagementProtocol.Request.parse(value))
    }
    func testStrictSettingsTypesAndWhitelistRejectNumericBooleanAndExtraFields() {
        for changes: [String: Any] in [["workspaceAutoExpand": 1], ["autoSendSuggestions": "true"], ["path": "/fixture"], ["chromeUsesAgentDisplay": NSNull()]] {
            XCTAssertThrowsError(try ManagementProtocol.Settings.validateChanges(changes))
        }
    }
    func testApplyingSettingsPreservesOthersAndChangesRevisionFromActualValues() throws {
        let original = settings(), revision = try original.revision
        let result = try original.applying(["workspaceAutoExpand": false, "chromeUsesAgentDisplay": false])
        XCTAssertFalse(result.workspaceAutoExpand); XCTAssertFalse(result.chromeUsesAgentDisplay)
        XCTAssertEqual(result.autoSendSuggestions, original.autoSendSuggestions)
        XCTAssertNotEqual(try result.revision, revision)
        XCTAssertEqual(try original.applying(["workspaceAutoExpand": true]).revision, revision)
    }
    func testDisplaySelectionUsesOriginalVersionAndRejectsDuplicateOrExtraRows() throws {
        let original = settings(), display = UUID().uuidString
        var selection: [String: Any] = ["version": 1, "mode": "selected", "hasCustomSelection": true,
            "selectedDisplays": [["uuid": display, "lastKnownName": "Fixture display"]]]
        let updated = try original.applying(["workspaceAutoExpandDisplaySelection": selection])
        XCTAssertEqual(updated.workspaceAutoExpandDisplaySelection.selectedDisplays.first?.uuid, display)
        selection["selectedDisplays"] = [["uuid": display, "lastKnownName": "Fixture", "private": true]]
        XCTAssertThrowsError(try original.applying(["workspaceAutoExpandDisplaySelection": selection]))
        selection["selectedDisplays"] = [["uuid": display, "lastKnownName": "Fixture"], ["uuid": display, "lastKnownName": "Duplicate"]]
        XCTAssertThrowsError(try original.applying(["workspaceAutoExpandDisplaySelection": selection]))
    }
    func testResponseKeepsAccurateRuntimeAndExplicitUnknownBackendVersions() throws {
        let parsed = try ManagementProtocol.Request.parse(request("status"))
        let identity = ManagementProtocol.RuntimeIdentity(instanceID: runtime, pid: 1234,
            bundleID: ManagementProtocol.runtimeBundleID, path: ManagementProtocol.runtimePath, version: "fixture", build: "fixture")
        let value = try ManagementProtocol.response(request: parsed, runtime: identity, capabilities: ["settings.read"])
        XCTAssertEqual(value["request_id"] as? String, parsed.id.uuidString)
        let actual = try XCTUnwrap(value["runtime"] as? [String: Any])
        XCTAssertEqual(actual["pid"] as? Int32, 1234)
        XCTAssertTrue(actual["controller_protocol"] is NSNull)
        XCTAssertEqual(actual["path"] as? String, ManagementProtocol.runtimePath)
    }
    func testCancelledClientDoesNotOpenAConnectionOrRestartRuntime() async {
        let client = ManagementConnection(); client.cancel()
        do { _ = try await client.request(request("status")); XCTFail("cancelled client must fail") }
        catch { XCTAssertTrue(error is CancellationError) }
    }
}

final class ManagementWorkspaceRequestTests: XCTestCase {
    func testReconciliationAlwaysUsesOriginalRuntimeWhenCurrentRuntimeChanges() {
        let original = UUID(), replacement = UUID(), request = UUID()
        let pending = ManagementWorkspaceRequest(requestID: request, runtimeID: original)
        XCTAssertEqual(pending.reconciliationFields["expected_runtime"] as? String, original.uuidString)
        XCTAssertEqual(pending.reconciliationFields["query_request_id"] as? String, request.uuidString)
        XCTAssertEqual(pending.observing(["request_id": request.uuidString, "phase": "ready"], runtimeID: replacement), pending)
    }
    func testDifferentRequestOrUnknownPhaseCannotClearOriginalPendingRequest() {
        let instance = UUID(), pending = ManagementWorkspaceRequest(requestID: UUID(), runtimeID: UUID())
        XCTAssertEqual(pending.observing(["request_id": UUID().uuidString, "phase": "ready"], runtimeID: instance), pending)
        XCTAssertEqual(pending.observing(["request_id": pending.requestID.uuidString, "phase": "unknown"], runtimeID: pending.runtimeID), pending)
        XCTAssertEqual(pending.observing(["request_id": UUID().uuidString, "phase": "ready"], runtimeID: pending.runtimeID), pending)
        XCTAssertNil(pending.observing(["request_id": pending.requestID.uuidString, "phase": "ready"], runtimeID: pending.runtimeID))
    }
    func testRecoveryBindsReportedRequestToActualResponseRuntime() {
        let actual = UUID(), id = UUID()
        let pending = ManagementWorkspaceRequest.recovering(["request_id": id.uuidString, "phase": "accepted"], runtimeID: actual)
        XCTAssertEqual(pending, .init(requestID: id, runtimeID: actual))
        XCTAssertNil(ManagementWorkspaceRequest.recovering(["request_id": id.uuidString, "phase": "closed"], runtimeID: actual))
    }
    func testNewRuntimeCanSettleOnlyAnExactlyCorrelatedOriginalRequest() {
        let original = UUID(), replacement = UUID(), id = UUID()
        let pending = ManagementWorkspaceRequest(requestID: id, runtimeID: original)
        XCTAssertEqual(pending.observing(["request_id": id.uuidString, "origin_runtime": UUID().uuidString, "phase": "ready"], runtimeID: replacement), pending)
        XCTAssertEqual(pending.observing(["request_id": id.uuidString, "origin_runtime": original.uuidString, "phase": "unknown"], runtimeID: replacement), pending)
        XCTAssertNil(pending.observing(["request_id": id.uuidString, "origin_runtime": original.uuidString, "phase": "closed"], runtimeID: replacement))
        XCTAssertEqual(ManagementWorkspaceRequest.recovering(["request_id": id.uuidString, "origin_runtime": original.uuidString, "phase": "unknown"], runtimeID: replacement), pending)
    }
}


final class ManagementRejectionTests: XCTestCase {
    func testExplicitPreEffectRefusalsAreDistinctFromUnknownFailures() {
        XCTAssertEqual(ManagementProtocol.rejection(in: ["ok": false, "error": "unsupported"]), .unsupported)
        XCTAssertEqual(ManagementProtocol.rejection(in: ["ok": false, "error": "conflict"]), .conflict)
        XCTAssertNil(ManagementProtocol.rejection(in: ["ok": false, "error": "settings_write_failed"]))
        XCTAssertNil(ManagementProtocol.rejection(in: ["ok": false, "error": "runtime_changed"]))
    }
    func testMalformedOrSuccessfulResponsesCannotAttestRejection() {
        XCTAssertNil(ManagementProtocol.rejection(in: ["ok": "false", "error": "conflict"]))
        XCTAssertNil(ManagementProtocol.rejection(in: ["ok": 0, "error": "conflict"]))
        XCTAssertNil(ManagementProtocol.rejection(in: ["ok": true, "error": "conflict"]))
    }
}
