#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {isTailIPv4} from '../Sources/CodexPlus/Resources/mobile-access.mjs';
const {values} = parseArgs({options: {thread: {type: 'string'}, port: {type: 'string', default: '54628'}, disable: {type: 'boolean', default: false}}});
if (!values.disable && !/^[a-f0-9-]{36}$/.test(values.thread ?? '')) throw Error('An existing acceptance thread UUID is required');
const port = Number(values.port);
if (!values.disable && (!Number.isInteger(port) || port < 1 || port > 65535)) throw Error('A valid stable gateway port is required');
const file = path.join(os.homedir(), 'Library/Application Support/codex-plus/launcher/mobile.json');
let config = {protocol: 1, enabled: false};
if (!values.disable) {
  const status = JSON.parse(execFileSync('/usr/local/bin/tailscale', ['status', '--json'], {encoding: 'utf8'}));
  const self = status.Self, bind = self?.TailscaleIPs?.find(isTailIPv4);
  if (status.BackendState !== 'Running' || !bind) throw Error('Tailscale IPv4 unavailable');
  config = {protocol: 1, enabled: true, bind, port, nodeId: String(self.ID), userId: String(self.UserID), threadId: values.thread, anchor: randomUUID()};
}
await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
await fs.writeFile(file, JSON.stringify(config), {mode: 0o600});
console.log(JSON.stringify({enabled: config.enabled, note: 'Applied when the single Plus controller next starts'}));
