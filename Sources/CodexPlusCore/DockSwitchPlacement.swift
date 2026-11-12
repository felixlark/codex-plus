import Foundation

/// Reads the same saved configuration as Dock Switch's ConfigStore.
public enum DockSwitchPlacement {
    public static let configURL = URL(fileURLWithPath:
        "/Applications/dock-switch.app/Contents/Resources/app/src/config.json")

    public static func load(appName: String, from url: URL = configURL) -> String? {
        guard let data = try? Data(contentsOf: url),
              let config = try? JSONDecoder().decode(Configuration.self, from: data),
              let item = config.dock_items.first(where: { normalize($0.name) == normalize(appName) }),
              let placement = item.placement?.trimmingCharacters(in: .whitespacesAndNewlines),
              !placement.isEmpty else { return nil }
        // Dock Switch resolves display identities and layout, including half screens.
        return placement
    }

    private static func normalize(_ name: String) -> String {
        var name = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if name.hasSuffix(".app") { name.removeLast(4) }
        return name
    }

    private struct Configuration: Decodable {
        let dock_items: [Item]
        struct Item: Decodable {
            let name: String
            let placement: String?
        }
    }
}
