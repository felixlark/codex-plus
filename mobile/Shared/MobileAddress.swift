import Network

func mobileIPv4(_ text: String) -> IPv4Address? {
    guard let address = IPv4Address(text) else { return nil }
    let bytes = Array(address.rawValue)
    guard bytes[0] == 100, bytes[1] >= 64, bytes[1] <= 127 else { return nil }
    return address
}
