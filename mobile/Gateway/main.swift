import Foundation
import Network
import Security

// A child of the existing Plus controller. It carries frames only; the controller
// authenticates Tailscale peers and owns the original Electron connection.
let arguments = CommandLine.arguments
guard let at = arguments.firstIndex(of: "--bind"), arguments.indices.contains(at + 1),
      let address = IPv4Address(arguments[at + 1]), arguments[at + 1].hasPrefix("100.") else {
    fputs("Expected a Tailscale IPv4 bind address\n", stderr); exit(2)
}
let queue = DispatchQueue(label: "codex-plus.mobile.gateway")
let outputLock = NSLock()
func emit(_ message: [String: Any]) {
    guard let bytes = try? JSONSerialization.data(withJSONObject: message) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    FileHandle.standardOutput.write(bytes + Data([10]))
}
let (identity, fingerprint) = try MobileIdentity.load()
let tls = NWProtocolTLS.Options()
sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
sec_protocol_options_set_local_identity(tls.securityProtocolOptions, sec_identity_create(identity)!)
let parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
let websocket = NWProtocolWebSocket.Options(); websocket.autoReplyPing = true
parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(address), port: .any)
let listener = try NWListener(using: parameters)
var connections = [String: NWConnection]()
func receive(_ id: String, _ connection: NWConnection) {
    connection.receiveMessage { bytes, _, _, error in
        if let bytes, let text = String(data: bytes, encoding: .utf8) { emit(["type": "frame", "id": id, "text": text]) }
        if error == nil, connections[id] != nil { receive(id, connection) }
        else { connections.removeValue(forKey: id); emit(["type": "closed", "id": id]) }
    }
}
listener.newConnectionHandler = { connection in
    let id = UUID().uuidString
    connections[id] = connection
    connection.stateUpdateHandler = { state in
        switch state {
        case .ready:
            if case .hostPort(let host, _) = connection.endpoint { emit(["type": "connected", "id": id, "peer": "\(host)"]) }
            else { connection.cancel(); return }
            receive(id, connection)
        case .failed, .cancelled: connections.removeValue(forKey: id); emit(["type": "closed", "id": id])
        default: break
        }
    }
    connection.start(queue: queue)
}
listener.stateUpdateHandler = { state in
    switch state {
    case .ready: emit(["type": "listening", "port": listener.port!.rawValue, "fingerprint": fingerprint])
    case .failed: emit(["type": "failed"]); exit(1)
    default: break
    }
}
listener.start(queue: queue)
DispatchQueue.global().async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = message["id"] as? String else { continue }
        queue.async {
            guard let connection = connections[id] else { return }
            if message["type"] as? String == "close" { connection.cancel(); return }
            guard message["type"] as? String == "send", let text = message["text"] as? String else { return }
            let context = NWConnection.ContentContext(identifier: "frame", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
            connection.send(content: Data(text.utf8), contentContext: context, isComplete: true, completion: .contentProcessed { error in if error != nil { connection.cancel() } })
        }
    }
    queue.async { listener.cancel(); connections.values.forEach { $0.cancel() }; exit(0) }
}
dispatchMain()
