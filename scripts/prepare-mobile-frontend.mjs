#!/usr/bin/env node
// Vendor assets remain in the personal build cache, never in this repository.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {openAsar} from './inspect-sidebar-model.mjs';
import {mobileHost} from '../Sources/CodexPlus/Resources/mobile-host.mjs';
import {adaptMobileFrontend} from './mobile-frontend-adapter.mjs';
export {mobileHost};
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function localAssetPath(root, relative) {
  if (!relative || relative.includes('\\') || path.posix.isAbsolute(relative) || relative.split('/').some(p => p === '..' || !p)) throw Error('Invalid asset path');
  return path.join(root, relative);
}

export async function prepareFrontend({app, output}) {
  const archive = await openAsar(app);
  try {
    const read = async name => {
      const entry = archive.entries.find(e => e.path === name);
      if (!entry) throw Error(`Missing host resource: ${name}`);
      return archive.readBytes(entry);
    };
    const pkg = JSON.parse((await read('package.json')).toString());
    if (pkg.version !== mobileHost.version || digest(await read('.vite/build/preload.js')) !== mobileHost.preloadSHA256 || digest(await read('webview/index.html')) !== mobileHost.indexSHA256) throw Error('Unreviewed Codex host; keep the previous mobile build');
    for (const [name, expected] of Object.entries(mobileHost.nativeSHA256)) {
      if (digest(await read(name)) !== expected) throw Error('Unreviewed Codex native host; keep the previous mobile build');
    }
    const assets = [];
    for (const entry of archive.entries.filter(e => e.path.startsWith('webview/'))) {
      const relative = entry.path.slice('webview/'.length);
      const destination = localAssetPath(output, relative);
      const bytes = await archive.readBytes(entry), sha256 = digest(bytes);
      if (entry.integrity?.algorithm !== 'SHA256' || sha256 !== entry.integrity.hash) throw Error(`Host integrity mismatch: ${entry.path}`);
      await fs.mkdir(path.dirname(destination), {recursive: true});
      const shipped = await adaptMobileFrontend(relative, bytes);
      await fs.writeFile(destination, shipped);
      assets.push({path: relative, bytes: bytes.length, sha256, ...shipped !== bytes ? {shippedBytes: shipped.length, shippedSHA256: digest(shipped), adapter: ({'index.html': 'phone-input-typography', 'assets/async/486887.8844429c7e.js': 'original-browser-attachment-picker', 'assets/async/757723.3067c948bc.js': 'original-router-location', 'assets/async/907538.0572f09d40.js': 'original-sidebar-default', 'assets/async/149364.fd50fe6b4a.js': 'original-sidebar-trigger'})[relative]} : {}});
    }
    const manifest = {protocol: 1, host: mobileHost, assets};
    await fs.writeFile(path.join(output, 'codex-mobile-manifest.json'), JSON.stringify(manifest));
    return {host: pkg.version, files: assets.length, bytes: assets.reduce((n, a) => n + a.bytes, 0), output};
  } finally { await archive.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options: {app: {type: 'string', default: '/Applications/ChatGPT.app'}, output: {type: 'string', default: path.join(os.homedir(), 'Library/Caches/codex-plus/mobile/frontend')}}});
  console.log(JSON.stringify(await prepareFrontend(values)));
}
