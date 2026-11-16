import Foundation

/// Only a complete positive claim can authorise native human-window effects.
public struct HumanTargetScope {
    public let pid: Int32
    public let windowIDs: Set<UInt32>
    public init?(_ value: [String: Any]) {
        guard value["schema"] as? String == "codex-target-ownership/v1",
              value["enhancementsOwner"] as? String == "codex-plus",
              let host = value["host"] as? [String: Any], host["appPath"] as? String == "/Applications/ChatGPT.app",
              let number = ManagementProtocol.integer(host["pid"]), let pid = Int32(exactly: number), pid > 0,
              let seconds = ManagementProtocol.integer(host["start_seconds"]), seconds > 0,
              let micros = ManagementProtocol.integer(host["start_microseconds"]), (0..<1_000_000).contains(micros),
              let endpoint = host["endpoint"] as? String, let url = URL(string: endpoint),
              url.scheme == "ws", url.host == "127.0.0.1", url.port != nil,
              url.path.hasPrefix("/devtools/browser/"),
              let targets = value["targets"] as? [[String: Any]] else { return nil }
        var ids = Set<String>(), windows = Set<UInt32>(), allWindows = Set<UInt32>(), browsers = Set<Int>(), contentsIDs = Set<Int>()
        for target in targets {
            guard let id = target["targetId"] as? String, !id.isEmpty, ids.insert(id).inserted,
                  let purpose = target["purpose"] as? String, ["human", "mobile"].contains(purpose),
                  let instance = target["instance"] as? String, !instance.isEmpty,
                  let frame = target["frameId"] as? String, !frame.isEmpty,
                  let wid = ManagementProtocol.integer(target["windowID"]), let window = UInt32(exactly: wid), window > 0,
                  allWindows.insert(window).inserted,
                  let browser = ManagementProtocol.integer(target["browserWindowId"]), browser > 0, browsers.insert(browser).inserted,
                  let contents = ManagementProtocol.integer(target["webContentsId"]), contents > 0, contentsIDs.insert(contents).inserted else { return nil }
            if purpose == "human" { windows.insert(window) }
        }
        self.pid = pid; windowIDs = windows
    }
    public func permits(pid: Int32, windowID: UInt32) -> Bool { pid == self.pid && windowIDs.contains(windowID) }
}
