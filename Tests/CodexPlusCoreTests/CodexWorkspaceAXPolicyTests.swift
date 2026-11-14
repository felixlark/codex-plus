import XCTest
@testable import CodexPlusCore

final class CodexWorkspaceAXPolicyTests: XCTestCase {
    func testOnlyPrimaryShellValueChangesAreAccepted() {
        let shell = URL(string: "app://-/index.html")!
        XCTAssertTrue(CodexWorkspaceShell.isPrimaryWebArea(role: "AXWebArea", url: shell))
        for role in ["AXTextField", "AXTextArea", "AXStaticText", "AXGroup"] {
            XCTAssertFalse(CodexWorkspaceShell.isPrimaryWebArea(role: role, url: shell))
        }
        for url in ["https://example.com/index.html", "app://other/index.html", "app://-/browser.html"] {
            XCTAssertFalse(CodexWorkspaceShell.isPrimaryWebArea(role: "AXWebArea", url: URL(string: url)))
        }
        XCTAssertFalse(CodexWorkspaceShell.isPrimaryWebArea(role: nil, url: shell))
        XCTAssertFalse(CodexWorkspaceShell.isPrimaryWebArea(role: "AXWebArea", url: nil))
    }
    private let nodes = [
        0: CodexWorkspaceScanNode(role: "AXGroup", label: "", children: [1, 2]),
        1: CodexWorkspaceScanNode(role: "AXTabGroup", label: "Chat tabs", children: []),
        2: CodexWorkspaceScanNode(role: "AXButton", label: "New tab", children: [])
    ]

    private func tabs(read: (Int) -> CodexWorkspaceScanNode<Int>?) -> CodexWorkspaceSearchResult<Int> {
        CodexWorkspaceTreeSearch.find(root: 0, read: read, matching: { $0 == "AXTabGroup" && $1 == "Chat tabs" })
    }

    func testToolbarWaitsForRendererAndStaysWithinPrimaryShell() {
        var nodes = [
            0: CodexWorkspaceScanNode(role: "AXWindow", label: "", children: [1]),
            1: CodexWorkspaceScanNode(role: "AXToolbar", label: "Chat toolbar", children: [])
        ]
        if case .unknown = CodexWorkspaceTreeSearch.findChatToolbar(root: 0, read: { nodes[$0] }) {} else {
            XCTFail("A native window without the primary renderer is not a known outside-chat view")
        }

        nodes[0] = CodexWorkspaceScanNode(role: "AXWindow", label: "", children: [1, 2])
        nodes[2] = CodexWorkspaceScanNode(role: "AXWebArea", label: "", children: [], isPrimaryShell: true)
        if case .absent = CodexWorkspaceTreeSearch.findChatToolbar(root: 0, read: { nodes[$0] }) {} else {
            XCTFail("An exposed shell without a chat toolbar establishes an outside-chat view")
        }

        nodes[2] = CodexWorkspaceScanNode(role: "AXWebArea", label: "", children: [3], isPrimaryShell: true)
        nodes[3] = nodes[1]
        if case .found(3) = CodexWorkspaceTreeSearch.findChatToolbar(root: 0, read: { nodes[$0] }) {} else {
            XCTFail("Only the toolbar inside the primary shell identifies a chat")
        }
    }

    func testNewTaskPopupIsRecognizedWithoutEnteringItsMenu() {
        let header = [
            0: CodexWorkspaceScanNode(role: "AXGroup", label: "", children: [1]),
            1: CodexWorkspaceScanNode(role: "AXPopUpButton", label: "New tab", children: [])
        ]
        let result = CodexWorkspaceTreeSearch.find(root: 0, read: { header[$0] },
                                                  matching: CodexWorkspaceHeaderSearch.isExpandControl)
        guard case .found(1) = result else { return XCTFail("Command-N exposes New tab as a popup button") }

        let unrelated = [
            0: CodexWorkspaceScanNode(role: "AXGroup", label: "", children: [1, 2]),
            1: CodexWorkspaceScanNode(role: "AXMenuItem", label: "New tab", children: []),
            2: CodexWorkspaceScanNode(role: "AXPopUpButton", label: "Chat actions", children: [])
        ]
        guard case .absent = CodexWorkspaceTreeSearch.find(root: 0, read: { unrelated[$0] },
            matching: CodexWorkspaceHeaderSearch.isExpandControl) else {
            return XCTFail("Menu items and unrelated popups must not identify the workspace control")
        }
    }

    func testUpdatedHostCollapsedWorkspaceToggleIsRecognized() {
        let header = [
            0: CodexWorkspaceScanNode(role: "AXGroup", label: "", children: [1, 2]),
            1: CodexWorkspaceScanNode(role: "AXToolbar", label: "Chat toolbar", children: []),
            2: CodexWorkspaceScanNode(role: "AXCheckBox", label: "Show tabs", children: [])
        ]
        let state = CodexWorkspaceHeaderSearch.nearest(startingAt: 0, parent: { _ in nil }, inspect: { root in
            switch CodexWorkspaceTreeSearch.find(root: root, read: { header[$0] },
                                                matching: CodexWorkspaceHeaderSearch.isExpandControl) {
            case .found(let control): return .closed(control)
            case .absent: return .absent
            case .unknown: return .unknown
            }
        })
        guard case .closed(2) = state else {
            return XCTFail("The updated host's Show tabs toggle must identify a collapsed workspace")
        }
        for (role, label) in [("AXCheckBox", "Hide tabs"), ("AXMenuItem", "Show tabs"),
                              ("AXStaticText", "Show tabs"), ("AXCheckBox", "New tab")] {
            XCTAssertFalse(CodexWorkspaceHeaderSearch.isExpandControl(role: role, label: label))
        }
    }

    func testSelectedProductModeComesFromCurrentSelector() {
        for (label, expected) in [
            ("Switch mode, current mode: Codex", CodexWorkspaceProductMode.codex),
            ("Switch mode, current mode: ChatGPT", .chatGPT),
            ("Switch mode, current mode: ChatGPT Work", .chatGPT)
        ] {
            let nodes = [
                0: CodexWorkspaceScanNode(role: "AXGroup", label: "", children: [1, 2]),
                1: CodexWorkspaceScanNode(role: "AXMenuItem", label: "Codex", children: []),
                2: CodexWorkspaceScanNode(role: "AXPopUpButton", label: label, children: [])
            ]
            XCTAssertEqual(CodexWorkspaceTreeSearch.selectedProductMode(root: 0, read: { nodes[$0] }), expected)
        }
        let nodes = [0: CodexWorkspaceScanNode<Int>(role: "AXMenuItem", label: "Switch mode, current mode: Codex", children: [])]
        XCTAssertEqual(CodexWorkspaceTreeSearch.selectedProductMode(root: 0, read: { nodes[$0] }), .unknown)
        XCTAssertEqual(CodexWorkspaceTreeSearch.selectedProductMode(root: 0, read: { _ in nodes[1] }), .unknown)
    }

    func testExistingTabsAreFound() {
        guard case .found(1) = tabs(read: { nodes[$0] }) else { return XCTFail("existing tabs must suppress opening") }
    }

    func testTabRoleReadFailureIsUnknownEvenWhenNewTabButtonIsReadable() {
        guard case .unknown = tabs(read: { $0 == 1 ? nil : nodes[$0] }) else { return XCTFail("failed AX role read must never mean absent") }
    }

    func testAncestorChildrenReadFailureIsUnknown() {
        let unreadable = CodexWorkspaceScanNode<Int>(role: "AXGroup", label: "", children: nil)
        guard case .unknown = tabs(read: { $0 == 0 ? unreadable : nodes[$0] }) else { return XCTFail("incomplete traversal must not open a tab") }
    }

    func testOnlyCompleteScanProvesTabsAbsent() {
        let closed = CodexWorkspaceScanNode(role: "AXGroup", label: "", children: [2])
        guard case .absent = tabs(read: { $0 == 0 ? closed : nodes[$0] }) else { return XCTFail("known closed layout should be recognized") }
    }

    func testUnnamedHeaderButtonWrappersRemainTraversable() {
        let wrapped = [0: CodexWorkspaceScanNode(role: "AXButton", label: "", children: [1]),
                       1: CodexWorkspaceScanNode(role: "AXButton", label: "New tab", children: [])]
        let result = CodexWorkspaceTreeSearch.find(root: 0, read: { id in
            guard let node = wrapped[id] else { return nil }
            return CodexWorkspaceScanNode(role: node.role, label: node.label,
                children: CodexWorkspaceTreeSearch.prunesChildren(role: node.role, label: node.label) ? [] : node.children)
        }, matching: { $0 == "AXButton" && $1 == "New tab" })
        guard case .found(1) = result else { return XCTFail("must reach the named child of Codex's unnamed button wrapper") }
        XCTAssertTrue(CodexWorkspaceTreeSearch.prunesChildren(role: "AXGroup", label: "Conversation"))
        XCTAssertTrue(CodexWorkspaceTreeSearch.prunesChildren(role: "AXTextArea", label: ""))
    }

    func testHeaderControlsOutsideNestedToolbarWrappers() {
        var inspected: [Int] = []
        let result = CodexWorkspaceHeaderSearch.nearest(startingAt: 1, parent: { $0 + 1 }, inspect: { node -> CodexWorkspaceHeaderState<Int> in
            inspected.append(node)
            return node == 4 ? .closed(99) : .absent
        })
        guard case .closed(99) = result else { return XCTFail("must find outer header controls") }
        XCTAssertEqual(inspected, [1, 2, 3, 4], "do not search beyond the nearest header")
    }

    func testHeaderUnknownBoundaryAndParentCycleFailClosed() {
        var inspected: [Int] = []
        let unknown = CodexWorkspaceHeaderSearch.nearest(startingAt: 1, parent: { $0 + 1 }, inspect: { node -> CodexWorkspaceHeaderState<Int> in
            inspected.append(node)
            return node == 3 ? .unknown : .absent
        })
        guard case .unknown = unknown else { return XCTFail("shell boundary or read failure must stop traversal") }
        XCTAssertEqual(inspected, [1, 2, 3])
        let cycle = CodexWorkspaceHeaderSearch.nearest(startingAt: 1, parent: { $0 }, inspect: { _ -> CodexWorkspaceHeaderState<Int> in .absent })
        guard case .unknown = cycle else { return XCTFail("AX parent cycles must not loop") }
    }

    func testApplicationDialogIsDetectedBehindAnExposedChatToolbar() {
        let modalTree = [
            0: CodexWorkspaceScanNode(role: "AXGroup", label: "", children: [1, 2]),
            1: CodexWorkspaceScanNode(role: "AXToolbar", label: "Chat toolbar", children: []),
            2: CodexWorkspaceScanNode(role: "AXGroup", label: "Rename chat", children: [], subrole: "AXApplicationDialog")
        ]
        let result = CodexWorkspaceTreeSearch.findNode(root: 0, read: { modalTree[$0] }, matching: { $0.isBlockingDialog })
        guard case .found(2) = result else { return XCTFail("background toolbar must not hide the active Chromium dialog") }
    }

    func testProjectHoverCardDoesNotHideNewChatOrResetSwitchBaseline() {
        let nodes = [
            0: CodexWorkspaceScanNode(role: "AXGroup", label: "", children: [1, 2]),
            1: CodexWorkspaceScanNode(role: "AXToolbar", label: "Chat toolbar", children: []),
            2: CodexWorkspaceScanNode(role: "AXGroup", label: "", children: [],
                                      subrole: "AXApplicationDialog", isModal: false)
        ]
        let result = CodexWorkspaceTreeSearch.findNode(root: 0, read: { nodes[$0] }, matching: { $0.isBlockingDialog })
        guard case .absent = result else { return XCTFail("A project hover card is not a blocking dialog") }
        var tracker = CodexWorkspaceSwitchTracker<Int>()
        _ = tracker.observe(window: 0, chat: 1, workspaceOpen: false)
        tracker.observeStructuralContext(.clear)
        XCTAssertTrue(tracker.observe(window: 0, chat: 2, workspaceOpen: false))
        XCTAssertFalse(tracker.observe(window: 0, chat: 2, workspaceOpen: false))
    }

    func testModalOrUnreadableDialogStillProtectsRename() {
        for role in ["AXGroup", "AXDialog", "AXSheet"] {
            for modal in [true, nil] as [Bool?] {
                let node = CodexWorkspaceScanNode<Int>(role: role, label: "Rename chat", children: [],
                                                      subrole: "AXApplicationDialog", isModal: modal)
                XCTAssertTrue(node.isBlockingDialog)
            }
        }
        XCTAssertFalse(CodexWorkspaceScanNode<Int>(role: "AXGroup", label: "", children: []).isBlockingDialog)
    }

    func testTransientSubscriptionFailureRecoversWithoutRestart() {
        var subscriptions = CodexWorkspaceSubscriptions<Int>()
        var calls = 0
        subscriptions.ensure(element: 1, notification: "AXTitleChanged") { calls += 1; return .retryable(-25204) }
        XCTAssertEqual(subscriptions.activeCount, 0)
        XCTAssertEqual(subscriptions.retryableCount, 1)
        subscriptions.ensure(element: 1, notification: "AXTitleChanged") { calls += 1; return .active }
        XCTAssertEqual(subscriptions.activeCount, 1)
        XCTAssertEqual(subscriptions.retryableCount, 0)
        subscriptions.ensure(element: 1, notification: "AXTitleChanged") { calls += 1; return .active }
        XCTAssertEqual(calls, 2, "registered subscriptions must not be duplicated")
    }

    func testUnsupportedAndStaleSubscriptionsAreReportedAndReleased() {
        var subscriptions = CodexWorkspaceSubscriptions<Int>()
        subscriptions.ensure(element: 1, notification: "unsupported") { .unsupported }
        subscriptions.ensure(element: 1, notification: "unsupported") { XCTFail("unsupported is not transient"); return .active }
        subscriptions.ensure(element: 2, notification: "active") { .active }
        XCTAssertEqual(subscriptions.unsupportedCount, 1)
        var removed: [Int] = []
        subscriptions.remove(where: { _ in true }, unregister: { removed.append($0.element) })
        XCTAssertEqual(removed, [2])
        XCTAssertTrue(subscriptions.outcomes.isEmpty)
    }
}
