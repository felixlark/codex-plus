import Foundation

/// Copy known preferences once. Mobile state, credentials and unknown operations
/// keep their existing storage and are never part of this migration.
public enum SmartShadowPreferences {
    public static let domain = "me.longbiaochen.smart-shadow.app"
    public static let legacyDomain = "me.longbiaochen.codex-plus"
    public static let migrationKey = "interactionPreferencesMigratedV1"
    public static let keys = ["workspaceAutoExpand", "workspaceAutoExpandDisplaySelection", "autoSendSuggestions",
                              "agentToolWindowsEnabled", "chromeUsesAgentDisplay"]
    public static let defaults: UserDefaults = {
        let target = UserDefaults(suiteName: domain)!
        migrate(from: UserDefaults(suiteName: legacyDomain)!, to: target)
        return target
    }()

    public static func migrate(from source: UserDefaults, to target: UserDefaults) {
        guard !target.bool(forKey: migrationKey) else { return }
        for key in keys where target.object(forKey: key) == nil {
            if let value = source.object(forKey: key) { target.set(value, forKey: key) }
        }
        target.set(true, forKey: migrationKey)
    }
}
