// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CodexPlus",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "CodexPlus", targets: ["CodexPlus"])],
    targets: [
        .target(name: "CodexPlusCore"),
        .target(name: "AgentDisplayShim", publicHeadersPath: "include",
                cSettings: [.unsafeFlags(["-fobjc-arc"])],
                linkerSettings: [.linkedFramework("CoreGraphics"), .linkedFramework("ApplicationServices")]),
        .executableTarget(
            name: "CodexPlus",
            dependencies: ["CodexPlusCore", "AgentDisplayShim"],
            exclude: ["Resources"],
            linkerSettings: [.unsafeFlags([
                "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT",
                "-Xlinker", "__info_plist", "-Xlinker", "AppInfo.plist"
            ])]
        ),
        .testTarget(name: "CodexPlusCoreTests", dependencies: ["CodexPlusCore"])
    ]
)
