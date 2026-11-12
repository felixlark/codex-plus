import Foundation

/// Titles are deliberately not task identities. AX toolbar identities distinguish
/// mounted views; dialogs invalidate the baseline because rename may remount one.
public struct CodexWorkspaceSwitchTracker<Identity: Equatable> {
    private var previous: (window: Identity, chat: Identity)?
    private var hasBaseline = false
    private(set) var seedOnlyAfterDisplaySelectionChange = false
    public init() {}
    var hasRecognizedChat: Bool { previous != nil }

    public mutating func reset() {
        invalidateView()
        seedOnlyAfterDisplaySelectionChange = false
    }

    mutating func invalidateView() { previous = nil; hasBaseline = false }

    mutating func displaySelectionDidChange() { seedOnlyAfterDisplaySelectionChange = true }

    // Called synchronously for shell notifications, before action coalescing.
    // A later clear signal must not erase evidence of a short-lived dialog.
    mutating func observeStructuralContext(_ context: CodexWorkspaceStructuralContext) {
        switch context {
        case .dialog, .unknown: invalidateView()
        case .clear: break
        }
    }

    /// Attach at Home/Settings/no window: the next recognized chat is an open.
    public mutating func startOutsideChat() {
        previous = nil
        hasBaseline = true
        seedOnlyAfterDisplaySelectionChange = false
    }

    public mutating func observe(window: Identity, chat: Identity, workspaceOpen: Bool) -> Bool {
        let changed = hasBaseline && (previous.map { $0.window != window || $0.chat != chat } ?? true)
        hasBaseline = true
        previous = (window, chat)
        if seedOnlyAfterDisplaySelectionChange {
            seedOnlyAfterDisplaySelectionChange = false
            return false
        }
        return changed && !workspaceOpen
    }
}

enum CodexWorkspaceStructuralContext { case clear, dialog, unknown }

public enum CodexWorkspacePreference {
    public static let domain = "me.longbiaochen.codex-plus"
    public static let key = "workspaceAutoExpand"

    public static var defaults: UserDefaults {
        Bundle.main.bundleIdentifier == domain ? .standard : UserDefaults(suiteName: domain)!
    }

    public static var enabled: Bool {
        return defaults.object(forKey: key) as? Bool ?? true
    }
}
