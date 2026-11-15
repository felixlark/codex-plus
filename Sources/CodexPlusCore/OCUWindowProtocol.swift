import Foundation

public enum OCUWindowProtocol {
    /// Old OCU ignores unknown window_id. Refuse that schema before any action.
    public static func supportsExactRightPlacement(_ schema: [String: Any]) -> Bool {
        guard let properties = schema["properties"] as? [String: Any],
              let identity = properties["window_id"] as? [String: Any],
              identity["type"] as? String == "integer",
              let placement = properties["window_placement"] as? [String: Any],
              let values = placement["enum"] as? [String] else { return false }
        return Set(["keep", "right_display"]).isSubset(of: Set(values))
    }
}
