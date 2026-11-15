import AppKit
import CoreGraphics
import CryptoKit
import CodexPlusCore

/// A read-only reference to OCU's persistent screen. Plus owns window claims,
/// never the shared display's topology or lifetime.
final class AgentDisplay {
    private(set) var id: CGDirectDisplayID = 0
    private(set) var error: String?
    var isPreparing: Bool { false }
    var supported: Bool { persistentConfigurationEnabled }
    private(set) var diagnostics: [String: Any] = [:]
    var bounds: CGRect? { id == 0 ? nil : currentBounds() }

    private var expectedSerial: UInt32 {
        let hex = SHA256.hash(data: Data("persistent-display".utf8)).prefix(4)
            .map { String(format: "%02x", $0) }.joined()
        return max(2, UInt32(hex, radix: 16) ?? 2)
    }
    private var persistentConfigurationEnabled: Bool {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/open-computer-use-persistent/config.json")
        guard let data = try? Data(contentsOf: url),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let config = root["virtualDisplay"] as? [String: Any] else { return false }
        return config["enabled"] as? Bool == true && config["restoreOnSessionEnd"] as? Bool == false
    }
    private func eligible(_ candidate: UInt32, in online: [UInt32: CGRect]) -> Bool {
        ToolWindowPolicy.isPersistentAgentDisplay(id: candidate, primary: CGMainDisplayID(),
            vendor: CGDisplayVendorNumber(candidate), model: CGDisplayModelNumber(candidate),
            serial: CGDisplaySerialNumber(candidate), expectedSerial: expectedSerial,
            builtin: CGDisplayIsBuiltin(candidate) != 0,
            mirrored: CGDisplayIsInMirrorSet(candidate) != 0 || CGDisplayMirrorsDisplay(candidate) != 0,
            online: online)
    }
    var summary: String {
        prepare { _ in }
        if let bounds = currentBounds() {
            return "已连接 · \(Int(bounds.width)) × \(Int(bounds.height)) pt · 跨回合保留"
        }
        return supported ? "已配置 · 等待 OCU 虚拟屏连接" : "尚未配置 OCU 持久虚拟屏"
    }
    static func isPersistentScreen(_ id: UInt32) -> Bool {
        let reference = AgentDisplay()
        return reference.eligible(id, in: displays())
    }
    func currentBounds() -> CGRect? {
        let online = Self.displays()
        guard persistentConfigurationEnabled, id != 0, eligible(id, in: online) else {
            if id != 0 { error = "ocu-persistent-display-unavailable-or-changed" }
            return nil
        }
        return online[id]
    }
    func prepare(_ completion: @escaping (CGRect?) -> Void) {
        guard persistentConfigurationEnabled else {
            error = "ocu-persistent-display-not-configured"; completion(nil); return
        }
        let online = Self.displays()
        let candidates = online.keys.filter { eligible($0, in: online) }
        guard candidates.count == 1, let candidate = candidates.first else {
            error = "ocu-persistent-display-unavailable-or-ambiguous"
            diagnostics = ["owner": "Open Computer Use", "namespace": "persistent-display", "candidates": candidates.count]
            completion(nil); return
        }
        id = candidate; error = nil; diagnostics = [:]
        completion(online[candidate])
    }
    /// The router restores/closes only its own windows before dropping this reference.
    /// Other OCU windows and the persistent display remain untouched.
    func release() -> Bool { id = 0; error = nil; return true }

    static func userDisplays() -> [UInt32: CGRect] {
        displays().filter { CGDisplayVendorNumber($0.key) != 0x0CAC || CGDisplayModelNumber($0.key) != 0x0CAC }
    }

    static func displays() -> [UInt32: CGRect] {
        var count: UInt32 = 0
        guard CGGetOnlineDisplayList(0, nil, &count) == .success else { return [:] }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetOnlineDisplayList(count, &ids, &count) == .success else { return [:] }
        return Dictionary(uniqueKeysWithValues: ids.prefix(Int(count)).map { ($0, CGDisplayBounds($0)) })
    }
}
