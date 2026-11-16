// swift-tools-version: 5.9
import PackageDescription
import Foundation

let selectedInfoPath: String
if let explicitPath = ProcessInfo.processInfo.environment["CODEX_PLUS_LINK_INFO_PLIST"] {
    let attributes = try? FileManager.default.attributesOfItem(atPath: explicitPath)
    let isRegularFile = (attributes?[.type] as? FileAttributeType) == .typeRegular
    precondition(explicitPath.hasPrefix("/") && !explicitPath.isEmpty
        && isRegularFile, "Invalid Codex Plus linker metadata")
    selectedInfoPath = explicitPath
} else {
    selectedInfoPath = "AppInfo.plist"
}

let package = Package(
    name: "CodexPlus",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "CodexPlus", targets: ["CodexPlus"])],
    targets: [
        .target(name: "CodexPlusCore", dependencies: ["AgentDisplayShim"]),
        .target(name: "AgentDisplayShim", publicHeadersPath: "include",
                cSettings: [.unsafeFlags(["-fobjc-arc"])],
                linkerSettings: [.linkedFramework("CoreGraphics"), .linkedFramework("ApplicationServices")]),
        .executableTarget(
            name: "CodexPlus",
            dependencies: ["CodexPlusCore", "AgentDisplayShim"],
            exclude: ["Resources"],
            linkerSettings: [.unsafeFlags([
                "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT",
                "-Xlinker", "__info_plist", "-Xlinker", selectedInfoPath
            ])]
        ),
        .testTarget(name: "CodexPlusCoreTests", dependencies: ["CodexPlusCore"])
    ]
)
