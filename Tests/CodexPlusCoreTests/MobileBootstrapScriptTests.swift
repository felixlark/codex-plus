import XCTest
@testable import CodexPlusCore

final class MobileBootstrapScriptTests: XCTestCase {
    func testActualNativeBootstrapPreservesOpaqueOwnKeysAfterJavaScriptReload() throws {
        let value: [String: Any] = ["localState": ["atoms": ["__proto__": ["中文🙂": true], "nested": ["__proto__": "own"]], "application": ["__proto__": "project"]]]
        let script = try MobileBootstrapScript.make(value, preload: "")
        let check = """
        const b=globalThis.__codexPlusMobileBootstrap;
        if(!Object.hasOwn(b.localState.atoms,'__proto__') || !b.localState.atoms.__proto__['中文🙂'] ||
           !Object.hasOwn(b.localState.atoms.nested,'__proto__') || b.localState.atoms.nested.__proto__!=='own' ||
           !Object.hasOwn(b.localState.application,'__proto__') || Object.getPrototypeOf(b.localState.atoms)!==Object.prototype) process.exit(1);
        """
        let input = Pipe(), process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "--input-type=module"]
        process.standardInput = input
        try process.run()
        input.fileHandleForWriting.write(Data((script + check).utf8)); try input.fileHandleForWriting.close()
        process.waitUntilExit(); XCTAssertEqual(process.terminationStatus, 0)
    }
}
