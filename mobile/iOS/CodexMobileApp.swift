import SwiftUI
import WebKit
import UniformTypeIdentifiers
import CryptoKit
import Network

@main struct CodexMobileApp: App {
    var body: some Scene { WindowGroup { MobileView().ignoresSafeArea(.keyboard) } }
}

struct MobileView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> MobileController { MobileController() }
    func updateUIViewController(_ controller: MobileController, context: Context) {}
}

// Only connection status and lifecycle belong to the shell. Working UI is original.
final class MobileController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var web: WKWebView?
    private var socket: NWConnection?
    private let networkQueue = DispatchQueue(label: "codex-mobile.connection")
    private var generation: UInt64 = 0
    private var webGeneration: UInt64 = 0
    private var connectionID = ""
    private var pending = [String]()
    private var ready = false
    private var didNavigate = false
    private let status = UILabel()
    private let reconnect = UIButton(type: .system)
    private let connectionUI = UIStackView()
    private var configuration: [String: Any] = [:]
    private var routeKey: String {
        "codex-mobile.route.v1.\(configuration["fingerprint"] as? String ?? "").\(configuration["hostVersion"] as? String ?? "")"
    }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        status.numberOfLines = 0; status.textAlignment = .center
        reconnect.setTitle("重新连接", for: .normal)
        reconnect.addTarget(self, action: #selector(startConnection), for: .touchUpInside)
        connectionUI.axis = .vertical; connectionUI.spacing = 16
        connectionUI.addArrangedSubview(status); connectionUI.addArrangedSubview(reconnect)
        connectionUI.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(connectionUI)
        NSLayoutConstraint.activate([connectionUI.centerXAnchor.constraint(equalTo: view.centerXAnchor), connectionUI.centerYAnchor.constraint(equalTo: view.centerYAnchor), connectionUI.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 20), connectionUI.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -20)])
        startConnection()
    }
    @objc private func startConnection() {
        // Invalidate every old attempt before configuration, cleanup or bootstrap.
        generation &+= 1; let epoch = generation
        socket?.stateUpdateHandler = nil; socket?.cancel(); socket = nil
        web?.evaluateJavaScript("globalThis.__codexPlusMobileDrafts?.close();globalThis.__codexPlusMobileEndpoint?.close()")
        for name in ["native", "diagnostic", "lifecycle"] { web?.configuration.userContentController.removeScriptMessageHandler(forName: name) }
        web?.navigationDelegate = nil; web?.removeFromSuperview(); web = nil
        pending.removeAll(); ready = false; didNavigate = false; connectionID = ""
        status.text = "正在连接 Mac…"; connectionUI.isHidden = false
        do {
            let file = Bundle.main.url(forResource: "connection", withExtension: "json")!
            configuration = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
            let pin = configuration["fingerprint"] as! String
            guard let url = URL(string: configuration["url"] as! String), url.scheme == "wss", let host = url.host, mobileIPv4(host) != nil,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, pin.count == 64 else { throw NSError(domain: "Mobile", code: 1) }
            let tls = NWProtocolTLS.Options()
            sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
            sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, securityTrust, complete in
                let trust = sec_trust_copy_ref(securityTrust).takeRetainedValue()
                _ = SecTrustEvaluateWithError(trust, nil)
                guard let cert = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first else { complete(false); return }
                let hash = SHA256.hash(data: SecCertificateCopyData(cert) as Data).map { String(format: "%02x", $0) }.joined()
                guard hash == pin else { complete(false); return }
                SecTrustSetAnchorCertificates(trust, [cert] as CFArray)
                SecTrustSetAnchorCertificatesOnly(trust, true)
                SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString))
                complete(SecTrustEvaluateWithError(trust, nil))
            }, networkQueue)
            let params = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
            params.defaultProtocolStack.applicationProtocols.insert(NWProtocolWebSocket.Options(), at: 0)
            let connection = NWConnection(to: .url(url), using: params); socket = connection
            connection.stateUpdateHandler = { [weak self, weak connection] state in
                DispatchQueue.main.async {
                    guard let self, let connection, self.current(epoch, connection) else { return }
                    switch state {
                    case .ready: self.receive(connection, epoch)
                    case .failed, .waiting: self.disconnect("与 Mac 的连接不可用。已提交操作不会自动重发，请在原会话核对结果。", epoch)
                    default: break
                    }
                }
            }
            connection.start(queue: networkQueue)
        } catch { disconnect("连接配置无效，未启动原界面。", epoch) }
    }
    private func current(_ epoch: UInt64, _ connection: NWConnection) -> Bool { generation == epoch && socket === connection }
    private func receive(_ connection: NWConnection, _ epoch: UInt64) {
        guard current(epoch, connection) else { return }
        connection.receiveMessage { [weak self] data, context, _, error in
            let opcode = (context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata)?.opcode
            DispatchQueue.main.async {
                guard let self, self.current(epoch, connection) else { return }
                guard error == nil, opcode != .close else { self.disconnect("与 Mac 的连接已断开。已提交操作不会自动重发，请在原会话核对。", epoch); return }
                if opcode == .text, let data, let text = String(data: data, encoding: .utf8) {
                    do {
                        guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw NSError(domain: "Mobile", code: 4) }
                        if envelope["kind"] as? String == "bootstrap" { try self.loadOriginal(envelope, epoch) }
                        else if self.ready { self.deliver(text, epoch) } else { self.pending.append(text) }
                    } catch {
                        let failure = error as NSError
                        NSLog("CodexMobile bootstrap failed: %@ %d", failure.domain, failure.code)
                        self.disconnect("原界面连接初始化失败，未重试操作。", epoch); return
                    }
                }
                self.receive(connection, epoch)
            }
        }
    }
    private func validRoute(_ route: String) -> Bool {
        guard route.hasPrefix("/"), !route.hasPrefix("//"), let parts = URLComponents(string: route), parts.scheme == nil, parts.host == nil else { return false }
        return parts.path == "/" || parts.path.range(of: #"^/(local|remote)/[a-zA-Z0-9_-]+$"#, options: .regularExpression) != nil
    }
    private func loadOriginal(_ bootstrap: [String: Any], _ epoch: UInt64) throws {
        guard generation == epoch, web == nil, bootstrap["hostVersion"] as? String == configuration["hostVersion"] as? String,
              let connectionID = bootstrap["connection"] as? String else { throw NSError(domain: "Mobile", code: 5) }
        self.connectionID = connectionID
        var localBootstrap = bootstrap
        localBootstrap["localState"] = try MobileUIState(identity: routeKey).read()
        let source = try String(contentsOf: Bundle.main.url(forResource: "mobile-preload", withExtension: "js")!, encoding: .utf8)
        let controller = WKUserContentController()
        for name in ["native", "diagnostic", "lifecycle"] { controller.add(self, name: name) }
        controller.addUserScript(WKUserScript(source: try MobileBootstrapScript.make(localBootstrap, preload: source), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let config = WKWebViewConfiguration(); config.userContentController = controller
        config.setURLSchemeHandler(LocalAssets(), forURLScheme: "app")
        let web = WKWebView(frame: .zero, configuration: config); self.web = web; webGeneration = epoch
        web.isInspectable = true; web.navigationDelegate = self; web.translatesAutoresizingMaskIntoConstraints = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        view.insertSubview(web, belowSubview: connectionUI)
        NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor), web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        let saved = UserDefaults.standard.string(forKey: routeKey)
        let route = saved.flatMap { validRoute($0) ? $0 : nil } ?? configuration["route"] as? String ?? "/"
        var url = URLComponents(string: "app://-/index.html")!
        url.queryItems = [URLQueryItem(name: "initialRoute", value: route)]
        web.load(URLRequest(url: url.url!))
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let epoch = webGeneration
        guard generation == epoch, message.webView === web, message.frameInfo.isMainFrame,
              let frameURL = message.frameInfo.request.url, frameURL.scheme == "app", frameURL.host == "-", frameURL.path == "/index.html" else { return }
        if message.name == "diagnostic" {
            if let value = message.body as? [String: Any], let event = value["event"] as? String, ["script-error", "unhandled-rejection"].contains(event) {
                var fields = [event]
                if let method = value["missingMethod"] as? String, method.range(of: #"^[a-zA-Z][a-zA-Z0-9_.]*$"#, options: .regularExpression) != nil { fields.append("method=" + method) }
                for frame in (value["frames"] as? [[String: Any]] ?? []).prefix(3) {
                    if let file = frame["file"] as? String, file.range(of: #"^[0-9]+\.[a-f0-9]+\.js$"#, options: .regularExpression) != nil,
                       let line = frame["line"] as? Int, let column = frame["column"] as? Int, line >= 0, column >= 0 { fields.append("\(file):\(line):\(column)") }
                }
                NSLog("CodexMobile diagnostic: %@", fields.joined(separator: " "))
            }
            return
        }
        if message.name == "lifecycle" {
            guard let value = message.body as? [String: Any], value["connection"] as? String == connectionID else { return }
            if let operation = value["operation"] as? String {
                if operation.hasPrefix("local-") || operation.hasPrefix("clipboard-") { handleLocalRequest(value, epoch) }
                else { handleAttachmentRequest(value, epoch) }
                return
            }
            guard let route = value["route"] as? String, validRoute(route) else { return }
            UserDefaults.standard.set(route, forKey: routeKey); return
        }
        guard let text = message.body as? String else { return }
        if text == "page-ready" { guard socket != nil else { return }; ready = true; connectionUI.isHidden = true; for value in pending { deliver(value, epoch) }; pending.removeAll(); return }
        guard let socket, current(epoch, socket) else { return }
        let context = NWConnection.ContentContext(identifier: "frame", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
        socket.send(content: Data(text.utf8), contentContext: context, isComplete: true, completion: .contentProcessed { [weak self] error in
            if error != nil { DispatchQueue.main.async { guard let self, self.current(epoch, socket) else { return }; self.disconnect("发送链路断开。请先在原会话核对结果，勿重复提交。", epoch) } }
        })
    }
    private func handleLocalRequest(_ value: [String: Any], _ epoch: UInt64) {
        guard let operation = value["operation"] as? String, let id = value["id"] as? String else { return }
        var reply: [String: Any] = ["id": id, "ok": false]
        var navigate = false
        do {
            switch operation {
            case "local-state-warning":
                // Only protocol key names are diagnostic metadata; never record
                // the associated draft, account data or state value.
                if let key = value["key"] as? String, key.range(of: #"^[a-zA-Z_][a-zA-Z0-9_.-]*$"#, options: .regularExpression) != nil {
                    NSLog("CodexMobile local state failed at key: %@", key)
                } else {
                    let prefix = value["key"] as? String ?? ""
                    let digest = SHA256.hash(data: Data(prefix.utf8)).map { String(format: "%02x", $0) }.joined()
                    NSLog("CodexMobile local state opaque key: hash=%@ length=%d", String(digest.prefix(12)), prefix.count)
                }
                let alert = UIAlertController(title: "页面状态未能保存", message: "请保留当前页面，重新连接前先核对草稿。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "好", style: .default))
                if presentedViewController == nil { present(alert, animated: true) }
            case "local-state-save": try MobileUIState(identity: routeKey).write(value["state"] as Any)
            case "clipboard-read": reply["value"] = UIPasteboard.general.string ?? ""
            case "clipboard-write":
                guard let text = value["text"] as? String else { throw NSError(domain: "MobileLocal", code: 1) }
                UIPasteboard.general.string = text
            case "local-navigate":
                guard let route = value["route"] as? String, validRoute(route) else { throw NSError(domain: "MobileLocal", code: 2) }
                UserDefaults.standard.set(route, forKey: routeKey); reply["value"] = true; navigate = true
            default: throw NSError(domain: "MobileLocal", code: 3)
            }
            reply["ok"] = true
        } catch {
            let failure = error as NSError
            if failure.domain.range(of: #"^[a-zA-Z][a-zA-Z0-9_.-]*$"#, options: .regularExpression) != nil {
                NSLog("CodexMobile local operation failed: %@ %@ %d", operation, failure.domain, failure.code)
            }
            reply["ok"] = false
        }
        guard let web, generation == epoch, let bytes = try? JSONSerialization.data(withJSONObject: [reply]), let literal = String(data: bytes, encoding: .utf8) else { return }
        web.evaluateJavaScript("globalThis.__codexPlusMobileLocal?.resolve(\(literal)[0])") { [weak self, weak web] _, error in
            guard navigate, error == nil, let self, self.generation == epoch, self.web === web else { return }
            self.startConnection()
        }
    }
    private func attachmentRefs(_ value: Any) throws -> [String: Any] {
        guard let refs = value as? [String: Any], Set(refs.keys) == Set(["files", "added", "images", "order"]),
              let files = refs["files"] as? [[String: Any]], let added = refs["added"] as? [[String: Any]],
              let images = refs["images"] as? [[String: Any]], refs["order"] is [String] else { throw NSError(domain: "MobileDrafts", code: 1) }
        for file in files + added {
            guard Set(file.keys).isSubset(of: Set(["label", "path", "fsPath", "startLine", "endLine"])),
                  ["label", "path", "fsPath"].allSatisfy({ file[$0] is String }),
                  ["startLine", "endLine"].allSatisfy({ file[$0] == nil || file[$0] is Int }) else { throw NSError(domain: "MobileDrafts", code: 2) }
        }
        for image in images {
            guard Set(image.keys).isSubset(of: Set(["id", "localPath", "filename"])), image["id"] is String, image["localPath"] is String,
                  image["filename"] == nil || image["filename"] is String else { throw NSError(domain: "MobileDrafts", code: 3) }
        }
        return refs
    }
    private func handleAttachmentRequest(_ value: [String: Any], _ epoch: UInt64) {
        guard let operation = value["operation"] as? String, let id = value["id"] as? String, let key = value["key"] as? String else { return }
        var reply: [String: Any] = ["id": id, "ok": false]
        do {
            if operation == "refs-warning" {
                let alert = UIAlertController(title: "附件草稿未能保存或恢复", message: "请保留当前会话并重新选择附件。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "好", style: .default))
                var parent: UIViewController = self
                while let next = parent.presentedViewController { parent = next }
                if !(parent is UIAlertController) { parent.present(alert, animated: true) }
            } else {
                let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("CodexMobileDrafts", isDirectory: true)
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                let name = SHA256.hash(data: Data((routeKey + "\n" + key).utf8)).map { String(format: "%02x", $0) }.joined()
                let file = root.appendingPathComponent(name + ".json")
                if operation == "refs-get" {
                    let refs: [String: Any]
                    if FileManager.default.fileExists(atPath: file.path) { refs = try attachmentRefs(JSONSerialization.jsonObject(with: Data(contentsOf: file))) }
                    else { refs = ["files": [], "added": [], "images": [], "order": []] }
                    reply["refs"] = refs
                } else if operation == "refs-save" {
                    let refs = try attachmentRefs(value["refs"] as Any)
                    // A completed atomic write is the ACK boundary, including
                    // an empty record. App termination cannot revive an older file.
                    try JSONSerialization.data(withJSONObject: refs).write(to: file, options: .atomic)
                } else { throw NSError(domain: "MobileDrafts", code: 4) }
            }
            reply["ok"] = true
        } catch { reply["ok"] = false }
        guard let web, generation == epoch, let bytes = try? JSONSerialization.data(withJSONObject: [reply]), let literal = String(data: bytes, encoding: .utf8) else { return }
        web.evaluateJavaScript("globalThis.__codexPlusMobileDrafts?.resolve(\(literal)[0])")
    }
    private func deliver(_ text: String, _ epoch: UInt64) {
        guard generation == epoch, let web, let data = try? JSONSerialization.data(withJSONObject: [text]), let literal = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("globalThis.__codexPlusMobileEndpoint.receive(\(literal)[0])") { [weak self, weak web] _, error in
            guard let self, self.generation == epoch, self.web === web else { return }
            if error != nil { self.disconnect("原界面通信失败，连接已停止。", epoch) }
        }
    }
    private func disconnect(_ message: String, _ epoch: UInt64) {
        guard generation == epoch else { return }
        // Keep this document's local draft writes alive while offline. All
        // socket callbacks fail the identity check; reconnect invalidates the
        // entire old document generation before any cleanup or new bootstrap.
        socket?.stateUpdateHandler = nil; socket?.cancel(); socket = nil; ready = false; pending.removeAll()
        web?.evaluateJavaScript("globalThis.__codexPlusMobileEndpoint?.close()")
        web?.isUserInteractionEnabled = false; status.text = message; connectionUI.isHidden = false
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard webView === web, webGeneration == generation else { decisionHandler(.cancel); return }
        let url = navigationAction.request.url
        guard navigationAction.targetFrame?.isMainFrame == true, url?.scheme == "app", url?.host == "-", url?.path == "/index.html", !didNavigate else {
            decisionHandler(.cancel)
            if navigationAction.targetFrame?.isMainFrame == true, didNavigate { disconnect("页面已离开原连接。请重新连接并核对原会话，勿重发未知操作。", webGeneration) }
            return
        }
        didNavigate = true; decisionHandler(.allow)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { if webView === web { disconnect("原界面进程已结束，连接已关闭。", webGeneration) } }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { if webView === web { disconnect("原前端本地资源未能装载。", webGeneration) } }
}

final class LocalAssets: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.url(forResource: "frontend", withExtension: nil)!.standardizedFileURL
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        do {
            guard let url = urlSchemeTask.request.url, url.scheme == "app", url.host == "-" else { throw NSError(domain: "MobileAssets", code: 1) }
            let path = url.path == "/" ? "/index.html" : url.path
            let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
            guard file.path.hasPrefix(root.path + "/") else { throw NSError(domain: "MobileAssets", code: 2) }
            let bytes = try Data(contentsOf: file, options: .mappedIfSafe)
            let ext = file.pathExtension
            let mime = ext == "js" || ext == "mjs" ? "application/javascript" : ext == "wasm" ? "application/wasm" : UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
            let response = URLResponse(url: url, mimeType: mime, expectedContentLength: bytes.count, textEncodingName: ["html", "js", "css", "json", "svg"].contains(ext) ? "utf-8" : nil)
            urlSchemeTask.didReceive(response); urlSchemeTask.didReceive(bytes); urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
