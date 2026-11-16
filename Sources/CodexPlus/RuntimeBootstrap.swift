import Foundation

/// SMAppService may restart a crashing LoginItem. Its no-argument entry is
/// deliberately a one-shot controller client, not the business runtime. The
/// controller launches the same bundle in --managed-runtime mode separately.
enum RuntimeBootstrap {
    static func run() {
        let executable = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/dev-ops/bin/ss-service")
        let child = Process()
        child.executableURL = executable
        child.arguments = ["start", "--component", "interactiond", "--holder", "smartshadow-login", "--reason", "系统登录启动"]
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        // A failed or unconfirmed request is left for the same controller to
        // reconcile. Normal exit prevents the OS from replaying the request.
        do { try child.run(); child.waitUntilExit() }
        catch { fputs("SmartShadow login start unavailable; inspect the official service.\n", stderr) }
    }
}
