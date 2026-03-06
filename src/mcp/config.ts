/**
 * MCP server configuration. Optional alternative to Integrations (e.g. YouTube, Gmail via MCP).
 * Load from env MCP_SERVERS (JSON array) or ~/.sulala/mcp.json. Dashboard can edit via PUT /api/mcp/config.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface McpServerConfig {
  /** Short name for tool prefix (e.g. "youtube") */
  name: string;
  /** Executable (e.g. "npx") */
  command: string;
  /** Args (e.g. ["-y", "zubeid-youtube-mcp-server"]) */
  args?: string[];
  /** Env vars for the process (e.g. { YOUTUBE_API_KEY: "..." }) */
  env?: Record<string, string>;
}

const SULALA_HOME = join(homedir(), '.sulala');
/** Path to MCP config file. Dashboard writes here via PUT /api/mcp/config. */
export const MCP_CONFIG_PATH = join(SULALA_HOME, 'mcp.json');

export function getMcpServersConfig(): McpServerConfig[] {
  const fromEnv = (process.env.MCP_SERVERS || '').trim();
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeServerConfig).filter((c): c is McpServerConfig => c !== null);
    } catch {
      return [];
    }
  }
  if (existsSync(MCP_CONFIG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf8')) as unknown;
      const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && 'servers' in raw && Array.isArray((raw as { servers: unknown[] }).servers) ? (raw as { servers: unknown[] }).servers : []);
      return (arr as unknown[]).map(normalizeServerConfig).filter((c): c is McpServerConfig => c !== null);
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeServerConfig(raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const command = typeof o.command === 'string' ? o.command.trim() : '';
  if (!name || !command) return null;
  const args = Array.isArray(o.args)
    ? (o.args as unknown[]).map((a) => (typeof a === 'string' ? a : String(a)))
    : undefined;
  const env =
    o.env && typeof o.env === 'object' && !Array.isArray(o.env)
      ? (Object.fromEntries(
          Object.entries(o.env).filter(
            (e): e is [string, string] => typeof e[0] === 'string' && typeof e[1] === 'string'
          )
        ) as Record<string, string>)
      : undefined;
  return { name, command, args, env };
}

/** Same shape as McpServerConfig but env values redacted for display. */
export interface McpServerConfigDisplay {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Get config for API display: env values redacted as "***". */
export function getMcpConfigForDisplay(): { servers: McpServerConfigDisplay[] } {
  const servers = getMcpServersConfig();
  const display = servers.map((s) => ({
    name: s.name,
    command: s.command,
    args: s.args,
    env: s.env ? Object.fromEntries(Object.keys(s.env).map((k) => [k, '***'])) : undefined,
  }));
  return { servers: display };
}

/** Write servers to ~/.sulala/mcp.json. Creates dir if needed. */
export function writeMcpServersConfig(servers: McpServerConfig[]): void {
  const dir = join(MCP_CONFIG_PATH, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const normalized = servers.map(normalizeServerConfig).filter((c): c is McpServerConfig => c !== null);
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify({ servers: normalized }, null, 2), 'utf8');
}
