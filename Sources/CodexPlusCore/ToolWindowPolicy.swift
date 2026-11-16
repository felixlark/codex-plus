import Foundation

/// Geometry and ownership policy only; no activation, pointer or GUI operations.
public enum ToolWindowPolicy {
    public enum Scope: Equatable { case document(URL), none }
    public static let enabledKey = "agentToolWindowsEnabled"
    public static let chromeEnabledKey = "chromeUsesAgentDisplay"
    public static let protectedBundles = CodexPlusIdentity.current.protectedBundles
    public static func scope(bundleID: String, resource: URL?, existingDocuments: Set<URL>) -> Scope {
        guard !protectedBundles.contains(bundleID) else { return .none }
        guard let resource, resource.isFileURL else { return .none }
        let normalized = resource.standardizedFileURL.resolvingSymlinksInPath()
        return existingDocuments.contains(normalized) ? .none : .document(normalized)
    }
    public static func canReportParked(requestID: String?, resource: URL?, latestRequestID: String?, actualDocument: URL?) -> Bool {
        guard let requestID, let resource else { return false }
        return requestID == latestRequestID && resource == actualDocument
    }
    public static func remainingClaims(_ claims: Set<URL>, knownDocuments: Set<URL>) -> Set<URL> {
        claims.subtracting(knownDocuments)
    }

    /// Candidates are already verified physical, online and non-mirrored.
    public static func rightmostDisplay(_ candidates: [UInt32: CGRect]) -> UInt32? {
        candidates.filter { !$0.value.isEmpty }.max {
            if $0.value.minX != $1.value.minX { return $0.value.minX < $1.value.minX }
            if $0.value.maxX != $1.value.maxX { return $0.value.maxX < $1.value.maxX }
            return $0.key < $1.key
        }?.key
    }

    public static func matchesIdentity(pid: Int32, windowID: UInt32, launchDate: Date,
                                       livePID: Int32, liveWindowID: UInt32, liveLaunchDate: Date?) -> Bool {
        pid > 0 && windowID > 0 && pid == livePID && windowID == liveWindowID && launchDate == liveLaunchDate
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
