import XCTest
@testable import CodexPlusCore

final class FileOpenPolicyTests: XCTestCase {
    private let app = URL(fileURLWithPath: "/Applications/Editor.app")
    private let call = Date(timeIntervalSince1970: 100)
    private let a = FileOpenPolicy.ProcessIdentity(pid: 10, launchDate: Date(timeIntervalSince1970: 10))
    private let b = FileOpenPolicy.ProcessIdentity(pid: 20, launchDate: Date(timeIntervalSince1970: 20))

    func testActualCallbackUsesItsOwnInventoryInEitherEnumerationOrder() {
        XCTAssertEqual(FileOpenPolicy.baseline(pid: b.pid, launchDate: b.launchDate,
            appURL: app, requestedAppURL: app, openCalledAt: call, captured: [a, b]), .captured(1))
        XCTAssertEqual(FileOpenPolicy.baseline(pid: b.pid, launchDate: b.launchDate,
            appURL: app, requestedAppURL: app, openCalledAt: call, captured: [b, a]), .captured(0))
    }

    func testAlreadyOpenFileIsFoundOutsideFirstInstance() {
        let file = URL(fileURLWithPath: "/tmp/requested-file.txt")
        let other = URL(fileURLWithPath: "/tmp/other-file.txt")
        XCTAssertEqual(FileOpenPolicy.existingInstance(resource: file, documents: [[other], [file]]), 1)
        XCTAssertNil(FileOpenPolicy.existingInstance(resource: file, documents: [[other], []]))
    }

    func testActualInstanceManualTabReuseConsumesClaim() {
        let file = URL(fileURLWithPath: "/tmp/requested-file.txt")
        guard case .captured(let index) = FileOpenPolicy.baseline(pid: b.pid,
            launchDate: b.launchDate, appURL: app, requestedAppURL: app,
            openCalledAt: call, captured: [a, b]) else { return XCTFail("Missing B inventory") }
        // The retained B window now exposes the requested file after tab reuse.
        let liveDocuments: [Set<URL>] = [[], [file]]
        XCTAssertTrue(ToolWindowPolicy.remainingClaims([file],
            knownDocuments: liveDocuments[index]).isEmpty)
        // A genuinely new document is still pending for observation.
        XCTAssertEqual(ToolWindowPolicy.remainingClaims([file], knownDocuments: []), [file])
    }

    func testOnlyProcessesCreatedAfterActualOpenMayUseEmptyInventory() {
        // A request may start at 90, but a different instance started at 95
        // while preparing the display is already running at the open call.
        XCTAssertEqual(FileOpenPolicy.baseline(pid: 30, launchDate: Date(timeIntervalSince1970: 95),
            appURL: app, requestedAppURL: app, openCalledAt: call, captured: [a]), .unavailable)
        XCTAssertEqual(FileOpenPolicy.baseline(pid: 30, launchDate: Date(timeIntervalSince1970: 101),
            appURL: app, requestedAppURL: app, openCalledAt: call, captured: [a]), .newProcess)
    }

    func testUnknownIdentityAndSubstitutedInstallationNeverBorrowAnInventory() {
        XCTAssertEqual(FileOpenPolicy.baseline(pid: b.pid, launchDate: nil,
            appURL: app, requestedAppURL: app, openCalledAt: call, captured: [a, b]), .unavailable)
        XCTAssertEqual(FileOpenPolicy.baseline(pid: b.pid, launchDate: b.launchDate,
            appURL: URL(fileURLWithPath: "/Other/Editor.app"), requestedAppURL: app,
            openCalledAt: call, captured: [a, b]), .unavailable)
        XCTAssertEqual(FileOpenPolicy.baseline(pid: b.pid, launchDate: Date(timeIntervalSince1970: 50),
            appURL: app, requestedAppURL: app, openCalledAt: call, captured: [a, b]), .unavailable)
    }
}
