/** Optional Pi packages; only required when AGENT_USE_PI=1 or use_pi=true. */
declare module '@mariozechner/pi-agent-core' {
  export type AgentMessage = unknown;
}
declare module '@mariozechner/pi-ai' {
  export type Model = unknown;
  export type StreamContext = unknown;
  export type StreamOptions = unknown;
  export function streamSimple(...args: unknown[]): unknown;
}
declare module '@mariozechner/pi-coding-agent' {
  export function createAgentSession(options?: unknown): Promise<{ session: unknown }>;
  export const SessionManager: { inMemory(): unknown; create(cwd: string): unknown };
  export const SettingsManager: { create(cwd: string, agentDir: string): unknown };
  export const DefaultResourceLoader: new (opts: unknown) => { reload(): Promise<void> };
  export type ToolDefinition = unknown;
  export type ModelRegistry = unknown;
  export type AuthStorage = unknown;
}
