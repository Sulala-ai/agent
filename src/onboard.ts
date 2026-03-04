/**
 * Onboard: create ~/.sulala, default .env, and optional install daemon (launchd / systemd).
 */
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Package root (where dist/ and bin/ live). When running from dist/onboard.js this is one level up. */
export function getPackageRoot(): string {
  return join(__dirname, '..');
}

export function getSulalaHome(): string {
  return join(homedir(), '.sulala');
}

const DEFAULT_ENV = `# Sulala Agent — created by sulala onboard
# Edit and add API keys as needed. See: https://github.com/schedra/sulala

PORT=2026
HOST=127.0.0.1
DB_PATH=./data/sulala.db

# AI (uncomment and set at least one)
# OPENAI_API_KEY=
# OPENROUTER_API_KEY=
# ANTHROPIC_API_KEY=
# GOOGLE_GEMINI_API_KEY=
# OLLAMA_BASE_URL=http://localhost:11434
`;

export function runOnboard(): { sulalaHome: string; created: string[] } {
  const sulalaHome = getSulalaHome();
  const created: string[] = [];

  if (!existsSync(sulalaHome)) {
    mkdirSync(sulalaHome, { recursive: true });
    created.push(sulalaHome);
  }

  const dataDir = join(sulalaHome, 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    created.push(dataDir);
  }

  const envPath = join(sulalaHome, '.env');
  if (!existsSync(envPath)) {
    writeFileSync(envPath, DEFAULT_ENV, 'utf8');
    created.push(envPath);
  }

  return { sulalaHome, created };
}

function getNodePath(): string {
  try {
    return execSync('which node', { encoding: 'utf8' }).trim();
  } catch {
    return '/usr/bin/env node';
  }
}

/** Open URL in the system default browser (macOS, Linux, Windows). */
export function openBrowser(url: string): void {
  const plat = platform();
  const cmd =
    plat === 'darwin'
      ? 'open'
      : plat === 'win32'
        ? 'start'
        : 'xdg-open';
  try {
    execSync(`${cmd} "${url}"`, { stdio: 'ignore' });
  } catch {
    console.log(`Open in browser: ${url}`);
  }
}

/** Reset onboarding so the dashboard shows OnboardingFlow again (for testing). Uses same config as gateway (~/.sulala/config.json or SULALA_CONFIG_PATH). */
export async function resetOnboarding(): Promise<void> {
  const { setOnboardingComplete } = await import('./agent/skills-config.js');
  setOnboardingComplete(false);
}

/** Open the onboard page (/onboard — shows step-by-step OnboardingFlow when dashboard is present). */
export async function openOnboardPage(opts: { port?: number; delayMs?: number }): Promise<void> {
  const port = opts.port ?? 2026;
  const url = `http://127.0.0.1:${port}/onboard`;
  if (opts.delayMs && opts.delayMs > 0) {
    const plat = platform();
    const openCmd = plat === 'darwin' ? 'open' : plat === 'win32' ? 'start' : 'xdg-open';
    const sec = Math.max(0.5, opts.delayMs / 1000);
    try {
      const { spawn } = await import('child_process');
      const child = spawn(
        plat === 'win32' ? 'cmd' : 'sh',
        plat === 'win32' ? ['/c', `timeout /t ${Math.ceil(sec)} /nobreak >nul && start ${url}`] : ['-c', `sleep ${sec}; ${openCmd} "${url}"`],
        { detached: true, stdio: 'ignore' }
      );
      child.unref();
    } catch {
      openBrowser(url);
    }
  } else {
    openBrowser(url);
  }
}

/** macOS: install launchd user agent so the agent runs at login and stays running. */
function installDaemonDarwin(sulalaHome: string, packageRoot: string): void {
  const nodePath = getNodePath();
  const entryPath = join(packageRoot, 'dist', 'index.js');
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.sulala.agent.plist');
  const logDir = join(sulalaHome, 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sulala.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${entryPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${sulalaHome}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(logDir, 'stdout.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, 'stderr.log')}</string>
</dict>
</plist>
`;
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, plist, 'utf8');
  execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`, { stdio: 'ignore' });
  execSync(`launchctl load "${plistPath}"`, { stdio: 'inherit' });
}

/** Linux: install systemd user service. */
function installDaemonLinux(sulalaHome: string, packageRoot: string): void {
  const entryPath = join(packageRoot, 'dist', 'index.js');
  const nodePath = getNodePath();
  const unitDir = join(homedir(), '.config', 'systemd', 'user');
  const unitPath = join(unitDir, 'sulala-agent.service');
  const logDir = join(sulalaHome, 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const unit = `[Unit]
Description=Sulala Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=${sulalaHome}
ExecStart=${nodePath} ${entryPath}
Restart=on-failure
RestartSec=5
StandardOutput=append:${join(logDir, 'stdout.log')}
StandardError=append:${join(logDir, 'stderr.log')}

[Install]
WantedBy=default.target
`;
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(unitPath, unit, 'utf8');
  execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
  execSync('systemctl --user enable --now sulala-agent.service', { stdio: 'inherit' });
}

export function installDaemon(): void {
  runOnboard(); // ensure ~/.sulala and .env exist
  const sulalaHome = getSulalaHome();
  const packageRoot = getPackageRoot();
  const entryPath = join(packageRoot, 'dist', 'index.js');
  if (!existsSync(entryPath)) {
    throw new Error(
      `Agent entry not found: ${entryPath}. Run from an installed @sulala/agent (e.g. npm i -g @sulala/agent) or build with pnpm build.`
    );
  }

  const plat = platform();
  if (plat === 'darwin') {
    installDaemonDarwin(sulalaHome, packageRoot);
    console.log('Daemon installed. Agent will run at login. Logs: ~/.sulala/logs/');
  } else if (plat === 'linux') {
    installDaemonLinux(sulalaHome, packageRoot);
    console.log('Daemon installed. Agent is running. Logs: ~/.sulala/logs/');
  } else {
    throw new Error(`Daemon install is not supported on ${plat}. Use macOS or Linux.`);
  }
}

/** Stop the agent daemon (does not remove it; use onboard --uninstall-daemon to remove). */
export function stopDaemon(): void {
  const plat = platform();
  if (plat === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.sulala.agent.plist');
    if (existsSync(plistPath)) {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'inherit' });
      console.log('Sulala agent stopped.');
    } else {
      console.log('No daemon found. Agent may not be installed (sulala onboard --install-daemon).');
    }
  } else if (plat === 'linux') {
    const unitPath = join(homedir(), '.config', 'systemd', 'user', 'sulala-agent.service');
    if (existsSync(unitPath)) {
      execSync('systemctl --user stop sulala-agent.service', { stdio: 'inherit' });
      console.log('Sulala agent stopped.');
    } else {
      console.log('No daemon found. Agent may not be installed (sulala onboard --install-daemon).');
    }
  } else {
    throw new Error(`Stop is not supported on ${plat}. Use macOS or Linux.`);
  }
}

/** Start the agent daemon (must be installed first with sulala onboard --install-daemon). */
export function startDaemon(): void {
  const plat = platform();
  if (plat === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.sulala.agent.plist');
    if (existsSync(plistPath)) {
      execSync(`launchctl load "${plistPath}"`, { stdio: 'inherit' });
      console.log('Sulala agent started.');
    } else {
      console.log('No daemon found. Run: sulala onboard --install-daemon');
    }
  } else if (plat === 'linux') {
    const unitPath = join(homedir(), '.config', 'systemd', 'user', 'sulala-agent.service');
    if (existsSync(unitPath)) {
      execSync('systemctl --user start sulala-agent.service', { stdio: 'inherit' });
      console.log('Sulala agent started.');
    } else {
      console.log('No daemon found. Run: sulala onboard --install-daemon');
    }
  } else {
    throw new Error(`Start is not supported on ${plat}. Use macOS or Linux.`);
  }
}

export function uninstallDaemon(): void {
  const plat = platform();
  if (plat === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.sulala.agent.plist');
    if (existsSync(plistPath)) {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'inherit' });
      unlinkSync(plistPath);
      console.log('Daemon uninstalled.');
    } else {
      console.log('No daemon plist found.');
    }
  } else if (plat === 'linux') {
    const unitPath = join(homedir(), '.config', 'systemd', 'user', 'sulala-agent.service');
    if (existsSync(unitPath)) {
      execSync('systemctl --user stop sulala-agent.service', { stdio: 'ignore' });
      execSync('systemctl --user disable sulala-agent.service', { stdio: 'ignore' });
      unlinkSync(unitPath);
      execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
      console.log('Daemon uninstalled.');
    } else {
      console.log('No systemd unit found.');
    }
  } else {
    throw new Error(`Daemon uninstall is not supported on ${plat}.`);
  }
}
