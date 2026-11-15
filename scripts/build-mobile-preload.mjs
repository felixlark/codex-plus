#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encodeMobileValue, decodeMobileValue} from '../Sources/CodexPlus/Resources/mobile-codec.mjs';
import {installMobileEndpoint} from '../Sources/CodexPlus/Resources/mobile-endpoint.mjs';
import {installMobileDrafts} from '../Sources/CodexPlus/Resources/mobile-drafts.mjs';
const cache = path.join(os.homedir(), 'Library/Caches/codex-plus/mobile');
await fs.mkdir(cache, {recursive: true});
const source = `(()=>{
const encode=${encodeMobileValue.toString()}, decode=${decodeMobileValue.toString()};
const b=globalThis.__codexPlusMobileBootstrap;
globalThis.__codexPlusMobileNativeSend=text=>window.webkit.messageHandlers.native.postMessage(text);
(${installMobileEndpoint.toString()})({side:'phone',connection:b.connection,hostVersion:b.hostVersion,snapshot:decode(b.snapshot)},encode,decode);
globalThis.__codexPlusMobileLifecycle = {routeChanged(location) {
  const route = location.pathname + (location.search || '') + (location.hash || '');
  if (location.pathname !== '/' && !/^\\/(local|remote)\\/[a-zA-Z0-9_-]+$/.test(location.pathname)) return;
  window.webkit.messageHandlers.lifecycle.postMessage({connection:b.connection, route});
  globalThis.__codexPlusMobileEndpoint.reportRoute(location.pathname);
}};
(${installMobileDrafts.toString()})(b.connection);
globalThis.__codexPlusMobileNativeSend('page-ready');
window.addEventListener('error',()=>window.webkit.messageHandlers.diagnostic.postMessage({event:'script-error'}));
window.addEventListener('unhandledrejection',()=>window.webkit.messageHandlers.diagnostic.postMessage({event:'unhandled-rejection'}));
})();`;
await fs.writeFile(path.join(cache, 'mobile-preload.js'), source);
console.log('Mobile preload assembled');
