import Foundation

/// Geometry and ownership policy only; no activation, pointer or GUI operations.
public enum ToolWindowPolicy {
    public enum Scope: Equatable { case document(URL), none }
    public static let enabledKey = "agentToolWindowsEnabled"
    public static let protectedBundles: Set<String> = [
        "com.openai.codex", "me.longbiaochen.codex-plus", "com.webcatalog.juli.x-chat",
        "com.google.Chrome.app.lodlkdfmihgonocnmddehnfgiljnadcf",
        "com.google.Chrome.app.ehpoaimemjameeijlpblkfpomemadkke"
    ]
    public static func scope(bundleID: String, resource: URL?, existingDocuments: Set<URL>) -> Scope {
        guard !protectedBundles.contains(bundleID) else { return .none }
        guard let resource, resource.isFileURL else { return .none }
        let normalized = resource.standardizedFileURL.resolvingSymlinksInPath()
        return existingDocuments.contains(normalized) ? .none : .document(normalized)
    }
    public static func remainingClaims(_ claims: Set<URL>, knownDocuments: Set<URL>) -> Set<URL> {
        claims.subtracting(knownDocuments)
    }

    /// Only a newly owned, independent display can qualify; never select by position.
    public static func isIsolatedDisplay(id: UInt32, before: [UInt32: CGRect], after: [UInt32: CGRect],
                                        primaryBefore: UInt32, primaryAfter: UInt32, mirrored: Bool) -> Bool {
        guard id != 0, id != primaryAfter, before[id] == nil, !before.isEmpty, primaryBefore == primaryAfter, !mirrored,
              let bounds = after[id], !bounds.isEmpty,
              before.allSatisfy({ after[$0.key] == $0.value }) else { return false }
        return !before.values.contains { $0.intersects(bounds) }
    }

    public static func matchesIdentity(pid: Int32, windowID: UInt32, launchDate: Date,
                                       livePID: Int32, liveWindowID: UInt32, liveLaunchDate: Date?) -> Bool {
        pid > 0 && windowID > 0 && pid == livePID && windowID == liveWindowID && launchDate == liveLaunchDate
    }

    public enum ParkingOutcome: Equatable { case parked(CGRect), rolledBack, recoveryRequired(CGRect?) }
    /// Readback is authoritative, including AX writes that report a partial failure.
    public static func parkTransaction(original: CGRect, target: CGRect,
                                       write: (CGRect) -> Void, read: () -> CGRect?) -> ParkingOutcome {
        write(target)
        if let actual = read(), sameFrame(actual, target) { return .parked(actual) }
        write(original)
        if let actual = read(), sameFrame(actual, original) { return .rolledBack }
        return .recoveryRequired(read())
    }

    public static func sameFrame(_ a: CGRect, _ b: CGRect) -> Bool {
        abs(a.minX - b.minX) < 2 && abs(a.minY - b.minY) < 2
            && abs(a.width - b.width) < 2 && abs(a.height - b.height) < 2
    }

    public static func destination(frame: CGRect, area: CGRect) -> CGRect {
        let width = min(frame.width, area.width)
        let height = min(frame.height, area.height)
        return CGRect(x: area.minX + (area.width - width) / 2,
                      y: area.minY + (area.height - height) / 2, width: width, height: height)
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
