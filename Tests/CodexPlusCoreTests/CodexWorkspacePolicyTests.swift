import XCTest
@testable import CodexPlusCore

final class CodexWorkspacePolicyTests: XCTestCase {
    func testPreferenceChangeConsumesQueuedSwitchBeforeDuplicateEvents() {
        var tracker = CodexWorkspaceSwitchTracker<String>()
        _ = tracker.observe(window: "w", chat: "A", workspaceOpen: false)
        // B's notification is pending when the preference changes. The observer
        // cancels that inspection and seeds the current B synchronously.
        tracker.displaySelectionDidChange()
        XCTAssertFalse(tracker.observe(window: "w", chat: "B", workspaceOpen: false))
        XCTAssertFalse(tracker.observe(window: "w", chat: "B", workspaceOpen: false))
        XCTAssertTrue(tracker.observe(window: "w", chat: "C", workspaceOpen: false))
    }

    func testPreferenceChangeWaitsThroughUnknownAndModalAndClearsOnDetach() {
        for context in [CodexWorkspaceStructuralContext.unknown, .dialog] {
            var tracker = CodexWorkspaceSwitchTracker<String>()
            _ = tracker.observe(window: "w", chat: "A", workspaceOpen: false)
            tracker.displaySelectionDidChange()
            tracker.observeStructuralContext(context)
            XCTAssertTrue(tracker.seedOnlyAfterDisplaySelectionChange)
            XCTAssertFalse(tracker.observe(window: "w", chat: "B", workspaceOpen: false))
            XCTAssertTrue(tracker.observe(window: "w", chat: "C", workspaceOpen: false))
            tracker.displaySelectionDidChange()
            tracker.reset() // Disabled, permission revoked, or target exited.
            XCTAssertFalse(tracker.seedOnlyAfterDisplaySelectionChange)
            XCTAssertFalse(tracker.observe(window: "w", chat: "B", workspaceOpen: false))
            XCTAssertTrue(tracker.observe(window: "w", chat: "C", workspaceOpen: false))
            tracker.displaySelectionDidChange()
            tracker.startOutsideChat()
            XCTAssertFalse(tracker.seedOnlyAfterDisplaySelectionChange)
            XCTAssertTrue(tracker.observe(window: "w", chat: "D", workspaceOpen: false))
        }
    }

    func testSkippedDisplayStillConsumesTaskSwitchAndMovingSameTaskStaysClosed() {
        var tracker = CodexWorkspaceSwitchTracker<String>()
        _ = tracker.observe(window: "w", chat: "A", workspaceOpen: false)
        // Observer consumes B before the screen gate rejects its action.
        XCTAssertTrue(tracker.observe(window: "w", chat: "B", workspaceOpen: false))
        // Moving B to a selected screen preserves B's manual pane state.
        XCTAssertFalse(tracker.observe(window: "w", chat: "B", workspaceOpen: false))
        XCTAssertTrue(tracker.observe(window: "w", chat: "C", workspaceOpen: false))
    }

    func testStartupAndDuplicateNotificationsDoNotOpenPane() {
        var tracker = CodexWorkspaceSwitchTracker<String>()
        XCTAssertFalse(tracker.observe(window: "w1", chat: "a", workspaceOpen: false))
        for _ in 0..<4 { XCTAssertFalse(tracker.observe(window: "w1", chat: "a", workspaceOpen: false)) }
        XCTAssertTrue(tracker.observe(window: "w1", chat: "b", workspaceOpen: false))
        for _ in 0..<4 { XCTAssertFalse(tracker.observe(window: "w1", chat: "b", workspaceOpen: false)) }
    }

    func testOpenWorkspaceNeverAddsTabAndManualCloseStaysClosed() {
        var tracker = CodexWorkspaceSwitchTracker<Int>()
        XCTAssertFalse(tracker.observe(window: 1, chat: 10, workspaceOpen: true))
        XCTAssertFalse(tracker.observe(window: 1, chat: 20, workspaceOpen: true))
        XCTAssertFalse(tracker.observe(window: 1, chat: 20, workspaceOpen: false))
        XCTAssertTrue(tracker.observe(window: 1, chat: 10, workspaceOpen: false))
    }

    func testIdentityNotTitleHandlesUnchangedViewAndSameNameChats() {
        var tracker = CodexWorkspaceSwitchTracker<String>()
        _ = tracker.observe(window: "w", chat: "toolbar-a", workspaceOpen: false)
        // Title noise with an unchanged view must not trigger a press.
        XCTAssertFalse(tracker.observe(window: "w", chat: "toolbar-a", workspaceOpen: false))
        // Different views can have identical human-readable titles.
        XCTAssertTrue(tracker.observe(window: "w", chat: "toolbar-b", workspaceOpen: false))
    }

    func testDialogCompletionReseedsReplacedToolbarBeforeNextRealSwitch() {
        var tracker = CodexWorkspaceSwitchTracker<String>()
        _ = tracker.observe(window: "w", chat: "before-dialog", workspaceOpen: false)
        tracker.reset() // Public dialog detected; unknown reads leave this state intact.
        // Saving Rename permanently remounts the same chat's toolbar.
        XCTAssertFalse(tracker.observe(window: "w", chat: "after-save", workspaceOpen: false))
        XCTAssertFalse(tracker.observe(window: "w", chat: "after-save", workspaceOpen: false))
        XCTAssertTrue(tracker.observe(window: "w", chat: "other-chat", workspaceOpen: false))
        tracker.reset()
        // Cancel may restore the same toolbar; it also seeds without opening.
        XCTAssertFalse(tracker.observe(window: "w", chat: "other-chat", workspaceOpen: false))
        XCTAssertTrue(tracker.observe(window: "w", chat: "after-save", workspaceOpen: false))
    }

    func testShortDialogCannotBeErasedBeforeDeferredSwitchInspection() {
        for context in [CodexWorkspaceStructuralContext.dialog, .unknown] {
            var tracker = CodexWorkspaceSwitchTracker<String>()
            _ = tracker.observe(window: "w", chat: "before", workspaceOpen: false)
            // Both signals arrive before the deferred action callback runs.
            tracker.observeStructuralContext(context)
            tracker.observeStructuralContext(.clear)
            XCTAssertFalse(tracker.hasRecognizedChat)
            XCTAssertFalse(tracker.observe(window: "w", chat: "remounted-same-chat", workspaceOpen: false))
            XCTAssertTrue(tracker.observe(window: "w", chat: "different-chat", workspaceOpen: false))
        }
        var tracker = CodexWorkspaceSwitchTracker<Int>()
        _ = tracker.observe(window: 1, chat: 10, workspaceOpen: false)
        tracker.observeStructuralContext(.clear)
        XCTAssertTrue(tracker.observe(window: 1, chat: 20, workspaceOpen: false))
    }

    func testFirstOpenAfterStartingOutsideChat() {
        var tracker = CodexWorkspaceSwitchTracker<Int>()
        tracker.startOutsideChat()
        XCTAssertTrue(tracker.observe(window: 1, chat: 10, workspaceOpen: false))
        XCTAssertFalse(tracker.observe(window: 1, chat: 10, workspaceOpen: false))
        tracker.reset()
        tracker.startOutsideChat()
        XCTAssertFalse(tracker.observe(window: 1, chat: 20, workspaceOpen: true))
    }

    func testWindowSwitchAndRestartBaseline() {
        var tracker = CodexWorkspaceSwitchTracker<Int>()
        _ = tracker.observe(window: 1, chat: 10, workspaceOpen: false)
        XCTAssertTrue(tracker.observe(window: 2, chat: 20, workspaceOpen: false))
        XCTAssertTrue(tracker.observe(window: 1, chat: 10, workspaceOpen: false))
        tracker.reset()
        XCTAssertFalse(tracker.observe(window: 1, chat: 10, workspaceOpen: false))
        XCTAssertTrue(tracker.observe(window: 1, chat: 30, workspaceOpen: false))
    }
}
