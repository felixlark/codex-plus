import path from 'node:path';
import {execFileSync} from 'node:child_process';

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
    name !== `127.0.0.1:${port}`)) {
    throw Error('Host listener is not exclusively loopback');
  }
}
