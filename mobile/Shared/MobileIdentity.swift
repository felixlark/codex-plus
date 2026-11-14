import Foundation
import Security
import CryptoKit

// Dedicated, nonexported TLS key. No login, signing identity or vendor token reuse.
enum MobileIdentity {
    static let label = "Codex Plus Mobile TLS v1"
    static func load() throws -> (SecIdentity, String) {
        var item: CFTypeRef?
        let query: [String: Any] = [kSecClass as String: kSecClassIdentity, kSecAttrLabel as String: label, kSecReturnRef as String: true]
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess {
            let identity = item as! SecIdentity
            var cert: SecCertificate?; SecIdentityCopyCertificate(identity, &cert)
            return (identity, fingerprint(SecCertificateCopyData(cert!) as Data))
        }
        let tag = Data("me.longbiaochen.codex-plus.mobile.tls.v1".utf8)
        var error: Unmanaged<CFError>?
        let attrs: [String: Any] = [kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: true, kSecAttrApplicationTag as String: tag, kSecAttrLabel as String: label]]
        guard let key = SecKeyCreateRandomKey(attrs as CFDictionary, &error), let pub = SecKeyCopyPublicKey(key),
              let raw = SecKeyCopyExternalRepresentation(pub, &error) as Data? else { throw failure("TLS key creation") }
        let algorithm = seq(oid([1,2,840,10045,4,3,2]))
        let name = seq(set(seq(oid([2,5,4,3]) + der(0x0c, Data("Codex Plus Mobile".utf8)))))
        let now = Date(), end = Calendar(identifier: .gregorian).date(byAdding: .year, value: 1, to: now)!
        let publicKey = seq(seq(oid([1,2,840,10045,2,1]) + oid([1,2,840,10045,3,1,7])) + der(0x03, Data([0]) + raw))
        let serial = Data([0x01]) + Data(SHA256.hash(data: raw).prefix(15))
        let tbs = seq(der(0xa0, der(0x02, Data([2]))) + der(0x02, serial) + algorithm + name + seq(time(now.addingTimeInterval(-300)) + time(end)) + name + publicKey)
        guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, tbs as CFData, &error) as Data? else { throw failure("TLS certificate signature") }
        let bytes = seq(tbs + algorithm + der(0x03, Data([0]) + signature))
        guard let cert = SecCertificateCreateWithData(nil, bytes as CFData) else { throw failure("TLS certificate") }
        let status = SecItemAdd([kSecClass as String: kSecClassCertificate, kSecValueRef as String: cert, kSecAttrLabel as String: label] as CFDictionary, nil)
        guard status == errSecSuccess || status == errSecDuplicateItem else { throw failure("TLS certificate storage") }
        var identity: SecIdentity?
        guard SecIdentityCreateWithCertificate(nil, cert, &identity) == errSecSuccess, let identity else { throw failure("TLS identity") }
        return (identity, fingerprint(bytes))
    }
    static func fingerprint(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private static func failure(_ text: String) -> NSError { NSError(domain: "CodexMobile", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    private static func der(_ tag: UInt8, _ bytes: Data) -> Data {
        var size = bytes.count, length = Data()
        if size < 128 { length.append(UInt8(size)) } else {
            var encoded = [UInt8](); while size > 0 { encoded.insert(UInt8(size & 255), at: 0); size >>= 8 }
            length.append(0x80 | UInt8(encoded.count)); length.append(contentsOf: encoded)
        }
        return Data([tag]) + length + bytes
    }
    private static func seq(_ bytes: Data) -> Data { der(0x30, bytes) }
    private static func set(_ bytes: Data) -> Data { der(0x31, bytes) }
    private static func oid(_ numbers: [Int]) -> Data {
        var result = Data([UInt8(numbers[0] * 40 + numbers[1])])
        for var n in numbers.dropFirst(2) {
            var bytes = [UInt8(n & 127)]; n >>= 7
            while n > 0 { bytes.insert(0x80 | UInt8(n & 127), at: 0); n >>= 7 }
            result.append(contentsOf: bytes)
        }
        return der(0x06, result)
    }
    private static func time(_ date: Date) -> Data {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0); f.dateFormat = "yyMMddHHmmss'Z'"
        return der(0x17, Data(f.string(from: date).utf8))
    }
}
