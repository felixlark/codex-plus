import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import {spawn, execFileSync, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {mobileHost} from './mobile-host.mjs';
import {encodeMobileValue, decodeMobileValue} from './mobile-codec.mjs';
import {installMobileEndpoint} from './mobile-endpoint.mjs';

const run = promisify(execFile);
const binding = '__codexPlusMobileOutbound';
export function isTailIPv4(text) {
  const parts = String(text).split('.');
  return parts.length === 4 && parts.every(p => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255) && Number(parts[0]) === 100 && Number(parts[1]) >= 64 && Number(parts[1]) <= 127;
}
export function isAnchorURL(text, config) {
  try {
    const url = new URL(text), route = new URL(url.searchParams.get('initialRoute'), 'https://route.invalid');
    return url.protocol === 'app:' && url.hostname === '-' && url.pathname === '/index.html' && route.pathname === `/local/${config.threadId}` && route.searchParams.get('codexPlusMobileAnchor') === config.anchor;
  } catch { return false; }
}
export async function mobileHostSupported(archive) {
  for (const [name, expected] of [['.vite/build/preload.js', mobileHost.preloadSHA256], ['webview/index.html', mobileHost.indexSHA256]]) {
    const entry = archive.entries.find(e => e.path === name);
    if (!entry || createHash('sha256').update(await archive.read(entry)).digest('hex') !== expected) return false;
  }
  return true;
}

export class MobileAccess {
  static async create(options) {
    let config;
    try { config = JSON.parse(await fs.readFile(path.join(path.dirname(options.stateFile), 'mobile.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw Error('Invalid mobile configuration'); }
    if (config.enabled !== true) return null;
    if (config.protocol !== 1 || !isTailIPv4(config.bind) || !/^[a-zA-Z0-9]+$/.test(String(config.nodeId)) || !/^\d+$/.test(String(config.userId)) || !/^[a-f0-9-]{36}$/.test(config.threadId) || !/^[a-f0-9-]{36}$/.test(config.anchor)) throw Error('Invalid mobile configuration');
    if (!options.supported) throw Error('Mobile host version unsupported');
    const {stdout} = await run('/usr/local/bin/tailscale', ['status', '--json']);
    const self = JSON.parse(stdout).Self;
    if (!self?.TailscaleIPs?.includes(config.bind) || String(self.ID) !== String(config.nodeId) || String(self.UserID) !== String(config.userId)) throw Error('Mobile Tailscale identity changed');
    return new MobileAccess(config, options);
  }
  constructor(config, {cdp, command, sessions, stateFile, publish}) {
    this.config = config; this.cdp = cdp; this.command = command; this.sessions = sessions; this.publish = publish;
    this.stateFile = stateFile; this.clients = new Map(); this.phase = 'waiting-for-anchor'; this.anchorSession = null;
    this.stopped = false; this.creationAttempted = false; this.busy = false;
  }
  status() { return {phase: this.phase, hostVersion: mobileHost.version, connections: this.clients.size, anchorReady: !this.stopped && !!this.anchorSession, port: this.port ?? null}; }
  isAnchorURL(url) { return isAnchorURL(url, this.config); }
  async interceptDocument(id, event) {
    if (!this.isAnchorURL(event.request.url) || event.resourceType !== 'Document') return false;
    await this.command(id, 'Fetch.fulfillRequest', {requestId: event.requestId, responseCode: 200, responseHeaders: [{name: 'Content-Type', value: 'text/html; charset=utf-8'}, {name: 'Content-Security-Policy', value: "default-src 'none'"}], body: Buffer.from('<!doctype html><html><head><title>Codex Plus Mobile</title></head><body>Codex Plus 移动接入专用窗口</body></html>').toString('base64')});
    this.anchorSession = id; this.phase = 'anchor-loading'; return true;
  }
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const {targetInfos} = await this.cdp.call('Target.getTargets');
      const anchors = targetInfos.filter(t => t.type === 'page' && this.isAnchorURL(t.url));
      if (anchors.length > 1) throw Error('Ambiguous mobile anchor');
      if (anchors.length) {
        const session = [...this.sessions].find(([, s]) => s.target === anchors[0].targetId);
        if (!session) return;
        this.anchorTarget = anchors[0].targetId; this.anchorSession = session[0];
        const result = await this.evaluate('({preload:!!window.electronBridge,ui:!!document.querySelector("script[src]")})');
        if (!result.preload || result.ui) throw Error('Mobile anchor preload isolation unavailable');
        if (!this.gateway) await this.startGateway();
      } else if (!this.creationAttempted) {
        const source = [...this.sessions].find(([, s]) => s.main);
        if (!source) return;
        this.creationAttempted = true; this.phase = 'creating-anchor';
        const route = `/local/${this.config.threadId}?codexPlusMobileAnchor=${this.config.anchor}`;
        await this.command(source[0], 'Runtime.evaluate', {expression: `window.electronBridge.sendMessageFromView(${JSON.stringify({type: 'open-in-new-window', path: route})})`, awaitPromise: true});
      } else if (this.anchorSession || this.gateway) throw Error('Mobile anchor lost');
    } catch { this.phase = 'unavailable'; await this.close(); }
    finally { this.busy = false; }
  }
  async evaluate(expression, awaitPromise = false) {
    if (!this.anchorSession || !this.sessions.has(this.anchorSession)) throw Error('Mobile anchor unavailable');
    const result = await this.command(this.anchorSession, 'Runtime.evaluate', {expression, returnByValue: true, awaitPromise});
    if (result.exceptionDetails) throw Error('Mobile anchor failed'); return result.result.value;
  }
  async startGateway() {
    const gatewayPath = fileURLToPath(new URL('./MobileGateway', import.meta.url));
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', '-R=anchor apple generic and identifier "me.longbiaochen.codex-plus.mobile-gateway" and certificate leaf[subject.OU] = "HJG65XBC25"', gatewayPath], {stdio: 'pipe'});
    this.gateway = spawn(gatewayPath, ['--bind', this.config.bind], {stdio: ['pipe', 'pipe', 'pipe']});
    this.gateway.stderr.resume();
    this.gateway.once('exit', () => { if (!this.stopped) { this.phase = 'gateway-exited'; void this.close(); } });
    this.gateway.once('error', () => { this.phase = 'gateway-failed'; void this.close(); });
    const lines = readline.createInterface({input: this.gateway.stdout});
    lines.on('line', line => { void this.gatewayEvent(line).catch(() => { this.phase = 'connection-failed'; void this.close(); }); });
    this.phase = 'gateway-starting';
  }
  send(id, message) {
    if (this.stopped || !this.gateway?.stdin.writable) return;
    this.gateway.stdin.write(JSON.stringify({type: 'send', id, text: JSON.stringify(message)}) + '\n');
  }
  async gatewayEvent(line) {
    const event = JSON.parse(line);
    if (this.stopped) return;
    if (event.type === 'listening') {
      this.port = event.port; this.phase = 'listening';
      const client = {url: `wss://${this.config.bind}:${event.port}`, fingerprint: event.fingerprint, hostVersion: mobileHost.version, route: `/local/${this.config.threadId}`};
      const file = path.join(os.homedir(), 'Library/Caches/codex-plus/mobile/connection.json');
      await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
      await fs.writeFile(file + '.tmp', JSON.stringify(client), {mode: 0o600}); await fs.rename(file + '.tmp', file);
    } else if (event.type === 'connected') {
      // Exclusive anchor ownership, not a concurrency/resource quota.
      if (this.clients.size || !isTailIPv4(event.peer)) { this.drop(event.id); return; }
      const client = {id: event.id, phase: 'authenticating'}; this.clients.set(event.id, client);
      const {stdout} = await run('/usr/local/bin/tailscale', ['whois', '--json', event.peer]);
      const who = JSON.parse(stdout);
      if (String(who.Node?.StableID) !== String(this.config.nodeId) || String(who.UserProfile?.ID) !== String(this.config.userId)) { await this.release(event.id); return; }
      if (this.stopped || this.clients.get(event.id) !== client) return;
      await this.command(this.anchorSession, 'Runtime.addBinding', {name: binding});
      const connection = randomUUID(); client.connection = connection;
      const source = `globalThis.__codexPlusMobileEndpoint?.close();delete globalThis.__codexPlusMobileEndpoint;(${installMobileEndpoint.toString()})(${JSON.stringify({side: 'host', connection})},${encodeMobileValue.toString()},${decodeMobileValue.toString()});(${encodeMobileValue.toString()})((()=>{const b=window.electronBridge;return {version:b.getSentryInitOptions().appVersion,theme:b.getSystemThemeVariant(),sentry:b.getSentryInitOptions(),buildFlavor:b.getBuildFlavor(),userAgent:b.getDesktopUserAgent(),appSessionId:b.getAppSessionId(),sidebar:b.getInitialSidebarBootstrap()};})())`;
      const snapshot = await this.evaluate(source, true);
      if (this.stopped || this.clients.get(event.id) !== client) return;
      client.phase = 'active'; this.phase = 'connected';
      this.send(event.id, {kind: 'bootstrap', connection, hostVersion: mobileHost.version, snapshot});
    } else if (event.type === 'frame') {
      const client = this.clients.get(event.id);
      if (client?.phase !== 'active') { this.drop(event.id); return; }
      const value = JSON.parse(event.text);
      if (value.kind === 'fatal') { await this.release(event.id); return; }
      await this.evaluate(`globalThis.__codexPlusMobileEndpoint.receive(${JSON.stringify(event.text)})`);
    } else if (event.type === 'closed') await this.release(event.id);
    else if (event.type === 'failed') throw Error('Mobile gateway failed');
    await this.publish();
  }
  async onBinding(message) {
    if (this.stopped || message.params.name !== binding || message.sessionId !== this.anchorSession) return;
    const session = this.sessions.get(message.sessionId), context = session?.contexts.get(message.params.executionContextId);
    if (!context?.auxData?.isDefault || context.auxData.frameId !== session.frame) return;
    const client = [...this.clients.values()].find(c => c.phase === 'active'); if (!client) return;
    const value = JSON.parse(message.params.payload);
    if (value.kind === 'fatal') { await this.release(client.id); return; }
    this.send(client.id, value);
  }
  drop(id) { if (this.gateway?.stdin.writable) this.gateway.stdin.write(JSON.stringify({type: 'close', id}) + '\n'); }
  async release(id) {
    const client = this.clients.get(id); if (!client) return;
    this.clients.delete(id); this.drop(id);
    await this.evaluate('globalThis.__codexPlusMobileEndpoint?.close();delete globalThis.__codexPlusMobileEndpoint').catch(() => {});
    if (!this.stopped) this.phase = 'listening';
  }
  contextLost(id) { if (id === this.anchorSession && this.gateway) { this.phase = 'anchor-lost'; void this.close(); } }
  async close() {
    if (this.stopped) return; this.stopped = true;
    for (const id of this.clients.keys()) await this.release(id);
    this.gateway?.stdin.end();
    if (this.anchorTarget) await this.cdp.call('Target.closeTarget', {targetId: this.anchorTarget}).catch(() => {});
  }
}
