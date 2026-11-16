import Foundation
import CoreFoundation

public enum CodexPlusIdentityError: Error, Equatable {
    case compatibilityInfoInvalid
    case compatibilityInputRequired
}

public struct CodexPlusIdentity: Equatable, Sendable {
    public struct Signing: Equatable, Sendable {
        public let selfTeamID: String
        public let authorityTeamID: String
    }
    public let selfBundleID: String
    public let enhancementDomain: String
    public let legacyDomain: String
    public let authorityBundleID: String
    public let smartShadowBundleID: String
    public let signing: Signing?

    public static let infoKey = "CodexPlusCompatibility"
    public static let publicDefaults = CodexPlusIdentity(
        selfBundleID: "io.github.felixlark.codex-plus",
        enhancementDomain: "io.github.felixlark.codex-plus.enhancements",
        legacyDomain: "io.github.felixlark.codex-plus",
        authorityBundleID: "io.github.felixlark.smart-shadow.interactiond",
        smartShadowBundleID: "io.github.felixlark.smart-shadow.app", signing: nil)
    public static let current: CodexPlusIdentity = {
        do { return try fromInfoDictionary(Bundle.main.infoDictionary ?? [:]) }
        catch { fatalError("Invalid Codex Plus compatibility metadata") }
    }()
    public static let fixedThirdPartyProtectedBundles: Set<String> = ["com.openai.codex", "com.webcatalog.juli.x-chat", "com.google.Chrome.app.lodlkdfmihgonocnmddehnfgiljnadcf", "com.google.Chrome.app.ehpoaimemjameeijlpblkfpomemadkke"]

    private init(selfBundleID: String, enhancementDomain: String, legacyDomain: String,
                 authorityBundleID: String, smartShadowBundleID: String, signing: Signing?) {
        self.selfBundleID = selfBundleID
        self.enhancementDomain = enhancementDomain
        self.legacyDomain = legacyDomain
        self.authorityBundleID = authorityBundleID
        self.smartShadowBundleID = smartShadowBundleID
        self.signing = signing
    }

    public init(compatibilityDictionary fields: [String: Any]) throws {
        let names = ["selfBundleID", "selfTeamID", "enhancementDomain", "legacyDomain",
                     "authorityBundleID", "authorityTeamID", "smartShadowBundleID"]
        guard Set(fields.keys) == Set(names + ["version"]),
              let version = fields["version"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(),
              ["c", "C", "s", "S", "i", "I", "l", "L", "q", "Q"].contains(String(cString: version.objCType)),
              version.compare(NSNumber(value: 1)) == .orderedSame else {
            throw CodexPlusIdentityError.compatibilityInfoInvalid
        }
        let values = try names.map { key -> String in
            guard let value = fields[key] as? String else {
                throw CodexPlusIdentityError.compatibilityInfoInvalid
            }
            let pattern = key.hasSuffix("TeamID")
                ? #"\A[A-Z0-9]{10}\z"#
                : #"\A[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+\z"#
            guard value.range(of: pattern, options: .regularExpression) != nil else {
                throw CodexPlusIdentityError.compatibilityInfoInvalid
            }
            return value
        }
        guard Set([values[0], values[4], values[6]]).count == 3,
              values[2] != values[3] else {
            throw CodexPlusIdentityError.compatibilityInfoInvalid
        }
        self.init(selfBundleID: values[0], enhancementDomain: values[2], legacyDomain: values[3],
                  authorityBundleID: values[4], smartShadowBundleID: values[6],
                  signing: Signing(selfTeamID: values[1], authorityTeamID: values[5]))
    }

    public static func fromInfoDictionary(_ info: [String: Any]) throws -> CodexPlusIdentity {
        guard let raw = info[infoKey] else { return publicDefaults }
        guard let fields = raw as? [String: Any] else {
            throw CodexPlusIdentityError.compatibilityInfoInvalid
        }
        let identity = try CodexPlusIdentity(compatibilityDictionary: fields)
        guard let bundle = info["CFBundleIdentifier"] as? String, bundle == identity.selfBundleID else {
            throw CodexPlusIdentityError.compatibilityInfoInvalid
        }
        return identity
    }

    public var isOperational: Bool { signing != nil }
    public func requireOperational() throws -> Signing {
        guard let signing else { throw CodexPlusIdentityError.compatibilityInputRequired }
        return signing
    }
    public func selfRequirement() throws -> String {
        let selected = try requireOperational()
        return "anchor apple generic and identifier \"\(selfBundleID)\" and certificate leaf[subject.OU] = \"\(selected.selfTeamID)\""
    }
    public func authorityRequirement() throws -> String {
        let selected = try requireOperational()
        return "anchor apple generic and identifier \"\(authorityBundleID)\" and certificate leaf[subject.OU] = \"\(selected.authorityTeamID)\""
    }
    public var protectedBundles: Set<String> {
        Self.fixedThirdPartyProtectedBundles.union([selfBundleID, authorityBundleID, smartShadowBundleID])
    }
}
