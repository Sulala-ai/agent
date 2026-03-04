/**
 * Unit tests for integration tools: Stripe, Discord, list_integrations_connections.
 * Run with: pnpm test tools.integrations
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { registerBuiltInTools, getTool } from "./tools.js";

// Mock channel config so we don't need real keys or DB
vi.mock("../channels/stripe.js", () => ({
  getEffectiveStripeSecretKey: vi.fn(),
}));
vi.mock("../channels/discord.js", () => ({
  getEffectiveDiscordBotToken: vi.fn(),
}));

// Mock config for list_integrations_connections (portal vs integrations URL)
vi.mock("../config.js", () => ({
  config: {
    integrationsUrl: null as string | null,
    agentToolAllowlist: null,
    agentToolProfile: "full",
  },
  getPortalGatewayBase: vi.fn(() => null as string | null),
  getEffectivePortalApiKey: vi.fn(() => null as string | null),
}));

const mockFetch = vi.fn();

describe("integration tools", () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    registerBuiltInTools(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  describe("stripe_list_customers", () => {
    it("returns error when Stripe is not configured", async () => {
      const { getEffectiveStripeSecretKey } = await import("../channels/stripe.js");
      (getEffectiveStripeSecretKey as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const tool = getTool("stripe_list_customers");
      expect(tool).toBeDefined();
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({});
      expect(result).toEqual({
        error:
          "Stripe is not configured. Add a secret key in Settings → Channels (Stripe) or set STRIPE_SECRET_KEY.",
      });
    });

    it("returns customers when configured and API returns data", async () => {
      const { getEffectiveStripeSecretKey } = await import("../channels/stripe.js");
      (getEffectiveStripeSecretKey as ReturnType<typeof vi.fn>).mockReturnValue("sk_test_xxx");

      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { id: "cus_1", email: "a@example.com", name: "Alice" },
              { id: "cus_2", email: "b@example.com", name: "Bob" },
            ],
          }),
      });

      const tool = getTool("stripe_list_customers");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({});
      expect(result).toEqual({
        customers: [
          { id: "cus_1", email: "a@example.com", name: "Alice" },
          { id: "cus_2", email: "b@example.com", name: "Bob" },
        ],
        count: 2,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stripe.com/v1/customers?limit=10",
        expect.objectContaining({ headers: { Authorization: "Bearer sk_test_xxx" } })
      );
    });

    it("returns error on 401", async () => {
      const { getEffectiveStripeSecretKey } = await import("../channels/stripe.js");
      (getEffectiveStripeSecretKey as ReturnType<typeof vi.fn>).mockReturnValue("sk_bad");
      mockFetch.mockResolvedValueOnce({ status: 401, ok: false });

      const tool = getTool("stripe_list_customers");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({});
      expect(result).toEqual({ error: "Invalid Stripe secret key (unauthorized)" });
    });

    it("respects limit parameter", async () => {
      const { getEffectiveStripeSecretKey } = await import("../channels/stripe.js");
      (getEffectiveStripeSecretKey as ReturnType<typeof vi.fn>).mockReturnValue("sk_test");
      mockFetch.mockResolvedValueOnce({ status: 200, ok: true, json: () => Promise.resolve({ data: [] }) });

      const tool = getTool("stripe_list_customers");
      await (tool!.execute as (args: unknown) => Promise<unknown>)({ limit: 25 });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.stripe.com/v1/customers?limit=25",
        expect.any(Object)
      );
    });
  });

  describe("discord_list_guilds", () => {
    it("returns error when Discord is not configured", async () => {
      const { getEffectiveDiscordBotToken } = await import("../channels/discord.js");
      (getEffectiveDiscordBotToken as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const tool = getTool("discord_list_guilds");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({});
      expect(result).toEqual({
        error:
          "Discord is not configured. Add a bot token in Settings → Channels (Discord) or set DISCORD_BOT_TOKEN.",
      });
    });

    it("returns guilds when configured", async () => {
      const { getEffectiveDiscordBotToken } = await import("../channels/discord.js");
      (getEffectiveDiscordBotToken as ReturnType<typeof vi.fn>).mockReturnValue("bot_token_xxx");

      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "123", name: "My Server" },
            { id: "456", name: "Other Guild" },
          ]),
      });

      const tool = getTool("discord_list_guilds");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({});
      expect(result).toEqual({
        guilds: [
          { id: "123", name: "My Server" },
          { id: "456", name: "Other Guild" },
        ],
        count: 2,
      });
      expect(mockFetch).toHaveBeenCalledWith("https://discord.com/api/v10/users/@me/guilds", {
        headers: { Authorization: "Bot bot_token_xxx" },
      });
    });
  });

  describe("discord_list_channels", () => {
    it("returns error when Discord is not configured", async () => {
      const { getEffectiveDiscordBotToken } = await import("../channels/discord.js");
      (getEffectiveDiscordBotToken as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const tool = getTool("discord_list_channels");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({ guild_id: "123" });
      expect(result).toEqual({
        error:
          "Discord is not configured. Add a bot token in Settings → Channels (Discord) or set DISCORD_BOT_TOKEN.",
      });
    });

    it("returns error when guild_id is missing", async () => {
      const { getEffectiveDiscordBotToken } = await import("../channels/discord.js");
      (getEffectiveDiscordBotToken as ReturnType<typeof vi.fn>).mockReturnValue("token");

      const tool = getTool("discord_list_channels");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({});
      expect(result).toEqual({ error: "guild_id is required" });
    });

    it("returns channels for a guild", async () => {
      const { getEffectiveDiscordBotToken } = await import("../channels/discord.js");
      (getEffectiveDiscordBotToken as ReturnType<typeof vi.fn>).mockReturnValue("token");
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "ch1", name: "general", type: 0 },
            { id: "ch2", name: "voice", type: 2 },
          ]),
      });

      const tool = getTool("discord_list_channels");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({ guild_id: "guild_123" });
      expect(result).toEqual({
        channels: [
          { id: "ch1", name: "general", type: 0 },
          { id: "ch2", name: "voice", type: 2 },
        ],
        count: 2,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/v10/guilds/guild_123/channels",
        expect.objectContaining({ headers: { Authorization: "Bot token" } })
      );
    });
  });

  describe("discord_send_message", () => {
    it("returns error when Discord is not configured", async () => {
      const { getEffectiveDiscordBotToken } = await import("../channels/discord.js");
      (getEffectiveDiscordBotToken as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const tool = getTool("discord_send_message");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({
        channel_id: "ch1",
        content: "hi",
      });
      expect(result).toEqual({
        error:
          "Discord is not configured. Add a bot token in Settings → Channels (Discord) or set DISCORD_BOT_TOKEN.",
      });
    });

    it("returns error when channel_id is missing", async () => {
      const { getEffectiveDiscordBotToken } = await import("../channels/discord.js");
      (getEffectiveDiscordBotToken as ReturnType<typeof vi.fn>).mockReturnValue("token");

      const tool = getTool("discord_send_message");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({ content: "hi" });
      expect(result).toEqual({ error: "channel_id is required" });
    });

    it("sends message and returns message_id", async () => {
      const { getEffectiveDiscordBotToken } = await import("../channels/discord.js");
      (getEffectiveDiscordBotToken as ReturnType<typeof vi.fn>).mockReturnValue("token");
      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () => Promise.resolve({ id: "msg_123" }),
      });

      const tool = getTool("discord_send_message");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({
        channel_id: "ch1",
        content: "Hello from test",
      });
      expect(result).toEqual({ ok: true, message_id: "msg_123" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://discord.com/api/v10/channels/ch1/messages",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bot token", "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Hello from test" }),
        })
      );
    });
  });

  describe("list_integrations_connections", () => {
    it("returns error when Portal and INTEGRATIONS_URL are not set", async () => {
      const { getPortalGatewayBase, getEffectivePortalApiKey } = await import("../config.js");
      (getPortalGatewayBase as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (getEffectivePortalApiKey as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const { config } = await import("../config.js");
      config.integrationsUrl = null;

      const tool = getTool("list_integrations_connections");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({});
      expect(result).toEqual({
        error:
          "Set PORTAL_GATEWAY_URL + PORTAL_API_KEY (from Portal → API Keys) or INTEGRATIONS_URL",
      });
    });

    it("returns connections when Portal gateway responds", async () => {
      const { getPortalGatewayBase, getEffectivePortalApiKey } = await import("../config.js");
      (getPortalGatewayBase as ReturnType<typeof vi.fn>).mockReturnValue("https://portal.example.com");
      (getEffectivePortalApiKey as ReturnType<typeof vi.fn>).mockReturnValue("api_key_xxx");

      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            connections: [
              { connection_id: "conn_linear_1", provider: "linear" },
              { connection_id: "conn_gmail_1", provider: "gmail" },
            ],
          }),
      });

      const tool = getTool("list_integrations_connections");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({});
      expect(result).toEqual({
        connections: [
          { id: "conn_linear_1", provider: "linear" },
          { id: "conn_gmail_1", provider: "gmail" },
        ],
        count: 2,
      });
      expect(mockFetch).toHaveBeenCalledWith("https://portal.example.com/connections", {
        headers: { Authorization: "Bearer api_key_xxx" },
      });
    });

    it("filters by provider when given", async () => {
      const { getPortalGatewayBase, getEffectivePortalApiKey } = await import("../config.js");
      (getPortalGatewayBase as ReturnType<typeof vi.fn>).mockReturnValue("https://portal.example.com");
      (getEffectivePortalApiKey as ReturnType<typeof vi.fn>).mockReturnValue("key");

      mockFetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            connections: [
              { connection_id: "conn_linear_1", provider: "linear" },
              { connection_id: "conn_gmail_1", provider: "gmail" },
            ],
          }),
      });

      const tool = getTool("list_integrations_connections");
      const result = await (tool!.execute as (args: unknown) => Promise<unknown>)({ provider: "linear" });
      expect(result).toEqual({
        connections: [{ id: "conn_linear_1", provider: "linear" }],
        count: 1,
      });
    });
  });
});
