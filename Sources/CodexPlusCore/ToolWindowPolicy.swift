import Foundation

/// Geometry and ownership policy only; no activation, pointer or GUI operations.
public enum ToolWindowPolicy {
    public enum Scope: Equatable { case dedicated, document(URL), none }
    public static let enabledKey = "quietToolWindowsEnabled"
    public static let protectedBundles: Set<String> = [
        "com.openai.codex", "com.webcatalog.juli.x-chat",
        "com.google.Chrome.app.lodlkdfmihgonocnmddehnfgiljnadcf",
        "com.google.Chrome.app.ehpoaimemjameeijlpblkfpomemadkke"
    ]
    public static let utilityBundles: Set<String> = [
        "me.longbiaochen.dock-switch.settings", "me.longbiaochen.codex-plus",
        "com.deskvncviewer.desktop"
    ]
    public static func scope(bundleID: String, dedicated: Bool, resource: URL?, existingDocuments: Set<URL>) -> Scope {
        guard !protectedBundles.contains(bundleID) else { return .none }
        if utilityBundles.contains(bundleID) || dedicated { return .dedicated }
        guard let resource, resource.isFileURL else { return .none }
        let normalized = resource.standardizedFileURL
        return existingDocuments.contains(normalized) ? .none : .document(normalized)
    }
    public static func remainingClaims(_ claims: Set<URL>, knownDocuments: Set<URL>) -> Set<URL> {
        claims.subtracting(knownDocuments)
    }

    public static func target(_ displays: [CodexWorkspaceDisplay]) -> CodexWorkspaceDisplay? {
        displays.filter { !$0.isBuiltin }.max { $0.bounds.midX < $1.bounds.midX }
    }

    public static func destination(frame: CGRect, area: CGRect) -> CGRect {
        let width = min(frame.width, area.width)
        let height = min(frame.height, area.height)
        return CGRect(x: area.minX + (area.width - width) / 2,
                      y: area.minY + (area.height - height) / 2, width: width, height: height)
    }

    public static func workArea(visibleFrame: CGRect, primaryHeight: CGFloat) -> CGRect {
        CGRect(x: visibleFrame.minX, y: primaryHeight - visibleFrame.maxY,
               width: visibleFrame.width, height: visibleFrame.height)
    }

    public static func eligible(role: String, subrole: String, minimized: Bool, fullscreen: Bool) -> Bool {
        role == "AXWindow" && ["AXStandardWindow", "AXDialog", "AXSystemDialog"].contains(subrole)
            && !minimized && !fullscreen
    }

    public static func intersects(_ frame: CGRect, _ other: CGRect) -> Bool {
        min(frame.maxX, other.maxX) > max(frame.minX, other.minX)
            && min(frame.maxY, other.maxY) > max(frame.minY, other.minY)
    }
    public static func contained(_ frame: CGRect, in area: CGRect) -> Bool {
        frame.minX >= area.minX && frame.minY >= area.minY && frame.maxX <= area.maxX && frame.maxY <= area.maxY
    }
}
