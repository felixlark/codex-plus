import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';

export function parentIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

export function parseEndpoint(text) {
  const [port, route] = text.trim().split('\n');
  if (!/^\d+$/.test(port) || !/^\/devtools\/browser\/[^\s/?#]+$/.test(route ?? '')) return null;
  try {
    const url = new URL(`ws://127.0.0.1:${port}${route}`);
    return {port: url.port, endpoint: url.href};
  } catch { return null; }
}

export function verifyHost({app, profile, pid, endpoint}, run = execFileSync) {
  const executable = path.join(app, 'Contents/MacOS/ChatGPT');
  const command = run('/bin/ps', ['-p', String(pid), '-o', 'comm='], {encoding: 'utf8'}).trim();
  if (command !== executable) throw Error('Host executable mismatch');
  if (profile) {
    const args = run('/bin/ps', ['-p', String(pid), '-o', 'args='], {encoding: 'utf8'}).trim();
    const value = `--user-data-dir=${path.join(profile, 'user-data')}`;
    if (!args.endsWith(' ' + value) && !args.includes(' ' + value + ' ')) throw Error('Host profile mismatch');
  }
  const port = new URL(endpoint).port;
  const output = run('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'], {encoding: 'utf8'});
  const names = output.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
  // Preserve the existing loopback-only invariant for every listener, including
  // processes bound to both localhost and a specific non-wildcard LAN address.
  if (!names.includes(`127.0.0.1:${port}`) || names.some(name =>
    !/^127\.\d+\.\d+\.\d+:\d+$/.test(name) && !/^\[::1\]:\d+$/.test(name))) {
    throw Error('Host listener is not exclusively loopback');
  }
}

export async function launchHost({app, profile, environment = process.env, timeoutMs = 30000}, deps = {}) {
  const run = deps.run ?? execFileSync, readFile = deps.readFile ?? fs.readFile;
  const now = deps.now ?? Date.now, sleep = deps.pause ?? pause;
  const userData = profile ? path.join(profile, 'user-data') :
    environment.CODEX_ELECTRON_USER_DATA_PATH || path.join(os.homedir(), 'Library/Application Support/Codex');
  const endpointFile = path.join(userData, 'DevToolsActivePort');
  const before = new Set(run('/bin/ps', ['-axo', 'pid=,comm='], {encoding: 'utf8'}).split('\n')
    .map(line => line.trim().match(/^(\d+)\s+(.+)$/)).filter(match => match?.[2] === path.join(app, 'Contents/MacOS/ChatGPT')).map(match => Number(match[1])));
  let previous = '';
  try { previous = await readFile(endpointFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = {...environment};
  const args = ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'];
  if (profile) {
    args.push(`--user-data-dir=${userData}`);
    env.CODEX_HOME = path.join(profile, 'codex-home'); env.CODEX_ELECTRON_USER_DATA_PATH = userData;
  }
  // LaunchServices starts the signed app as an application, rather than as a
  // child executable whose automation requests can be attributed to Codex Plus.
  const openArgs = ['-n', '--stdout', '/dev/null', '--stderr', '/dev/null'];
  for (const key of ['CODEX_HOME', 'CODEX_ELECTRON_USER_DATA_PATH']) {
    if (env[key] !== undefined) openArgs.push('--env', `${key}=${env[key]}`);
  }
  openArgs.push(app, '--args', ...args);
  run('/usr/bin/open', openArgs, {stdio: 'pipe'});
  const deadline = now() + timeoutMs; // Same startup timeout as the prior stderr handshake.
  while (now() < deadline) {
    let text;
    try { text = await readFile(endpointFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parsed = text && text !== previous ? parseEndpoint(text) : null;
    if (parsed) {
      let output = '';
      try { output = run('/usr/sbin/lsof', ['-nP', '-t', `-iTCP:${parsed.port}`, '-sTCP:LISTEN'], {encoding: 'utf8'}); }
      catch (error) { if (error.status !== 1) throw error; }
      const pids = [...new Set(output.trim().split(/\s+/).filter(value => /^\d+$/.test(value)).map(Number))];
      const fresh = pids.filter(pid => !before.has(pid));
      if (fresh.length) {
        if (pids.length !== 1 || fresh.length !== 1) throw Error('Ambiguous host listener');
        const result = {pid: fresh[0], endpoint: parsed.endpoint};
        verifyHost({app, profile, ...result}, run);
        return result;
      }
    }
    await sleep(25);
  }
  throw Error('Host debug listener timeout');
}
