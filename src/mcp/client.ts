/**
 * MCP client: connect to configured servers (stdio), list tools, register as agent tools.
 * Tool names are prefixed with mcp_<serverName>_ so they don't clash with built-in or skill tools.
 */
import { existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { homedir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getMcpServersConfig, getMcpConfigForDisplay, writeMcpServersConfig, type McpServerConfig } from './config.js';
import { log } from '../db/index.js';
import { registerTool, unregisterTools } from '../agent/tools.js';
import type { ToolDef } from '../types.js';

const MCP_TOOL_PREFIX = 'mcp_';

/** Agent tool name -> executor that calls the MCP server and returns result for the agent. */
const mcpExecutors = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

/** Names we registered so we can unregister on refresh. */
let registeredMcpToolNames: string[] = [];

function safeServerName(name: string): string {
  return name.replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'mcp';
}

function agentToolName(serverName: string, mcpToolName: string): string {
  return `${MCP_TOOL_PREFIX}${safeServerName(serverName)}_${mcpToolName}`;
}

/** Convert MCP tool result content to a string/object for the agent. */
function resultForAgent(result: { content?: Array<{ type?: string; text?: string }>; [k: string]: unknown }): unknown {
  const content = result?.content;
  if (!Array.isArray(content) || content.length === 0) return result;
  const texts = content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => (c as { text: string }).text);
  if (texts.length === 1) return texts[0];
  if (texts.length > 1) return texts.join('\n\n');
  return result;
}

/** If server runs a local script (e.g. npx tsx /path/to/index.ts), return the resolved script path; else null. */
function getLocalScriptPath(server: McpServerConfig): string | null {
  const args = server.args ?? [];
  for (const a of args) {
    const s = String(a).trim();
    if (!s || s.startsWith('-')) continue;
    if (s.endsWith('.ts') || s.endsWith('.js') || s.endsWith('.mjs')) {
      const expanded = s.startsWith('~') ? resolve(homedir(), s.slice(1)) : resolve(s);
      return expanded;
    }
  }
  return null;
}

/** Test an MCP server project by spawning it, connecting, and calling listTools. Returns success or error message. */
export async function testMcpServer(projectDir: string): Promise<{ success: boolean; error?: string }> {
  const dir = projectDir.startsWith('~') ? resolve(homedir(), projectDir.slice(1)) : resolve(projectDir);
  const indexPath = join(dir, 'index.ts');
  if (!existsSync(indexPath)) {
    return { success: false, error: `index.ts not found in ${projectDir}` };
  }
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'tsx', indexPath],
    cwd: dir,
  });
  const client = new Client({ name: 'sulala-mcp-test', version: '1.0.0' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    await client.connect(transport, { signal: controller.signal });
    await client.listTools();
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  } finally {
    clearTimeout(timeout);
    try {
      await transport.close();
    } catch { /* ignore */ }
  }
}

/** If server runs a script under ~/.sulala/mcp-servers/, return that project directory path for cleanup; else null. */
export function getMcpServerProjectDir(server: McpServerConfig): string | null {
  const scriptPath = getLocalScriptPath(server);
  if (!scriptPath) return null;
  const mcpServersDir = join(homedir(), '.sulala', 'mcp-servers');
  if (!scriptPath.startsWith(mcpServersDir)) return null;
  return dirname(scriptPath);
}

export async function loadAndRegisterMcpTools(): Promise<void> {
  const servers = getMcpServersConfig();
  if (servers.length === 0) return;

  // Unregister any previously loaded MCP tools
  if (registeredMcpToolNames.length > 0) {
    unregisterTools(registeredMcpToolNames);
    registeredMcpToolNames = [];
    mcpExecutors.clear();
  }

  for (const server of servers) {
    const scriptPath = getLocalScriptPath(server);
    if (scriptPath && !existsSync(scriptPath)) {
      log('mcp', 'warn', `Skipping MCP server "${server.name}": script not found (create it first via Build with AI or remove the entry)`, { path: scriptPath });
      continue;
    }
    try {
      await connectServerAndRegisterTools(server);
    } catch (e) {
      log('mcp', 'error', `Failed to load MCP server "${server.name}"`, { error: (e as Error).message });
    }
  }
}

async function connectServerAndRegisterTools(server: McpServerConfig): Promise<void> {
  const projectDir = getMcpServerProjectDir(server);
  const transportOptions: { command: string; args: string[]; env?: Record<string, string>; cwd?: string } = {
    command: server.command,
    args: server.args ?? [],
    env: server.env,
  };
  if (projectDir && existsSync(projectDir)) {
    transportOptions.cwd = projectDir;
  }
  const transport = new StdioClientTransport(transportOptions);
  const client = new Client({ name: 'sulala-agent', version: '1.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  if (!tools?.length) {
    log('mcp', 'info', `MCP server "${server.name}" has no tools`);
    return;
  }

  const serverName = safeServerName(server.name);
  for (const tool of tools) {
    const name = typeof tool.name === 'string' ? tool.name : '';
    if (!name) continue;
    const agentName = agentToolName(server.name, name);
    const description = typeof tool.description === 'string' ? tool.description : `MCP tool: ${name}`;
    const inputSchema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object' as const, properties: {} };
    const properties = (inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const required = (inputSchema as { required?: string[] }).required ?? [];

    mcpExecutors.set(agentName, async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      return resultForAgent(result as { content?: Array<{ type?: string; text?: string }> });
    });

    const toolDef: ToolDef = {
      name: agentName,
      description: `[MCP ${serverName}] ${description}`,
      profile: 'full',
      parameters: {
        type: 'object',
        properties,
        required,
      },
      execute: async (args) => {
        const fn = mcpExecutors.get(agentName);
        if (!fn) return { error: 'MCP tool no longer available' };
        return fn(args);
      },
    };
    registerTool(toolDef);
    registeredMcpToolNames.push(agentName);
  }
  log('mcp', 'info', `MCP server "${server.name}" loaded`, { tools: tools.length });
}

export function getRegisteredMcpToolNames(): string[] {
  return [...registeredMcpToolNames];
}

/** Re-load MCP config and re-register tools. Call after saving config from dashboard. */
export const refreshMcpTools = loadAndRegisterMcpTools;

/** Register the list_mcp_servers tool so the agent can answer "what MCP servers do we have". */
export function registerListMcpServersTool(): void {
  registerTool({
    name: 'list_mcp_servers',
    description:
      'List configured MCP servers (name, command, args). Use when the user asks what MCP servers are configured, which MCP servers we have, or similar. Returns servers from ~/.sulala/mcp.json or MCP_SERVERS env. Env values are redacted.',
    profile: 'full',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const { servers } = getMcpConfigForDisplay();
      return { servers, count: servers.length };
    },
  });
}

/** Register the add_mcp_server tool so the agent can add a server to ~/.sulala/mcp.json and reload tools. */
export function registerAddMcpServerTool(): void {
  registerTool({
    name: 'add_mcp_server',
    description:
      'Add an MCP server to Sulala so it becomes available as tools (mcp_<name>_<tool>). Use when the user asks to add or build an MCP server. Provide name (short id, e.g. gmail), command (e.g. npx or node), args (e.g. [-y, package-name] or path to script), and optional env with placeholder values for API keys the user must fill in.',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short server name (e.g. gmail, youtube). Used as tool prefix mcp_<name>_*.' },
        command: { type: 'string', description: 'Executable (e.g. npx, node)' },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments (e.g. ["-y", "package-name"] for npx, or ["/path/to/index.js"] for node)',
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Optional env vars (e.g. GMAIL_CLIENT_ID, API_KEY). Use placeholder like "your-key-here" if user must fill in.',
        },
        icon: { type: 'string', description: 'Optional: Simple Icons slug (e.g. gmail, youtube) or image URL' },
        credentialsUrl: {
          type: 'string',
          description: 'Optional: URL to official docs on where/how to get API keys (e.g. https://developers.google.com/gmail/api/quickstart/nodejs). Shown as "Get keys" in the dashboard.',
        },
      },
      required: ['name', 'command'],
    },
    execute: async (args) => {
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      const command = typeof args.command === 'string' ? args.command.trim() : '';
      if (!name || !command) return { error: 'name and command are required' };
      const argsList = Array.isArray(args.args) ? (args.args as unknown[]).map((a) => String(a)) : undefined;
      let env: Record<string, string> | undefined;
      if (args.env && typeof args.env === 'object' && !Array.isArray(args.env)) {
        env = {};
        for (const [k, v] of Object.entries(args.env)) {
          if (typeof k === 'string' && typeof v === 'string') env[k] = v;
        }
        if (Object.keys(env).length === 0) env = undefined;
      }
      const icon = typeof args.icon === 'string' ? args.icon.trim() || undefined : undefined;
      const credentialsUrl = typeof args.credentialsUrl === 'string' ? args.credentialsUrl.trim() || undefined : undefined;
      const current = getMcpServersConfig();
      if (current.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
        return { error: `MCP server "${name}" already exists. Use a different name or edit in Settings → MCP.` };
      }
      const entry: McpServerConfig = { name, command };
      if (argsList?.length) entry.args = argsList;
      if (env && Object.keys(env).length) entry.env = env;
      if (icon) entry.icon = icon;
      if (credentialsUrl) entry.credentialsUrl = credentialsUrl;
      const scriptPath = getLocalScriptPath(entry);
      if (scriptPath && !existsSync(scriptPath)) {
        return {
          error: `Script not found: ${scriptPath}. Create the MCP server files first (write_file to ~/.sulala/mcp-servers/${name}/package.json and index.ts), run npm install there, then call add_mcp_server again.`,
        };
      }
      writeMcpServersConfig([...current, entry]);
      await loadAndRegisterMcpTools();
      log('mcp', 'info', `MCP server added via agent: ${name}`);
      return { added: name, message: `MCP server "${name}" added. Tools will appear as mcp_${name}_* after reload.` };
    },
  });
}

/** Register the test_mcp_server tool so the agent can verify a server works before adding it. */
export function registerTestMcpServerTool(): void {
  registerTool({
    name: 'test_mcp_server',
    description:
      'Test an MCP server project by spawning it and listing its tools. Use after writing MCP server files and running npm install, before add_mcp_server. Pass projectDir (e.g. ~/.sulala/mcp-servers/gmail). Returns { success: true } or { success: false, error: string }.',
    profile: 'full',
    parameters: {
      type: 'object',
      properties: {
        projectDir: { type: 'string', description: 'Path to MCP server project (e.g. ~/.sulala/mcp-servers/gmail)' },
      },
      required: ['projectDir'],
    },
    execute: async (args) => {
      const projectDir = typeof args.projectDir === 'string' ? args.projectDir.trim() : '';
      if (!projectDir) return { error: 'projectDir is required' };
      return testMcpServer(projectDir);
    },
  });
}
