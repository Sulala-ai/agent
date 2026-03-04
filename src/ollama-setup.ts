/**
 * Ensures Ollama is available so the app can use it as the default LLM.
 * If Ollama is not reachable, runs the official install script for the current OS
 * (Mac/Linux: curl | sh, Windows: irm | iex). Install runs in the background so
 * the server can start; users can also install manually from https://ollama.com.
 */

import { spawn } from 'child_process';
import { log } from './db/index.js';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

export type PullProgressCallback = (model: string, line: string, percent: number) => void;
let pullProgressCallback: PullProgressCallback | null = null;

export function setPullProgressCallback(cb: PullProgressCallback | null): void {
  pullProgressCallback = cb;
}

function parsePercent(line: string): number | undefined {
  const m = line.match(/(\d+)%/);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Pull an Ollama model in the background (ollama pull <name>). Output is prefixed with [Ollama pull]; progress is reported via setPullProgressCallback. */
export function pullOllamaModel(modelName: string): void {
  const prefix = '[Ollama pull]';
  const report = (line: string, percent: number) => {
    if (pullProgressCallback) pullProgressCallback(modelName, line, percent);
  };
  report('Starting pull...', 0);
  const child = spawn('ollama', ['pull', modelName], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}` },
  });
  let bufOut = '';
  let bufErr = '';
  const processChunk = (chunk: Buffer | string, buf: string): string => {
    let b = buf + chunk.toString();
    const lines = b.split(/\r?\n/);
    b = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      console.log(`${prefix} ${line}`);
      const pct = parsePercent(line);
      report(line.trim(), pct ?? -1);
    }
    return b;
  };
  child.stdout?.on('data', (chunk: Buffer | string) => {
    bufOut = processChunk(chunk, bufOut);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    bufErr = processChunk(chunk, bufErr);
  });
  child.on('close', (code) => {
    if (bufOut.trim()) console.log(`${prefix} ${bufOut.trim()}`);
    if (bufErr.trim()) console.log(`${prefix} ${bufErr.trim()}`);
    report(code === 0 ? 'Done' : 'Finished', code === 0 ? 100 : -1);
  });
  child.unref();
  console.log(`[Ollama] Pulling model "${modelName}" in background. Try chat again in 1–2 min.`);
}

/** Check if Ollama is already running (e.g. GET /api/tags). */
export async function isOllamaReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Try to start the Ollama server in the background (ollama serve). On ENOENT we don't run install here (caller already did). */
export function startOllamaServe(): void {
  const child = spawn('ollama', ['serve'], {
    stdio: 'ignore',
    detached: true,
    shell: false,
    env: { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}` },
  });
  child.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') {
      console.log('[Ollama] CLI not in PATH yet. Install is running in background; Ollama will start when install finishes.');
      log('ollama-setup', 'info', 'Ollama CLI not in PATH (install already started).');
    }
  });
  child.unref();
  console.log('[Ollama] Started ollama serve in the background.');
  log('ollama-setup', 'info', 'Ollama was not running. Started ollama serve in the background.');
}

/** Start ollama serve for API/onboard: returns Promise with { started: boolean } (does not run install on ENOENT). */
export function startOllamaServeForApi(): Promise<{ started: boolean }> {
  return new Promise((resolve) => {
    const child = spawn('ollama', ['serve'], {
      stdio: 'ignore',
      detached: true,
      shell: false,
    });
    child.on('error', () => {
      resolve({ started: false });
    });
    child.on('spawn', () => {
      child.unref();
      resolve({ started: true });
    });
    child.unref();
  });
}

function pipeWithPrefix(stream: NodeJS.ReadableStream | null, prefix: string): void {
  if (!stream) return;
  let buf = '';
  stream.on('data', (chunk: Buffer | string) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) console.log(`${prefix} ${line}`);
    }
  });
  stream.on('end', () => {
    if (buf.trim()) console.log(`${prefix} ${buf.trim()}`);
  });
}

/** Run the official Ollama install script. On Mac/Linux, runs "install then ollama serve" in one background process so the server starts when install finishes. */
export function runOllamaInstall(): void {
  const platform = process.platform;
  const prefix = '[Ollama install]';
  if (platform === 'win32') {
    const child = spawn('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'irm https://ollama.com/install.ps1 | iex',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    pipeWithPrefix(child.stdout, prefix);
    pipeWithPrefix(child.stderr, prefix);
    child.unref();
    console.log('[Ollama] Windows install started (powershell). See https://ollama.com if needed.');
    log('ollama-setup', 'info', 'Ollama not detected. Started Windows install (powershell). You can also install from https://ollama.com');
  } else if (platform === 'darwin' || platform === 'linux') {
    const child = spawn('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh && exec ollama serve'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}` },
    });
    pipeWithPrefix(child.stdout, prefix);
    pipeWithPrefix(child.stderr, prefix);
    child.unref();
    console.log('[Ollama] Install started; you’ll see install output below. ollama serve will start when install finishes (may take 1–2 min).');
    log('ollama-setup', 'info', 'Ollama not detected. Started install then serve (curl | sh && ollama serve).');
  } else {
    console.log('[Ollama] Unsupported OS. Install from https://ollama.com');
    log('ollama-setup', 'info', 'Ollama not detected. Install manually from https://ollama.com');
  }
}

/**
 * When the app starts: if Ollama is not reachable, run the install script (in background)
 * and try to start the server. So running `npm start` will trigger install when needed.
 * Does not block.
 */
export function ensureOllamaInstalled(): void {
  console.log('[Ollama] Checking if Ollama is running...');
  isOllamaReachable()
    .then((ok) => {
      if (ok) {
        console.log('[Ollama] Already running.');
        return;
      }
      console.log('[Ollama] Not running. Starting install (ollama serve will start when install finishes)...');
      log('ollama-setup', 'info', 'Ollama not running. Starting install and/or ollama serve.');
      runOllamaInstall();
      startOllamaServe();
    })
    .catch(() => {
      console.log('[Ollama] Check failed. Starting install and ollama serve...');
      runOllamaInstall();
      startOllamaServe();
    });
}
