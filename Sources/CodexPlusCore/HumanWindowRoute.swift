import Foundation

public enum HumanWindowRoute {
    public static func isMain(_ url: URL) -> Bool {
        guard url.scheme == "app", url.host == "-", url.path == "/index.html" else { return false }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let route = items.first(where: { $0.name == "initialRoute" })?.value ?? "/"
        let inner = URLComponents(string: route)?.queryItems ?? []
        guard !(items + inner).contains(where: { ["codexPlusMobileAnchor", "codexPlusWorkbench"].contains($0.name) }) else { return false }
        let path = URLComponents(string: route)?.path ?? route
        return !["/avatar-overlay", "/spotlight", "/global-dictation", "/hotkey-window"]
            .contains(where: { path == $0 || path.hasPrefix($0 + "/") })
    }
}
