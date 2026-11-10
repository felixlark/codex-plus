import AppKit
import ColorSync
import Combine
import CoreGraphics

public struct CodexWorkspaceDisplay: Equatable, Identifiable {
    public let displayID: UInt32
    public let uuid: String?
    public let name: String
    public let isBuiltin: Bool
    public let bounds: CGRect
    public let scaleFactor: Double
    public var identityUsable: Bool
    public var id: UInt32 { displayID }
}

public final class CodexWorkspaceDisplayCatalog: ObservableObject {
    @Published public private(set) var displays: [CodexWorkspaceDisplay] = []
    private var token: NSObjectProtocol?

    public init() {
        refresh()
        token = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.refresh() }
    }

    deinit { if let token { NotificationCenter.default.removeObserver(token) } }

    public func refresh() {
        let current = Self.capture()
        if current != displays { displays = current }
    }

    public static func capture() -> [CodexWorkspaceDisplay] {
        let screens = NSScreen.screens.compactMap { screen -> CodexWorkspaceDisplay? in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
            let id = number.uint32Value
            guard id != 0 else { return nil }
            let uuid = CGDisplayCreateUUIDFromDisplayID(id).map {
                CFUUIDCreateString(nil, $0.takeRetainedValue()) as String
            }
            return CodexWorkspaceDisplay(displayID: id, uuid: uuid, name: screen.localizedName,
                isBuiltin: CGDisplayIsBuiltin(id) != 0, bounds: CGDisplayBounds(id),
                scaleFactor: screen.backingScaleFactor, identityUsable: uuid != nil)
        }
        return markUniqueIdentities(screens).sorted {
            if $0.isBuiltin != $1.isBuiltin { return $0.isBuiltin }
            if $0.bounds.minX != $1.bounds.minX { return $0.bounds.minX < $1.bounds.minX }
            if $0.bounds.minY != $1.bounds.minY { return $0.bounds.minY < $1.bounds.minY }
            return ($0.uuid ?? String($0.displayID)) < ($1.uuid ?? String($1.displayID))
        }
    }

    static func markUniqueIdentities(_ displays: [CodexWorkspaceDisplay]) -> [CodexWorkspaceDisplay] {
        let counts = Dictionary(grouping: displays.compactMap(\.uuid), by: { $0 }).mapValues(\.count)
        return displays.map { display in
            var value = display
            value.identityUsable = display.uuid.map { UUID(uuidString: $0) != nil && counts[$0] == 1 } ?? false
            return value
        }
    }
}

public struct CodexWorkspaceDisplaySelection: Codable, Equatable {
    public enum Mode: String, Codable { case all, selected }
    public struct SelectedDisplay: Codable, Equatable {
        public let uuid: String
        public var lastKnownName: String
    }
    public var version = 1
    public var mode: Mode = .all
    public var hasCustomSelection = false
    public var selectedDisplays: [SelectedDisplay] = []

    public init() {}

    public mutating func setMode(_ mode: Mode, displays: [CodexWorkspaceDisplay]) {
        self.mode = mode
        if mode == .selected && !hasCustomSelection {
            selectedDisplays = displays.filter(\.identityUsable).compactMap { display in
                display.uuid.map { SelectedDisplay(uuid: $0, lastKnownName: display.name) }
            }
            hasCustomSelection = true
        }
        normalize(displays: displays)
    }

    public mutating func setSelected(uuid: String, name: String, selected: Bool, displays: [CodexWorkspaceDisplay]) {
        selectedDisplays.removeAll { $0.uuid == uuid }
        if selected { selectedDisplays.append(SelectedDisplay(uuid: uuid, lastKnownName: name)) }
        hasCustomSelection = true
        normalize(displays: displays)
    }

    private mutating func normalize(displays: [CodexWorkspaceDisplay]) {
        selectedDisplays = selectedDisplays.map { saved in
            var value = saved
            if let display = displays.first(where: { $0.identityUsable && $0.uuid == saved.uuid }) {
                value.lastKnownName = display.name
            }
            return value
        }.sorted { $0.uuid < $1.uuid }
    }

    public func contains(_ display: CodexWorkspaceDisplay) -> Bool {
        display.identityUsable && selectedDisplays.contains { $0.uuid == display.uuid }
    }

    public static func decode(_ data: Data) -> Self? {
        guard let value = try? JSONDecoder().decode(Self.self, from: data), value.version == 1,
              value.hasCustomSelection || (value.mode == .all && value.selectedDisplays.isEmpty),
              value.selectedDisplays.allSatisfy({ UUID(uuidString: $0.uuid)?.uuidString == $0.uuid }),
              Set(value.selectedDisplays.map(\.uuid)).count == value.selectedDisplays.count else { return nil }
        return value
    }
}

public enum CodexWorkspaceDisplayPreference {
    public static let key = "workspaceAutoExpandDisplaySelection"

    public static func load(defaults: UserDefaults = CodexWorkspacePreference.defaults) -> CodexWorkspaceDisplaySelection? {
        guard let raw = defaults.object(forKey: key) else { return CodexWorkspaceDisplaySelection() }
        guard let data = raw as? Data else { return nil }
        return CodexWorkspaceDisplaySelection.decode(data)
    }

    public static func save(_ value: CodexWorkspaceDisplaySelection,
                            defaults: UserDefaults = CodexWorkspacePreference.defaults) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }
}

public struct CodexWorkspaceDisplayDecision {
    public enum Reason: String {
        case allDisplays, selectedDisplay, unselectedDisplay, noSelection, unknownDisplay
        case ambiguousDisplay, unavailableIdentity, invalidPreference, unavailableWindow
    }
    public let display: CodexWorkspaceDisplay?
    public let reason: Reason
    public var eligible: Bool { reason == .allDisplays || reason == .selectedDisplay }
}

public enum CodexWorkspaceDisplayPolicy {
    public static func decide(selection: CodexWorkspaceDisplaySelection?, windowFrame: CGRect?,
                              displays: [CodexWorkspaceDisplay]) -> CodexWorkspaceDisplayDecision {
        let resolution = resolve(windowFrame: windowFrame, displays: displays)
        guard let selection else { return .init(display: resolution.display, reason: .invalidPreference) }
        if selection.mode == .all { return .init(display: resolution.display, reason: .allDisplays) }
        if selection.selectedDisplays.isEmpty { return .init(display: resolution.display, reason: .noSelection) }
        guard let display = resolution.display else { return resolution }
        guard display.identityUsable else { return .init(display: display, reason: .unavailableIdentity) }
        return .init(display: display, reason: selection.contains(display) ? .selectedDisplay : .unselectedDisplay)
    }

    public static func resolve(windowFrame: CGRect?, displays: [CodexWorkspaceDisplay]) -> CodexWorkspaceDisplayDecision {
        guard let frame = windowFrame,
              [frame.origin.x, frame.origin.y, frame.size.width, frame.size.height].allSatisfy(\.isFinite),
              frame.size.width > 0, frame.size.height > 0 else { return .init(display: nil, reason: .unavailableWindow) }
        let center = CGPoint(x: frame.midX, y: frame.midY)
        let matches = displays.filter {
            center.x >= $0.bounds.minX && center.x < $0.bounds.maxX &&
            center.y >= $0.bounds.minY && center.y < $0.bounds.maxY
        }
        guard matches.count == 1 else {
            return .init(display: nil, reason: matches.isEmpty ? .unknownDisplay : .ambiguousDisplay)
        }
        return .init(display: matches[0], reason: .selectedDisplay)
    }

    /// A second resolution at the action boundary also prevents moving between
    /// two selected screens from turning an old event into a new action.
    public static func permitsAction(selection: CodexWorkspaceDisplaySelection?, previous: CodexWorkspaceDisplayDecision,
                                     current: CodexWorkspaceDisplayDecision) -> Bool {
        guard previous.eligible, current.eligible else { return false }
        return selection?.mode == .all || previous.display?.uuid == current.display?.uuid
    }
}
