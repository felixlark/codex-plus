import Foundation
import Network
import Security

// A child of the existing Plus controller. It carries frames only; the controller
// authenticates Tailscale peers and owns the original Electron connection.
let arguments = CommandLine.arguments
guard let at = arguments.firstIndex(of: "--bind"), arguments.indices.contains(at + 1),
      mobileIPv4(arguments[at + 1]) != nil else {
    fputs("Expected a Tailscale IPv4 bind address\n", stderr); exit(2)
}
let queue = DispatchQueue(label: "codex-plus.mobile.gateway")
let outputLock = NSLock()
func emit(_ message: [String: Any]) {
    guard let bytes = try? JSONSerialization.data(withJSONObject: message) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    FileHandle.standardOutput.write(bytes + Data([10]))
}
let (identity, fingerprint) = try MobileIdentity.load(address: arguments[at + 1])
let tls = NWProtocolTLS.Options()
sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
sec_protocol_options_set_local_identity(tls.securityProtocolOptions, sec_identity_create(identity)!)
let parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
let websocket = NWProtocolWebSocket.Options(); websocket.autoReplyPing = true
parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(IPv4Address("127.0.0.1")!), port: .any)
let listener = try NWListener(using: parameters)
var ingress: MobileIngress?
var connections = [String: NWConnection]()
func receive(_ id: String, _ connection: NWConnection) {
    connection.receiveMessage { bytes, context, _, error in
        let opcode = (context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata)?.opcode
        if opcode == .close { connection.cancel(); return }
        if opcode == .text, let bytes, let text = String(data: bytes, encoding: .utf8) { emit(["type": "frame", "id": id, "text": text]) }
        if error == nil, connections[id] != nil { receive(id, connection) }
        else { connections.removeValue(forKey: id); emit(["type": "closed", "id": id]) }
    }
}
listener.newConnectionHandler = { connection in
    guard let ingress, let claim = ingress.claim(connection, generation: ingress.generation) else { connection.cancel(); return }
    let id = claim.id.uuidString
    connections[id] = connection
    connection.stateUpdateHandler = { state in
        switch state {
        case .ready:
            if ingress.active(claim.id, connection: connection) { emit(["type": "connected", "id": id, "peer": claim.peer]) }
            else { connection.cancel(); return }
            receive(id, connection)
        case .failed: connection.cancel()
        case .cancelled: ingress.cancelled(claim.id, connection: connection); connections.removeValue(forKey: id); emit(["type": "closed", "id": id])
        default: break
        }
    }
    connection.start(queue: queue)
    if !claim.active { connection.cancel() }
}
listener.stateUpdateHandler = { state in
    switch state {
    case .ready:
        do { ingress = try MobileIngress(address: arguments[at + 1], internalPort: listener.port!.rawValue, queue: queue); emit(["type": "listening", "port": ingress!.port, "internalPort": listener.port!.rawValue, "fingerprint": fingerprint]) } catch { emit(["type": "failed"]); exit(1) }
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
    queue.async { listener.cancel(); ingress?.stop(); connections.values.forEach { $0.cancel() }; exit(0) }
}
dispatchMain()
