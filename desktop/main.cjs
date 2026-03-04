/**
 * Electron main process for Sulala Agent desktop app.
 * Spawns the Node gateway, waits for it to be ready, then opens the dashboard in a window.
 * Build: npm run build && npm run dashboard:build && npm run desktop:pack
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const GATEWAY_PORT = 2026;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const HEALTH_PATH = '/health';

function getAgentRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'agent-app');
  }
  return path.join(__dirname, '..');
}

function getAgentIndexPath(agentRoot) {
  const distIndex = path.join(agentRoot, 'dist', 'index.js');
  if (fs.existsSync(distIndex)) return distIndex;
  return null;
}

function waitForGateway(ms) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    function tryOnce() {
      http.get(`${GATEWAY_URL}${HEALTH_PATH}`, (res) => {
        if (res.statusCode === 200) return resolve(true);
        schedule();
      }).on('error', schedule);

      function schedule() {
        if (Date.now() > deadline) return resolve(false);
        setTimeout(tryOnce, 300);
      }
    }
    tryOnce();
  });
}

let serverProcess = null;

function startServer(agentRoot) {
  const indexPath = getAgentIndexPath(agentRoot);
  if (!indexPath) {
    console.error('Agent dist/index.js not found. Run: npm run build && npm run dashboard:build');
    return Promise.resolve(false);
  }

  const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';
  return new Promise((resolve) => {
    serverProcess = spawn(nodeCmd, [path.join(agentRoot, 'dist', 'index.js')], {
      cwd: agentRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' },
    });

    serverProcess.stdout.on('data', (d) => process.stdout.write(d));
    serverProcess.stderr.on('data', (d) => process.stderr.write(d));
    serverProcess.on('error', (err) => {
      console.error('Failed to start agent:', err);
      resolve(false);
    });
    serverProcess.on('exit', (code, signal) => {
      serverProcess = null;
      if (code != null && code !== 0) console.error('Agent process exited:', code, signal);
    });

    waitForGateway(15000).then(resolve);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Sulala Agent',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { stopServer(); app.quit(); });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(GATEWAY_URL).catch((err) => {
    console.error('Failed to load dashboard:', err);
  });
}

app.whenReady().then(async () => {
  const agentRoot = getAgentRoot();
  const ok = await startServer(agentRoot);
  if (!ok) {
    console.error('Gateway did not become ready. Check that port', GATEWAY_PORT, 'is free.');
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('before-quit', () => stopServer());
