import Foundation

/// JSON is data, not a JavaScript object literal: __proto__ must remain an own
/// property after a phone cold start, including nested opaque persisted values.
public enum MobileBootstrapScript {
    public static func make(_ bootstrap: [String: Any], preload: String) throws -> String {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: bootstrap), as: UTF8.self)
        let literal = String(decoding: try JSONEncoder().encode(json), as: UTF8.self)
        return "globalThis.__codexPlusMobileBootstrap=JSON.parse(\(literal));\n" + preload
    }
}
