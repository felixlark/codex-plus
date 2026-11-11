const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const statePath = process.env.CODEX_PLUS_FIXTURE_STATE;
if (!statePath || !process.env.CODEX_PLUS_FIXTURE_HOME) throw new Error('Fixture paths are required');
app.setPath('userData', process.env.CODEX_PLUS_FIXTURE_HOME);
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port', '0');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let serial = 0;
let generation = 0;
const windows = new Map();
function report() {
  fs.writeFileSync(statePath, JSON.stringify({ pid: process.pid, generation, windows: [...windows.keys()] }));
}
function createWindow() {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const id = ++serial;
  windows.set(id, window);
  window.on('closed', () => { windows.delete(id); report(); });
  window.webContents.on('render-process-gone', () => { generation++; report(); });
  window.loadURL('app://-/index.html');
  report();
  return window;
}
app.whenReady().then(() => {
  protocol.handle('app', request => {
    const url = new URL(request.url);
    const names = new Set(['index.html', 'sidebar-model.mjs', 'scenario-data.json']);
    const name = url.pathname.slice(1);
    if (url.host !== '-' || !names.has(name)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, name)).href);
  });
  createWindow();
  process.on('SIGTERM', () => app.quit());
  process.on('message', message => {
    if (message === 'new-window') createWindow();
    if (message === 'recreate') { for (const window of [...windows.values()]) window.destroy(); createWindow(); }
    if (message === 'crash') [...windows.values()][0]?.webContents.forcefullyCrashRenderer();
    if (message === 'recover') [...windows.values()][0]?.reload();
    if (message === 'quit') app.quit();
  });
});
app.on('window-all-closed', () => {});
