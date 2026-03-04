import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fetchChannelsTelegram,
  updateChannelsTelegram,
  fetchChannelsDiscord,
  updateChannelsDiscord,
  fetchChannelsStripe,
  updateChannelsStripe,
  fetchConfig,
  fetchAgentModels,
  type TelegramChannelState,
  type DiscordChannelState,
  type StripeChannelState,
  type Config,
  type AgentModel,
} from "@/lib/api";
import { ExternalLink, Send } from "lucide-react";

const DISCORD_INVITE_DOCS = "https://discord.com/developers/applications";
const STRIPE_DASHBOARD = "https://dashboard.stripe.com/apikeys";

export function ChannelsPage() {
  const [state, setState] = useState<TelegramChannelState | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [dmPolicy, setDmPolicy] = useState<"open" | "allowlist" | "disabled">("open");
  const [allowFromStr, setAllowFromStr] = useState("");
  const [defaultProvider, setDefaultProvider] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [telegramModels, setTelegramModels] = useState<AgentModel[]>([]);
  const [telegramModelsLoading, setTelegramModelsLoading] = useState(false);

  const [discordState, setDiscordState] = useState<DiscordChannelState | null>(null);
  const [discordBotToken, setDiscordBotToken] = useState("");
  const [discordSaving, setDiscordSaving] = useState(false);

  const [stripeState, setStripeState] = useState<StripeChannelState | null>(null);
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeSaving, setStripeSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, discordData, stripeData, cfg] = await Promise.all([
        fetchChannelsTelegram(),
        fetchChannelsDiscord(),
        fetchChannelsStripe(),
        fetchConfig(),
      ]);
      setState(data);
      setDiscordState(discordData);
      setStripeState(stripeData);
      setConfig(cfg);
      setEnabled(data.enabled);
      setBotToken(""); // never show token
      setDmPolicy((data.dmPolicy as "open" | "allowlist" | "disabled") || "open");
      setAllowFromStr(
        Array.isArray(data.allowFrom) ? data.allowFrom.join(", ") : ""
      );
      setDefaultProvider(data.defaultProvider ?? "");
      setDefaultModel(data.defaultModel ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!defaultProvider || (defaultProvider !== "ollama" && defaultProvider !== "openrouter")) {
      setTelegramModels([]);
      return;
    }
    setTelegramModelsLoading(true);
    fetchAgentModels(defaultProvider)
      .then((r) => setTelegramModels(r.models ?? []))
      .catch(() => setTelegramModels([]))
      .finally(() => setTelegramModelsLoading(false));
  }, [defaultProvider]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const allowFrom = allowFromStr
        .split(/[,;\s]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
      const body: {
        enabled: boolean;
        botToken?: string | null;
        dmPolicy: "open" | "allowlist" | "disabled";
        allowFrom: number[];
        defaultProvider?: string | null;
        defaultModel?: string | null;
      } = {
        enabled,
        dmPolicy,
        allowFrom,
        defaultProvider: defaultProvider.trim() || null,
        defaultModel: defaultModel.trim() || null,
      };
      if (botToken.trim()) body.botToken = botToken.trim();
      const data = await updateChannelsTelegram(body);
      setState(data);
      setBotToken("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDiscord = async () => {
    setDiscordSaving(true);
    setError(null);
    try {
      const data = await updateChannelsDiscord({
        botToken: discordBotToken.trim() || null,
      });
      setDiscordState(data);
      setDiscordBotToken("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscordSaving(false);
    }
  };

  const handleSaveStripe = async () => {
    setStripeSaving(true);
    setError(null);
    try {
      const data = await updateChannelsStripe({
        secretKey: stripeSecretKey.trim() || null,
      });
      setStripeState(data);
      setStripeSecretKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStripeSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">Loading channels…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Telegram</CardTitle>
          <CardDescription>
            Connect your device to Telegram so you can chat with the agent from your phone.
            Create a bot with @BotFather, then paste the token below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state && (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                {state.status === "connected" && state.botUsername ? (
                  <span className="text-green-600 dark:text-green-400">
                    Connected as @{state.botUsername}
                  </span>
                ) : state.configured ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    Not connected
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not configured</span>
                )}
              </div>
              {state.error && (
                <p className="text-destructive text-xs">
                  {state.error}
                </p>
              )}
              {state.configured && !state.botUsername && !state.error && (
                <p className="text-muted-foreground text-xs">
                  Click Save or Reconnect to start the bot. Use “Anyone” under Who can DM if you want to receive messages.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="telegram-enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <label htmlFor="telegram-enabled" className="text-sm font-medium">
              Enable Telegram channel
            </label>
          </div>

          <div className="space-y-2">
            <label htmlFor="telegram-token" className="text-sm font-medium">
              Bot token
            </label>
            <Input
              id="telegram-token"
              type="password"
              placeholder={state?.configured ? "(already set)" : "123456789:ABC…"}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              autoComplete="off"
              className="font-mono text-sm"
            />
            <p className="text-muted-foreground text-xs">
              Get a token from @BotFather in Telegram. Leave blank to keep the current token.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="telegram-dm-policy" className="text-sm font-medium">
              Who can DM the bot
            </label>
            <select
              id="telegram-dm-policy"
              value={dmPolicy}
              onChange={(e) =>
                setDmPolicy(e.target.value as "open" | "allowlist" | "disabled")
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="open">Anyone</option>
              <option value="allowlist">Only allowlist (set IDs below)</option>
              <option value="disabled">Disabled</option>
            </select>
            {dmPolicy === "disabled" && (
              <p className="text-muted-foreground text-xs">
                Bot can still connect; it won’t reply to any DMs. Choose Anyone to chat from Telegram.
              </p>
            )}
          </div>

          {dmPolicy === "allowlist" && (
            <div className="space-y-2">
              <label htmlFor="telegram-allow-from" className="text-sm font-medium">
                Allowed user IDs (comma-separated)
              </label>
              <Input
                id="telegram-allow-from"
                value={allowFromStr}
                onChange={(e) => setAllowFromStr(e.target.value)}
                placeholder="123456789, 987654321"
                className="font-mono text-sm"
              />
            </div>
          )}

          <div className="space-y-2 border-t pt-4">
            <label className="text-sm font-medium">AI for Telegram</label>
            <p className="text-muted-foreground text-xs">
              Provider and model used when you chat via Telegram. Leave empty to use a connected provider (OpenRouter or OpenAI if configured, otherwise app default).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="telegram-provider" className="text-xs text-muted-foreground">
                  Provider
                </label>
                <select
                  id="telegram-provider"
                  value={defaultProvider}
                  onChange={(e) => {
                    setDefaultProvider(e.target.value);
                    setDefaultModel("");
                  }}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="">Use app default</option>
                  {(config?.aiProviders ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="telegram-model" className="text-xs text-muted-foreground">
                  Model
                </label>
                {(defaultProvider === "ollama" || defaultProvider === "openrouter") ? (
                  <select
                    id="telegram-model"
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    disabled={telegramModelsLoading}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  >
                    <option value="">Use provider default</option>
                    {telegramModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="telegram-model"
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    placeholder={defaultProvider ? "e.g. gpt-4o-mini" : "Set provider first"}
                    disabled={!defaultProvider}
                    className="h-9 text-sm"
                  />
                )}
              </div>
            </div>
            {defaultProvider === "ollama" && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <p className="text-amber-700 dark:text-amber-400">
                  ⚠️ Ollama cannot run tools and perform like other providers (e.g. OpenAI, OpenRouter). For full tool support in Telegram, use a cloud provider.
                </p>
              </div>
            )}
          </div>

          {error && (
            <p className="text-destructive text-sm">{error}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={saving}>
              <Send className="size-4" />
              {saving ? "Saving…" : "Save"}
            </Button>
            {state?.configured && state.status !== "connected" && (
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={saving}
                title="Restart the bot with current settings"
              >
                Reconnect
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discord</CardTitle>
          <CardDescription>
            Let the agent post to your Discord servers. Create an app at the Discord Developer Portal, add a bot, invite it to your server with Send Messages, then paste the bot token below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {discordState && (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                {discordState.configured ? (
                  <span className="text-green-600 dark:text-green-400">Configured</span>
                ) : (
                  <span className="text-muted-foreground">Not configured</span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="discord-token" className="text-sm font-medium">
              Bot token
            </label>
            <Input
              id="discord-token"
              type="password"
              placeholder={discordState?.configured ? "(already set)" : "Paste your bot token…"}
              value={discordBotToken}
              onChange={(e) => setDiscordBotToken(e.target.value)}
              autoComplete="off"
              className="font-mono text-sm"
            />
            <p className="text-muted-foreground text-xs">
              Get a token from the Discord Developer Portal (Bot section). Leave blank to keep the current token.
            </p>
          </div>

          <p className="text-muted-foreground text-xs">
            <a
              href={DISCORD_INVITE_DOCS}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open Discord Developer Portal
              <ExternalLink className="size-3" />
            </a>
            {" "}→ create app, add bot, then OAuth2 → URL Generator (scope: bot, permissions: Send Messages) to invite the bot to your server.
          </p>

          {error && (
            <p className="text-destructive text-sm">{error}</p>
          )}

          <Button onClick={handleSaveDiscord} disabled={discordSaving}>
            {discordSaving ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stripe</CardTitle>
          <CardDescription>
            Let the agent list customers and invoices, and create invoices. Paste your Stripe Secret Key (from Dashboard → API keys). Use test key (sk_test_…) for development.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stripeState && (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                {stripeState.configured ? (
                  <span className="text-green-600 dark:text-green-400">Configured</span>
                ) : (
                  <span className="text-muted-foreground">Not configured</span>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="stripe-secret-key" className="text-sm font-medium">
              Secret key
            </label>
            <Input
              id="stripe-secret-key"
              type="password"
              placeholder={stripeState?.configured ? "(already set)" : "sk_test_… or sk_live_…"}
              value={stripeSecretKey}
              onChange={(e) => setStripeSecretKey(e.target.value)}
              autoComplete="off"
              className="font-mono text-sm"
            />
            <p className="text-muted-foreground text-xs">
              Get a key from Stripe Dashboard → Developers → API keys. Leave blank to keep the current key.
            </p>
          </div>

          <p className="text-muted-foreground text-xs">
            <a
              href={STRIPE_DASHBOARD}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open Stripe API keys
              <ExternalLink className="size-3" />
            </a>
          </p>

          {error && (
            <p className="text-destructive text-sm">{error}</p>
          )}

          <Button onClick={handleSaveStripe} disabled={stripeSaving}>
            {stripeSaving ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
