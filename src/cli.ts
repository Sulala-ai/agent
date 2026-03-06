#!/usr/bin/env -S npx tsx
/**
 * Sulala CLI — status, tasks, logs, enqueue, skill install, init.
 */
import 'dotenv/config';
import { execSync } from 'child_process';
import { mkdirSync, existsSync, copyFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getRegistrySkills, installSkill, installSkillFromUrl, updateSkillsAll, uninstallSkill } from './agent/skill-install.js';
import { runOnboard, installDaemon, uninstallDaemon, stopDaemon, startDaemon, openOnboardPage, resetOnboarding } from './onboard.js';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:2026';
const API_KEY = process.env.GATEWAY_API_KEY || '';

function getCliVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(__dirname, '..', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function getLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://registry.npmjs.org/@sulala/agent/latest', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

async function version(checkLatest: boolean): Promise<void> {
  const current = getCliVersion();
  console.log(current);
  if (checkLatest) {
    const latest = await getLatestVersion();
    if (latest) {
      if (latest !== current) {
        console.error(`Latest: ${latest} (sulala update)`);
      }
    }
  }
}

function update(): void {
  execSync('npm update -g @sulala/agent', { stdio: 'inherit' });
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['X-Api-Key'] = API_KEY;
  return h;
}

/** Check if the agent gateway is reachable. */
async function isGatewayUp(): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/health`, {
      headers: headers(),
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** If the agent is not running, start the daemon (if installed) and wait for the gateway to be up. Returns true if gateway is reachable. */
async function ensureAgentStarted(): Promise<boolean> {
  if (await isGatewayUp()) return true;
  startDaemon();
  const maxAttempts = 20;
  const intervalMs = 500;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (await isGatewayUp()) return true;
  }
  return false;
}

async function get(path: string, qs = ''): Promise<unknown> {
  const url = qs ? `${GATEWAY_URL}${path}?${qs}` : `${GATEWAY_URL}${path}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function post(path: string, body: object): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function status(): Promise<void> {
  const data = await get('/health');
  console.log(JSON.stringify(data, null, 2));
}

async function tasks(limit = 50): Promise<void> {
  const data = await get('/api/tasks', `limit=${limit}`);
  console.log(JSON.stringify(data, null, 2));
}

async function logs(limit = 100): Promise<void> {
  const data = await get('/api/logs', `limit=${limit}`);
  console.log(JSON.stringify(data, null, 2));
}

async function skillList(): Promise<void> {
  const skills = await getRegistrySkills();
  console.log(JSON.stringify({ skills }, null, 2));
}

async function skillCheck(): Promise<void> {
  try {
    const data = await get('/api/agent/skills');
    const skills = (data as { skills: Array<{ name: string; status: string; missing?: string[] }> }).skills || [];
    const binsData = (await get('/api/agent/skills/required-bins')) as { bins: string[] };
    const bins = binsData.bins || [];
    let ok = true;
    const blocked = skills.filter((s) => s.status === 'blocked');
    if (blocked.length > 0) {
      ok = false;
      console.error('Blocked skills (missing binaries):');
      for (const s of blocked) {
        console.error(`  - ${s.name}: missing ${(s.missing || []).join(', ')}`);
      }
    }
    const eligible = skills.filter((s) => s.status === 'eligible');
    const unknown = skills.filter((s) => s.status === 'unknown');
    console.log(JSON.stringify({ skills: skills.length, eligible: eligible.length, blocked: blocked.length, unknown: unknown.length, requiredBins: bins }, null, 2));
    if (!ok) process.exit(1);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

async function skillUpdate(): Promise<void> {
  const result = await updateSkillsAll();
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length > 0) process.exit(1);
}

async function skillUninstall(slug: string, global: boolean): Promise<void> {
  const target = global ? 'managed' : 'workspace';
  const result = uninstallSkill(slug, target);
  if (result.success) {
    console.log(JSON.stringify({ uninstalled: slug, path: result.path, target }));
  } else {
    console.error(result.error || 'Uninstall failed');
    process.exit(1);
  }
}

async function skillInstall(slug: string, _global: boolean, registryUrl?: string): Promise<void> {
  // Install from hub always goes to workspace skills dir (~/.sulala/workspace/skills/<slug>/README.md + tools.yaml)
  const target = 'managed';
  const result = await installSkill(slug, target, { registryUrl });
  if (result.success) {
    console.log(JSON.stringify({ installed: slug, path: result.path, target }));
  } else {
    console.error(result.error || 'Install failed');
    process.exit(1);
  }
}

async function skillInstallFromUrl(skillUrl: string, _global: boolean): Promise<void> {
  // Install from URL (hub/store) always goes to workspace skills dir (~/.sulala/workspace/skills), not project context
  const result = await installSkillFromUrl(skillUrl, 'managed');
  if (result.success) {
    console.log(JSON.stringify({ installed: result.slug, path: result.path, target: 'managed' }));
  } else {
    console.error(result.error || 'Install failed');
    process.exit(1);
  }
}

async function doctor(): Promise<void> {
  const issues: string[] = [];
  const ok: string[] = [];
  // Env
  if (!process.env.PORT) ok.push('PORT (default 2026)');
  else ok.push(`PORT=${process.env.PORT}`);
  const aiKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY'];
  const hasAiKey = aiKeys.some((k) => process.env[k]?.trim());
  const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  let hasOllama = false;
  try {
    const r = await fetch(`${ollamaBase}/api/tags`, { signal: AbortSignal.timeout(2000) });
    hasOllama = r.ok;
  } catch {
    // Ollama not running
  }
  if (!hasAiKey && !hasOllama) issues.push('No AI provider: set an API key (OPENAI, ANTHROPIC, OPENROUTER, GEMINI) or run Ollama (default). Install: https://ollama.com');
  else ok.push(hasOllama ? 'Ollama (default) or API keys' : 'AI provider configured');
  // DB
  const dbPath = process.env.DB_PATH || './data/sulala.db';
  const { existsSync } = await import('fs');
  const { resolve } = await import('path');
  const dbFull = resolve(process.cwd(), dbPath);
  if (existsSync(dbFull)) ok.push(`DB exists: ${dbPath}`);
  else issues.push(`DB not found: ${dbPath}`);
  // Gateway
  try {
    await get('/health');
    ok.push(`Gateway reachable: ${GATEWAY_URL}`);
  } catch {
    issues.push(`Gateway not reachable at ${GATEWAY_URL}`);
  }
  // Skills
  try {
    const skillsData = await get('/api/agent/skills');
    const skills = (skillsData as { skills: unknown[] }).skills || [];
    ok.push(`${skills.length} skill(s) loaded`);
  } catch {
    issues.push('Could not fetch skills');
  }
  console.log(JSON.stringify({ ok, issues }, null, 2));
  if (issues.length > 0) process.exit(1);
}

async function init(targetDir: string): Promise<void> {
  const cwd = targetDir || process.cwd();
  const dirs = [join(cwd, 'config'), join(cwd, 'context')];
  for (const d of dirs) {
    if (!existsSync(d)) {
      mkdirSync(d, { recursive: true });
      console.log(`Created ${d}`);
    }
  }
  const envExample = join(cwd, '.env.example');
  const envDest = join(cwd, '.env');
  if (!existsSync(envExample)) {
    console.log('No .env.example found in project root; run init from sulala_agent dir or copy manually.');
    return;
  }
  if (!existsSync(envDest)) {
    copyFileSync(envExample, envDest);
    console.log(`Created ${envDest} from .env.example`);
  } else {
    console.log(`${envDest} already exists`);
  }
  console.log(JSON.stringify({ init: true, dir: cwd }));
}

async function enqueueTask(type: string, payloadStr: string | undefined): Promise<void> {
  let payload: unknown = null;
  if (payloadStr) {
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      throw new Error('--payload must be valid JSON');
    }
  }
  const data = await post('/api/tasks', { type, payload });
  console.log(JSON.stringify(data, null, 2));
}

function parseArgs(): { cmd: string; args: string[]; opts: Record<string, string | true> } {
  const raw = process.argv.slice(2);
  const args: string[] = [];
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i]!;
    if (a.startsWith('--')) {
      const rest = a.slice(2);
      const eqIndex = rest.indexOf('=');
      if (eqIndex === -1) {
        opts[rest] = true;
      } else {
        opts[rest.slice(0, eqIndex)] = rest.slice(eqIndex + 1);
      }
    } else {
      args.push(a);
    }
  }
  return { cmd: args[0] ?? '', args, opts };
}

async function main(): Promise<void> {
  const { cmd, args, opts } = parseArgs();
  const isVersion = !cmd && opts.version || cmd === 'version' || cmd === '-V';
  if (isVersion) {
    await version(!!opts.check);
    process.exit(0);
  }
  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    console.log(`Sulala CLI
  status
  doctor
  tasks [--limit=50]
  logs [--limit=100]
  enqueue --type=NAME [--payload='{"key":"value"}']
  skill list
  skill check
  skill install <slug> [--global] [--registry=URL]
  skill install --from-url=URL [--global]   (for paid skills: use the store install URL with ?license=...)
  skill uninstall <slug> [--global]
  skill update [--all]
  init [dir]
  update  — update global @sulala/agent (npm update -g @sulala/agent)
  onboard [--install-daemon] [--uninstall-daemon] [--reset]
  start   — start the agent daemon (if installed)
  stop    — stop the agent daemon
  version [--check]   — show version; --check compares with latest on npm
  --version, -V       — show version

Env: GATEWAY_URL, GATEWAY_API_KEY, SULALA_SKILLS_DIR, AGENT_CONTEXT_PATH
`);
    process.exit(0);
  }
  try {
    switch (cmd) {
      case 'status':
        await ensureAgentStarted();
        await status();
        break;
      case 'doctor':
        await ensureAgentStarted();
        await doctor();
        break;
      case 'tasks':
        await ensureAgentStarted();
        await tasks(parseInt(String(opts.limit || '50'), 10));
        break;
      case 'logs':
        await ensureAgentStarted();
        await logs(parseInt(String(opts.limit || '100'), 10));
        break;
      case 'enqueue':
        if (!opts.type) throw new Error('enqueue requires --type=NAME');
        await ensureAgentStarted();
        await enqueueTask(String(opts.type), typeof opts.payload === 'string' ? opts.payload : undefined);
        break;
      case 'skill': {
        const sub = args[1] ?? '';
        if (sub === 'list') await skillList();
        else if (sub === 'check') {
          await ensureAgentStarted();
          await skillCheck();
        }
        else if (sub === 'update') await skillUpdate();
        else if (sub === 'install') {
          const fromUrl = typeof opts['from-url'] === 'string' ? opts['from-url'] : undefined;
          let registryUrl = typeof opts.registry === 'string' ? opts.registry : undefined;
          if (fromUrl) {
            await skillInstallFromUrl(fromUrl, !!opts.global);
          } else {
            const slug = args[2];
            if (!slug) throw new Error('skill install requires <slug> or --from-url=URL');
            const hubBase = process.env.SKILLS_REGISTRY_URL?.trim()?.replace(/\/$/, '');
            if (!registryUrl && hubBase) {
              registryUrl = slug.startsWith('system-')
                ? `${hubBase}/api/sulalahub/system/registry`
                : `${hubBase}/api/sulalahub/registry`;
            }
            await skillInstall(slug, !!opts.global, registryUrl);
          }
        } else if (sub === 'uninstall') {
          const slug = args[2];
          if (!slug) throw new Error('skill uninstall requires <slug>');
          await skillUninstall(slug, !!opts.global);
        } else throw new Error(`skill: use 'list', 'install <slug> [--global]', 'uninstall <slug> [--global]', or 'update [--all]'`);
        break;
      }
      case 'init': {
        const dir = args[1] || process.cwd();
        await init(dir);
        break;
      }
      case 'onboard': {
        if (opts['uninstall-daemon']) {
          uninstallDaemon();
        } else {
          if (opts.reset) {
            await resetOnboarding();
            console.log('Onboarding reset. Next dashboard load will show onboarding.');
          }
          const { sulalaHome, created } = runOnboard();
          console.log(JSON.stringify({ sulalaHome, created }, null, 2));
          const port = parseInt(String(process.env.PORT || '2026'), 10);
          if (opts['install-daemon']) {
            installDaemon();
            await openOnboardPage({ port, delayMs: 2500 });
          } else {
            const up = await ensureAgentStarted();
            if (!up) console.log('Starting agent... (run sulala onboard --install-daemon to run at login)');
            await openOnboardPage({ port, delayMs: up ? 0 : 2000 });
            if (!up) console.log('If the agent did not start: sulala onboard --install-daemon');
          }
        }
        break;
      }
      case 'stop':
        stopDaemon();
        break;
      case 'start':
        startDaemon();
        break;
      case 'update':
        update();
        break;
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
