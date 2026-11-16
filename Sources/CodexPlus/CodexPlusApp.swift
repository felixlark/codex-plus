import AppKit
import ApplicationServices
import CodexPlusCore
import Darwin
import SwiftUI

@main
final class CodexPlusApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private static var retainedDelegate: CodexPlusApp?
    private let observer = CodexWorkspaceObserver()
    private let statusServer = StatusServer()
    private let toolWindows = ToolWindowRouter()
    private let toolServer = ToolControlServer()
    private let management = ManagementRuntime()
    private let settings = SettingsModel()
    private let launcher = CodexLauncher()
    private var statusItem: NSStatusItem?
    private var settingsWindow: NSWindow?
    private var runtimeLease: Int32 = -1

    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        if args == ["--help"] { print("CodexPlus [--settings | --open-codex | --status | --tool-status]");return }
        do { _ = try CodexPlusIdentity.current.requireOperational() }
        catch { fputs("Codex Plus compatibility input is required for product operations.\n", stderr); exit(1) }
        if LifecycleCommand.run(args) { return }
        if args.first?.hasPrefix("--tool-") == true {
            do { FileHandle.standardOutput.write(try ToolControlChannel.request(ToolCommand.parse(args)!)) }
            catch { fputs("Codex Plus tool unavailable.\n", stderr); exit(1) }; return
        }
        if args == ["--status"] { do { FileHandle.standardOutput.write(try StatusChannel.readStatus()) } catch { fputs("Codex Plus status unavailable.\n",stderr);exit(1) };return }
        guard args.isEmpty || args == ["--settings"] || args == ["--open-codex"], SuggestionAcceptance.isValidOrAbsent,
              Bundle.main.bundleIdentifier == CodexPlusInstallation.bundleID,
              Bundle.main.bundleURL.path == CodexPlusInstallation.path else { fputs("Use the installed standalone Codex Plus app.\n",stderr);return }
        do { try FileManager.default.createDirectory(at: EnhancementPaths.root, withIntermediateDirectories:true) } catch { return }
        let fd = Darwin.open(EnhancementPaths.root.appendingPathComponent("runtime.lock").path,O_CREAT|O_RDWR|O_NOFOLLOW|O_CLOEXEC,0o600)
        guard fd >= 0, flock(fd,LOCK_EX|LOCK_NB)==0 else { if fd >= 0 { close(fd) };return }
        let app=NSApplication.shared, delegate=CodexPlusApp();delegate.runtimeLease=fd
        retainedDelegate=delegate;app.delegate=delegate;app.setActivationPolicy(.accessory);app.run()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        settings.onEnabledChange = { [weak self] in self?.observer.stop();self?.observer.start() }
        settings.onSuggestionChange = { [weak self] in guard let self else{return};self.launcher.setAutoSendSuggestions(self.settings.autoSendSuggestions) }
        settings.onDisplaySelectionChange = { [weak self] in self?.observer.displaySelectionDidChange() }
        settings.readDisplayDecision = { [weak self] in self?.observer.displayDecision() }
        settings.readToolRouting = { [weak self] in guard let self else{return(false,false,"等待连接")};return(self.toolWindows.enabled,self.toolWindows.chromeUsesAgentDisplay,self.toolWindows.displaySummary) }
        settings.onToolRoutingChange = { [weak self] in self?.toolWindows.setEnabled($0) }
        settings.onChromeRoutingChange = { [weak self] in self?.toolWindows.setChromeUsesAgentDisplay($0) }
        toolWindows.openOwnSettings = { [weak self] in self?.showSettings() }
        launcher.onOpenSettings = { [weak self] in self?.showSettings() }
        launcher.onOwnership = { [weak self] scope in self?.observer.authorize(scope) }
        observer.refreshAuthorization = { completion in
            Task { let scope = try? await HostOwnershipClient.read(); completion(scope) }
        }
        toolWindows.start();observer.start()
        management.readSettings = { [weak self] in guard let self,let selection=CodexWorkspaceDisplayPreference.load() else{throw ManagementProtocol.failure("settings_unavailable")};return .init(workspaceAutoExpand:CodexWorkspacePreference.enabled,autoSendSuggestions:self.settings.autoSendSuggestions,workspaceAutoExpandDisplaySelection:selection,agentToolWindowsEnabled:self.toolWindows.enabled,chromeUsesAgentDisplay:self.toolWindows.chromeUsesAgentDisplay) }
        management.writeSettings = { [weak self] in self?.settings.applyManagement($0) }
        management.readComponents = { [weak self] in self?.launcher.runtimeComponents() ?? [:] }
        management.readStatus = { [weak self] in ["launcher":self?.launcher.status() ?? [:]] }
        management.prepareStop = { [weak self] in guard let self else{throw ManagementProtocol.failure("unavailable")};self.observer.stop();_ = try self.toolWindows.prepareLifecycle();return try await self.launcher.prepareLifecycle() }
        management.resumeLifecycle = { [weak self] in guard let self else{throw ManagementProtocol.failure("unavailable")};try await self.launcher.resumeLifecycle();self.toolWindows.resumeLifecycle();self.observer.start() }
        management.verifyPreparedScope = { [weak self] in await self?.launcher.verifyLifecycleScope($0) ?? false }
        management.stopLifecycle = { NSApp.terminate(nil) }
        management.performAction = { [weak self] op in guard let self else{throw ManagementProtocol.failure("unavailable")};if op == .openCodex {self.launcher.open()}else if op == .reconnect{try self.launcher.requestEnhancementReconnect()} }
        try? toolServer.start { [weak self] value in guard let self else{return .init(["ok":false])};if value["command"] as? String == ManagementProtocol.command{return await self.management.handle(value)};return .init(self.toolWindows.command(value)) }
        try? statusServer.start { [weak self] in ["workspace":self?.observer.status() ?? [:],"launcher":self?.launcher.status() ?? [:]] }
        statusItem=NSStatusBar.system.statusItem(withLength:NSStatusItem.squareLength)
        if let url=Bundle.main.url(forResource:"MenuBarIcon",withExtension:"pdf"),let image=NSImage(contentsOf:url){image.isTemplate=true;statusItem?.button?.image=image}else{statusItem?.button?.title="+"}
        let menu=NSMenu();menu.delegate=self
        menu.addItem(NSMenuItem(title:"打开 Codex",action:#selector(openCodex),keyEquivalent:""))
        menu.addItem(NSMenuItem(title:"设置…",action:#selector(showSettings),keyEquivalent:","))
        menu.addItem(.separator());menu.addItem(NSMenuItem(title:"退出 Codex Plus",action:#selector(quit),keyEquivalent:"q"));menu.items.forEach{$0.target=self};statusItem?.menu=menu
        launcher.start()
        if CommandLine.arguments.contains("--settings"){showSettings()}
        if CommandLine.arguments.contains("--open-codex"){launcher.open()}
    }
    func menuWillOpen(_ menu:NSMenu){settings.refresh()}
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows flag:Bool)->Bool{showSettings();return true}
    @objc private func showSettings(){
        settings.refresh()
        if settingsWindow == nil {let window=NSWindow(contentRect:NSRect(x:0,y:0,width:560,height:620),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false);window.title="Codex Plus";window.isReleasedWhenClosed=false;window.contentView=NSHostingView(rootView:SettingsView(model:settings,catalog:settings.catalog,launcher:launcher));settingsWindow=window}
        guard let window=settingsWindow,toolWindows.prepareAgentWindow(window) else{return};window.orderFront(nil);toolWindows.registerAgentWindow(window)
    }
    @objc private func openCodex(){launcher.open()}
    @objc private func quit(){NSApp.terminate(nil)}
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply{observer.stop();guard toolWindows.stop() else{return .terminateCancel};return launcher.stop{NSApp.reply(toApplicationShouldTerminate:true)} ? .terminateLater : .terminateNow}
    func applicationWillTerminate(_ notification:Notification){observer.stop();statusServer.stop();toolServer.stop();_ = toolWindows.stop();if runtimeLease >= 0 {close(runtimeLease)}}
}
