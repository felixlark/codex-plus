import Foundation

public enum SuggestionAcceptanceOptions: Equatable {
    case absent
    case thread(String)
    case invalid

    public static func parse(_ arguments: [String]) -> Self {
        let flag = "--suggestion-acceptance-thread"
        let matches = arguments.indices.filter { arguments[$0] == flag || arguments[$0].hasPrefix(flag + "=") }
        guard !matches.isEmpty else { return .absent }
        guard matches.count == 1, let index = matches.first else { return .invalid }
        let value: String
        if arguments[index].hasPrefix(flag + "=") { value = String(arguments[index].dropFirst(flag.count + 1)) }
        else if arguments.indices.contains(index + 1) { value = arguments[index + 1] }
        else { return .invalid }
        guard let id = UUID(uuidString: value) else { return .invalid }
        return .thread(id.uuidString.lowercased())
    }
}
