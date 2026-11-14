import Foundation
import CodexPlusCore

enum SuggestionAcceptance {
    private static var options: SuggestionAcceptanceOptions { .parse(CommandLine.arguments) }
    static var isRequested: Bool { options != .absent }
    static var isValidOrAbsent: Bool { options != .invalid }
    static var threadID: String? {
        if case .thread(let id) = options { return id }
        return nil
    }
}
