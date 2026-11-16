import XCTest
@testable import CodexPlusCore

final class CodexPlusIdentityTests: XCTestCase {
    private var fields: [String: Any] {
        ["version": 1,
         "selfBundleID": "test.compat.legacy.plus",
         "selfTeamID": "A1B2C3D4E5",
         "enhancementDomain": "test.compat.legacy.enhancements",
         "legacyDomain": "test.compat.legacy.plus",
         "authorityBundleID": "test.compat.authority",
         "authorityTeamID": "F6G7H8J9K0",
         "smartShadowBundleID": "test.compat.smart-shadow"]
    }

    func testPublicDefaultsCompileWithoutGrantingOperations() throws {
        let identity = CodexPlusIdentity.publicDefaults
        XCTAssertEqual(identity.selfBundleID, "io.github.felixlark.codex-plus")
        XCTAssertEqual(identity.enhancementDomain, "io.github.felixlark.codex-plus.enhancements")
        XCTAssertEqual(identity.legacyDomain, "io.github.felixlark.codex-plus")
        XCTAssertFalse(identity.isOperational)
        XCTAssertThrowsError(try identity.requireOperational())
        XCTAssertThrowsError(try identity.selfRequirement())
        XCTAssertThrowsError(try identity.authorityRequirement())
        XCTAssertEqual(try CodexPlusIdentity.fromInfoDictionary([:]), identity)
    }

    func testCompleteInputKeepsEachSelectedValueAndIndependentTrust() throws {
        let identity = try CodexPlusIdentity(compatibilityDictionary: fields)
        XCTAssertEqual(identity.selfBundleID, fields["selfBundleID"] as? String)
        XCTAssertEqual(identity.enhancementDomain, fields["enhancementDomain"] as? String)
        XCTAssertEqual(identity.legacyDomain, fields["legacyDomain"] as? String)
        XCTAssertEqual(identity.authorityBundleID, fields["authorityBundleID"] as? String)
        XCTAssertEqual(identity.smartShadowBundleID, fields["smartShadowBundleID"] as? String)
        XCTAssertEqual(try identity.requireOperational().selfTeamID, "A1B2C3D4E5")
        XCTAssertEqual(try identity.requireOperational().authorityTeamID, "F6G7H8J9K0")
        XCTAssertEqual(try identity.selfRequirement(),
                       #"anchor apple generic and identifier "test.compat.legacy.plus" and certificate leaf[subject.OU] = "A1B2C3D4E5""#)
        XCTAssertEqual(try identity.authorityRequirement(),
                       #"anchor apple generic and identifier "test.compat.authority" and certificate leaf[subject.OU] = "F6G7H8J9K0""#)
    }

    func testMissingExtraAndWrongTypedFieldsNeverMixWithDefaults() {
        for key in fields.keys {
            var incomplete = fields
            incomplete.removeValue(forKey: key)
            XCTAssertThrowsError(try CodexPlusIdentity(compatibilityDictionary: incomplete), key)
        }
        var extra = fields
        extra["unexpected"] = "value"
        XCTAssertThrowsError(try CodexPlusIdentity(compatibilityDictionary: extra))
        for value: Any in [true, 1.0, "1", NSNull()] {
            var invalid = fields
            invalid["version"] = value
            XCTAssertThrowsError(try CodexPlusIdentity(compatibilityDictionary: invalid))
        }
        for value: Any in [true, 1, NSNull(), ["nested": "value"]] {
            var invalid = fields
            invalid["selfBundleID"] = value
            XCTAssertThrowsError(try CodexPlusIdentity(compatibilityDictionary: invalid))
        }
    }

    func testInvalidNamesAndTeamsAreRejected() {
        for value in ["", "white space", "test.quote\"", "test.line\n", "test.\\path", "test.*", "test.中文"] {
            var invalid = fields
            invalid["selfBundleID"] = value
            XCTAssertThrowsError(try CodexPlusIdentity(compatibilityDictionary: invalid), value)
        }
        for value in ["", "*", "short", "a1b2c3d4e5", "A1B2C3D4E5\n"] {
            var invalid = fields
            invalid["authorityTeamID"] = value
            XCTAssertThrowsError(try CodexPlusIdentity(compatibilityDictionary: invalid))
        }
    }

    func testCollisionsAndPermittedSharedValues() throws {
        for key in ["authorityBundleID", "smartShadowBundleID"] {
            var invalid = fields
            invalid[key] = fields["selfBundleID"]
            XCTAssertThrowsError(try CodexPlusIdentity(compatibilityDictionary: invalid))
        }
        var invalid = fields
        invalid["legacyDomain"] = fields["enhancementDomain"]
        XCTAssertThrowsError(try CodexPlusIdentity(compatibilityDictionary: invalid))
        var shared = fields
        shared["authorityTeamID"] = fields["selfTeamID"]
        XCTAssertNoThrow(try CodexPlusIdentity(compatibilityDictionary: shared))
    }

    func testInfoRequiresACompleteDictionaryAndMatchingBundle() throws {
        let info: [String: Any] = [CodexPlusIdentity.infoKey: fields,
                                   "CFBundleIdentifier": fields["selfBundleID"]!]
        XCTAssertEqual(try CodexPlusIdentity.fromInfoDictionary(info),
                       try CodexPlusIdentity(compatibilityDictionary: fields))
        for raw: Any in ["invalid", [:] as [String: Any], NSNull()] {
            XCTAssertThrowsError(try CodexPlusIdentity.fromInfoDictionary([
                CodexPlusIdentity.infoKey: raw]))
        }
        XCTAssertThrowsError(try CodexPlusIdentity.fromInfoDictionary([
            CodexPlusIdentity.infoKey: fields, "CFBundleIdentifier": "test.wrong.bundle"]))
        XCTAssertThrowsError(try CodexPlusIdentity.fromInfoDictionary([
            CodexPlusIdentity.infoKey: fields]))
    }

    func testProtectionIsAUnionIncludingUnchangedVendorMembers() throws {
        let identity = try CodexPlusIdentity(compatibilityDictionary: fields)
        let expected = CodexPlusIdentity.fixedThirdPartyProtectedBundles.union([
            identity.selfBundleID, identity.authorityBundleID, identity.smartShadowBundleID])
        XCTAssertEqual(identity.protectedBundles, expected)
        XCTAssertEqual(expected.count, 7)
        var collision = fields
        collision["selfBundleID"] = "com.openai.codex"
        let selected = try CodexPlusIdentity(compatibilityDictionary: collision)
        XCTAssertEqual(selected.protectedBundles.count, 6)
        XCTAssertTrue(selected.protectedBundles.contains("com.openai.codex"))
        XCTAssertTrue(CodexPlusIdentity.fixedThirdPartyProtectedBundles.isSubset(of: selected.protectedBundles))
    }

    func testExistingAliasesAndMigrationConstantsRemainPure() {
        XCTAssertEqual(CodexPlusInstallation.bundleID, CodexPlusIdentity.current.selfBundleID)
        XCTAssertEqual(ManagementProtocol.runtimeBundleID, CodexPlusIdentity.current.selfBundleID)
        XCTAssertEqual(PlusPreferences.domain, CodexPlusIdentity.current.enhancementDomain)
        XCTAssertEqual(PlusPreferences.legacyDomain, CodexPlusIdentity.current.legacyDomain)
        XCTAssertEqual(CodexWorkspacePreference.domain, PlusPreferences.domain)
        XCTAssertEqual(CodexPlusInstallation.path, "/Applications/Codex Plus.app")
        XCTAssertEqual(PlusPreferences.migrationKey, "interactionPreferencesMigratedV1")
        XCTAssertEqual(PlusPreferences.keys, ["workspaceAutoExpand", "workspaceAutoExpandDisplaySelection",
                                              "autoSendSuggestions", "agentToolWindowsEnabled",
                                              "chromeUsesAgentDisplay"])
    }
}
