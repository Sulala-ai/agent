/**
 * MCP client: connect to configured servers (stdio), list tools, register as agent tools.
 * Tool names are prefixed with mcp_<serverName>_ so they don't clash with built-in or skill tools.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getMcpServersConfig, type McpServerConfig } from './config.js';
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
    try {
      await connectServerAndRegisterTools(server);
    } catch (e) {
      log('mcp', 'error', `Failed to load MCP server "${server.name}"`, { error: (e as Error).message });
    }
  }
}

async function connectServerAndRegisterTools(server: McpServerConfig): Promise<void> {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: server.env,
  });
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
