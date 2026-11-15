import Foundation

/// Resolves a file-open callback to its own pre-open window inventory.
public enum FileOpenPolicy {
    public struct ProcessIdentity: Equatable {
        public let pid: Int32
        public let launchDate: Date
        public init(pid: Int32, launchDate: Date) {
            self.pid = pid
            self.launchDate = launchDate
        }
    }

    public enum Baseline: Equatable {
        case captured(Int)
        case newProcess
        case unavailable
    }

    public static func existingInstance(resource: URL, documents: [Set<URL>]) -> Int? {
        let normalized = resource.standardizedFileURL.resolvingSymlinksInPath()
        return documents.firstIndex { group in
            group.contains { $0.standardizedFileURL.resolvingSymlinksInPath() == normalized }
        }
    }

    public static func baseline(pid: Int32, launchDate: Date?, appURL: URL?,
                                requestedAppURL: URL, openCalledAt: Date,
                                captured: [ProcessIdentity]) -> Baseline {
        guard pid > 0, let launchDate, let appURL,
              appURL.standardizedFileURL.resolvingSymlinksInPath()
                == requestedAppURL.standardizedFileURL.resolvingSymlinksInPath() else {
            return .unavailable
        }
        if let index = captured.firstIndex(where: { $0.pid == pid && $0.launchDate == launchDate }) {
            return .captured(index)
        }
        // The boundary is the actual open call, after display preparation and
        // inventory collection. A process started during either is pre-existing.
        return launchDate >= openCalledAt ? .newProcess : .unavailable
    }
}
