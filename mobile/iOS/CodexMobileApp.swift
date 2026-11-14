import SwiftUI
import WebKit
import UniformTypeIdentifiers
import CryptoKit

@main struct CodexMobileApp: App {
    var body: some Scene { WindowGroup { MobileView().ignoresSafeArea(.keyboard) } }
}

struct MobileView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> MobileController { MobileController() }
    func updateUIViewController(_ controller: MobileController, context: Context) {}
}

// Only the connection status belongs to the shell. All working UI is original.
final class MobileController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, URLSessionDelegate {
    private var web: WKWebView?
    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var pending = [String]()
    private var ready = false
    private var pin = ""
    private var outgoing: Task<Void, Never>?
    private let status = UILabel()
    private var configuration: [String: Any] = [:]
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        status.numberOfLines = 0; status.text = "正在连接 Mac…"; status.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(status)
        NSLayoutConstraint.activate([status.centerXAnchor.constraint(equalTo: view.centerXAnchor), status.centerYAnchor.constraint(equalTo: view.centerYAnchor), status.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 20)])
        do {
            let url = Bundle.main.url(forResource: "connection", withExtension: "json")!
            configuration = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
            pin = configuration["fingerprint"] as! String
            guard let url = URL(string: configuration["url"] as! String), url.scheme == "wss", let host = url.host, host.hasPrefix("100.") else { throw NSError(domain: "Mobile", code: 1) }
            let config = URLSessionConfiguration.ephemeral
            config.connectionProxyDictionary = [:]
            session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
            socket = session!.webSocketTask(with: url); socket!.resume()
            receive()
        } catch { disconnect("连接配置无效，未启动原界面。") }
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let cert = chain.first else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        let hash = SHA256.hash(data: SecCertificateCopyData(cert) as Data).map { String(format: "%02x", $0) }.joined()
        guard hash == pin else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    private func receive() {
        guard let socket else { return }
        Task { @MainActor in
            do {
                let message = try await socket.receive()
                let text: String
                switch message { case .string(let value): text = value; case .data(let value): guard let value = String(data: value, encoding: .utf8) else { throw NSError(domain: "Mobile", code: 2) }; text = value; @unknown default: throw NSError(domain: "Mobile", code: 3) }
                guard let data = text.data(using: .utf8), let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw NSError(domain: "Mobile", code: 4) }
                if envelope["kind"] as? String == "bootstrap" { try loadOriginal(envelope) }
                else if ready { deliver(text) } else { pending.append(text) }
                receive()
            } catch { disconnect("与 Mac 的连接已断开。已提交操作不会自动重发；重连前请在原会话核对结果。") }
        }
    }
    private func loadOriginal(_ bootstrap: [String: Any]) throws {
        guard web == nil, bootstrap["hostVersion"] as? String == configuration["hostVersion"] as? String else { throw NSError(domain: "Mobile", code: 5) }
        let encoded = try JSONSerialization.data(withJSONObject: bootstrap)
        let literal = String(data: encoded, encoding: .utf8)!
        let source = try String(contentsOf: Bundle.main.url(forResource: "mobile-preload", withExtension: "js")!, encoding: .utf8)
        let controller = WKUserContentController()
        controller.add(self, name: "native"); controller.add(self, name: "diagnostic")
        controller.addUserScript(WKUserScript(source: "globalThis.__codexPlusMobileBootstrap=\(literal);\n" + source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let config = WKWebViewConfiguration(); config.userContentController = controller
        config.setURLSchemeHandler(LocalAssets(), forURLScheme: "app")
        let web = WKWebView(frame: .zero, configuration: config); self.web = web
        web.isInspectable = true; web.navigationDelegate = self; web.translatesAutoresizingMaskIntoConstraints = false
        view.insertSubview(web, belowSubview: status)
        NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor), web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        var url = URLComponents(string: "app://-/index.html")!
        url.queryItems = [URLQueryItem(name: "initialRoute", value: configuration["route"] as? String ?? "/")]
        web.load(URLRequest(url: url.url!))
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "app", message.frameInfo.securityOrigin.host == "-" else { return }
        if message.name == "diagnostic" {
            // No chat contents, payloads, identities or credentials in diagnostics.
            if let value = message.body as? [String: Any], let event = value["event"] as? String { print("CodexMobile diagnostic: \(event)") }
            return
        }
        guard let text = message.body as? String else { return }
        if text == "page-ready" { ready = true; status.isHidden = true; for value in pending { deliver(value) }; pending.removeAll(); return }
        let previous = outgoing
        outgoing = Task { @MainActor in
            await previous?.value
            do { guard let socket else { return }; try await socket.send(.string(text)) }
            catch { disconnect("发送链路断开。请先在原会话核对结果，勿重复提交。") }
        }
    }
    private func deliver(_ text: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [text]), let literal = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("globalThis.__codexPlusMobileEndpoint.receive(\(literal)[0])") { [weak self] _, error in if error != nil { self?.disconnect("原界面通信失败，连接已停止。") } }
    }
    private func disconnect(_ message: String) {
        socket?.cancel(with: .goingAway, reason: nil); socket = nil; ready = false
        web?.evaluateJavaScript("globalThis.__codexPlusMobileEndpoint?.close()")
        web?.isUserInteractionEnabled = false; status.text = message; status.isHidden = false
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.scheme == "app" && url?.host == "-" ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { disconnect("原前端本地资源未能装载。") }
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
