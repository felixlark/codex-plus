import Foundation
import CryptoKit

// The original persisted-atom protocol uses this phone-only backing store.
// It is never seeded from the Mac's draft or window-preference state.
struct MobileUIState {
    let identity: String
    private func validated(_ input: Any) throws -> [String: Any] {
        guard let state = input as? [String: Any], Set(state.keys) == Set(["atoms", "application"]),
              let atoms = state["atoms"] as? [String: Any], let application = state["application"] as? [String: Any],
              let file = Bundle.main.url(forResource: "MobileStateKeys", withExtension: "json"),
              let keys = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: [String]],
              atoms.keys.allSatisfy({ key in
                  (keys["atoms"] ?? []).contains(key) || (keys["atomPrefixes"] ?? []).contains(where: { prefix in
                      key.hasPrefix(prefix) && String(key.dropFirst(prefix.count)).range(of: #"^[a-zA-Z0-9_-]+$"#, options: .regularExpression) != nil
                  }) || (keys["projectExpansionAtomPrefixes"] ?? []).contains(where: { prefix in
                      guard key.hasPrefix(prefix) else { return false }
                      let project = String(key.dropFirst(prefix.count))
                      guard project.hasPrefix("executor-folder:") else { return !project.isEmpty }
                      guard let bytes = String(project.dropFirst("executor-folder:".count)).data(using: .utf8),
                            let scope = try? JSONSerialization.jsonObject(with: bytes) as? [String] else { return false }
                      return scope.count == 2
                  }) || (keys["identityPathAtomPrefixes"] ?? []).contains(where: { prefix in
                      guard key.hasPrefix(prefix) else { return false }
                      let ids = key.dropFirst(prefix.count).split(separator: "/", omittingEmptySubsequences: false)
                      return ids.count == 2 && ids.allSatisfy { !$0.isEmpty && String($0).removingPercentEncoding?.isEmpty == false }
                  }) || (keys["identityColonAtomPrefixes"] ?? []).contains(where: { prefix in
                      guard key.hasPrefix(prefix) else { return false }
                      let ids = key.dropFirst(prefix.count).split(separator: ":", omittingEmptySubsequences: false)
                      return ids.count == 2 && ids.allSatisfy({ !$0.isEmpty })
                  }) || [("identityAtomPrefixes", 2), ("identityTripleAtomPrefixes", 3)].contains(where: { group, count in
                      (keys[group] ?? []).contains(where: { prefix in
                          guard key.hasPrefix(prefix), let bytes = String(key.dropFirst(prefix.count)).data(using: .utf8),
                                let ids = try? JSONSerialization.jsonObject(with: bytes) as? [String] else { return false }
                          return ids.count == count && ids.allSatisfy({ !$0.isEmpty })
                      })
                  })
              }), Set(application.keys).isSubset(of: Set(keys["application"] ?? [])),
              JSONSerialization.isValidJSONObject(state) else { throw NSError(domain: "MobileUIState", code: 1) }
        return state
    }
    private func file() throws -> URL {
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("CodexMobileUI", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let name = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(name + ".json")
    }
    func read() throws -> [String: Any] {
        let url = try file()
        guard FileManager.default.fileExists(atPath: url.path) else { return ["atoms": [:], "application": [:]] }
        return try validated(JSONSerialization.jsonObject(with: Data(contentsOf: url)))
    }
    func write(_ value: Any) throws {
        let state = try validated(value)
        try JSONSerialization.data(withJSONObject: state).write(to: file(), options: .atomic)
    }
}
