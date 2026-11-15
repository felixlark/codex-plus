import Foundation
import CryptoKit
import Security

// The phone owns a fresh opaque UI KV, never the Mac's window/draft store.
// Original atoms can include resume tokens, so the entire atomic snapshot stays
// in this app's private, non-synchronizing Keychain item, not a plaintext file.
struct MobileUIState {
    let identity: String
    private var account: String { SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined() }
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "me.longbiaochen.codex-plus.mobile.ui-state.v1",
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: false]
    }
    private func validated(_ input: Any) throws -> [String: Any] {
        guard let state = input as? [String: Any], Set(state.keys) == Set(["atoms", "application"]),
              state["atoms"] is [String: Any], state["application"] is [String: Any],
              JSONSerialization.isValidJSONObject(state) else { throw NSError(domain: "MobileUIState", code: 1) }
        return state
    }
    private func stored() throws -> Data? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw NSError(domain: "MobileUIKeychain", code: Int(status == errSecSuccess ? errSecDecode : status))
        }
        return data
    }
    private func store(_ data: Data) throws {
        let start = ProcessInfo.processInfo.systemUptime
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, value in value } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw NSError(domain: "MobileUIKeychain", code: Int(status)) }
        NSLog("CodexMobile state committed: bytes=%d elapsedMs=%.2f", data.count,
              (ProcessInfo.processInfo.systemUptime - start) * 1000)
    }
    func read() throws -> [String: Any] {
        if let data = try stored() { return try validated(JSONSerialization.jsonObject(with: data)) }
        // Only an absent Keychain item permits one-way migration of this app's
        // same-identity legacy UI file. Locked/error/corrupt state never falls
        // back to a stale file or fabricates an empty successful result.
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: false).appendingPathComponent("CodexMobileUI", isDirectory: true)
        let legacy = root.appendingPathComponent(account + ".json")
        guard FileManager.default.fileExists(atPath: legacy.path) else { return ["atoms": [:], "application": [:]] }
        let state = try validated(JSONSerialization.jsonObject(with: Data(contentsOf: legacy)))
        let data = try JSONSerialization.data(withJSONObject: state)
        try store(data)
        guard try stored() == data else { throw NSError(domain: "MobileUIKeychain", code: Int(errSecDecode)) }
        // Keep the previous allowlisted, non-secret file as a rollback artifact;
        // no subsequent operation writes it or falls back to it on errors.
        return state
    }
    func write(_ value: Any) throws {
        try store(JSONSerialization.data(withJSONObject: validated(value)))
    }
}
