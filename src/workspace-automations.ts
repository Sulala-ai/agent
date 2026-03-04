/**
 * Workspace automations: load from ~/.sulala/workspace/automations.json and run scripts
 * when file events match (watch_folders + optional filter). Script is run with env from
 * workspace/.env and the file path as first argument.
 */
import { readFileSync, existsSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { spawn } from 'child_process';
import { config } from './config.js';
import { log } from './db/index.js';

export interface AutomationEntry {
  id: string;
  script: string;
  watch_folders: string[];
  filter?: string;
}

export interface AutomationsFile {
  automations?: AutomationEntry[];
}

const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)$/i;

function isImage(path: string): boolean {
  return IMAGE_EXT.test(path);
}

function matchesFilter(path: string, filter?: string): boolean {
  if (!filter || filter.toLowerCase() === 'image') return isImage(path);
  return true;
}

export function getAutomationsPath(): string {
  return join(resolve(config.workspaceDir), 'automations.json');
}

export function loadAutomations(): AutomationEntry[] {
  const path = getAutomationsPath();
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as AutomationsFile;
    return Array.isArray(data.automations) ? data.automations : [];
  } catch {
    return [];
  }
}

/** All unique watch_folders from automations.json (for merging with config.watchFolders at startup). */
export function getWatchFoldersFromAutomations(): string[] {
  const list = loadAutomations();
  const set = new Set<string>();
  for (const a of list) {
    for (const f of a.watch_folders || []) {
      if (f?.trim()) set.add(resolve(f.trim()));
    }
  }
  return [...set];
}

/** Run scripts for automations that match this file event. */
export function runMatchingAutomations(event: string, filePath: string): void {
  if (event !== 'add') return;
  const pathResolved = resolve(filePath);
  const automations = loadAutomations();
  const workspaceDir = resolve(config.workspaceDir);

  for (const a of automations) {
    const inFolder = (a.watch_folders || []).some((dir) => {
      const d = resolve(dir);
      return pathResolved === d || pathResolved.startsWith(d + '/');
    });
    if (!inFolder) continue;
    if (!matchesFilter(pathResolved, a.filter)) continue;

    const scriptPath = a.script.startsWith('/') ? a.script : join(workspaceDir, a.script);
    if (!existsSync(scriptPath)) {
      log('automations', 'warn', `Script not found: ${scriptPath}`, { automationId: a.id });
      continue;
    }

    const scriptExt = scriptPath.toLowerCase().slice(scriptPath.lastIndexOf('.'));
    if (['.sh', '.bash', '.py'].includes(scriptExt)) {
      try {
        chmodSync(scriptPath, 0o755);
      } catch {
        // ignore chmod errors (e.g. read-only fs)
      }
    }

    const envPath = join(workspaceDir, '.env');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            const value = trimmed.slice(eq + 1).trim();
            if (key) env[key] = value;
          }
        }
      } catch (e) {
        log('automations', 'warn', `Could not load workspace .env: ${(e as Error).message}`);
      }
    }

    console.log('[automations] Running', a.id, '→', scriptPath, pathResolved);
    const lower = scriptPath.toLowerCase();
    const isSh = lower.endsWith('.sh');
    const isJs = lower.endsWith('.js') || lower.endsWith('.mjs');
    const cmd = isSh ? 'bash' : isJs ? 'node' : scriptPath;
    const argv = isSh ? [scriptPath, pathResolved] : isJs ? [scriptPath, pathResolved] : [pathResolved];
    const child = spawn(cmd, argv, {
      env,
      cwd: workspaceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk) => { out += chunk; });
    child.stderr?.on('data', (chunk) => { err += chunk; });
    child.on('close', (code) => {
      if (code !== 0) {
        console.log('[automations]', a.id, 'failed exit code', code, err.slice(0, 200));
        log('automations', 'error', `Automation ${a.id} script failed`, { scriptPath, code, stderr: err.slice(0, 500) });
      } else {
        console.log('[automations]', a.id, 'completed');
        log('automations', 'info', `Automation ${a.id} completed`, { path: pathResolved });
      }
    });
    child.on('error', (e) => {
      log('automations', 'error', `Automation ${a.id} spawn error`, { scriptPath, error: (e as Error).message });
    });
  }
}
