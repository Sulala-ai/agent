import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ChevronRight, Trash2 } from "lucide-react";
import type { IntegrationItem } from "@/lib/api";

export type IntegrationsPageProps = {
  integrations: IntegrationItem[];
  loading: boolean;
  connectingProvider: string | null;
  integrationsManagedByPortal: boolean;
  /** When true, PORTAL_GATEWAY_URL is set but PORTAL_API_KEY is empty. */
  portalUrlSetButKeyMissing?: boolean;
  load: () => void;
  handleConnect: (provider: string) => void;
  handleDisconnect: (id: string) => void;
  onError?: (msg: string) => void;
};

export function IntegrationsPage({
  integrations,
  loading,
  connectingProvider,
  integrationsManagedByPortal,
  portalUrlSetButKeyMissing = false,
  load,
  handleConnect,
  handleDisconnect,
  onError,
}: IntegrationsPageProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectionId = params.get("connectionId");
    const error = params.get("error");
    const oauth = params.get("oauth");
    const oauthMessage = params.get("message");
    if (connectionId || error) {
      if (error && onError) {
        try {
          onError(decodeURIComponent(error));
        } catch {
          onError("OAuth failed");
        }
      }
      load();
      const u = new URL(window.location.href);
      u.searchParams.delete("connectionId");
      u.searchParams.delete("error");
      window.history.replaceState({}, "", u.toString());
    } else if (oauth === "success" || oauth === "error") {
      if (oauth === "error" && oauthMessage && onError) {
        const msg = oauthMessage === "exchange_failed" ? "Token exchange failed. Check PORTAL_OAUTH_CLIENT_SECRET and redirect_uri." : oauthMessage === "no_token" ? "No access token in response." : oauthMessage;
        onError(msg);
      }
      load();
      const u = new URL(window.location.href);
      u.searchParams.delete("oauth");
      u.searchParams.delete("message");
      window.history.replaceState({}, "", u.toString());
    }
  }, [load, onError]);

  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return integrations;
    return integrations.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q)
    );
  }, [integrations, search]);

  if (loading && integrations.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 py-12">
        <Loader2 className="size-5 animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }

  if (integrationsManagedByPortal) {
    return (
      <div className="flex flex-1 flex-col gap-6 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
            <Badge variant="secondary" className="rounded-full text-[10px] font-medium uppercase">
              Beta
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Connect and disconnect apps here. Your agent uses <code className="rounded bg-muted px-1">PORTAL_API_KEY</code> or OAuth to access them.
          </p>
        </div>
        <p className="text-muted-foreground text-xs">
          Configure Portal gateway and connect in <strong>Settings → Portal</strong>.
        </p>
        {integrations.length > 0 && (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
            <div className="relative w-full sm:w-64">
              <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                type="search"
                placeholder="Search apps"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        )}
        {filteredApps.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredApps.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                connecting={connectingProvider === app.id}
                onConnect={() => handleConnect(app.id)}
                onDisconnect={handleDisconnect}
              />
            ))}
          </div>
        ) : search.trim() ? (
          <p className="text-muted-foreground py-8 text-center text-sm">No apps match your search.</p>
        ) : (
          <p className="text-muted-foreground py-4 text-center text-sm">No connections yet. Click an app to connect.</p>
        )}
      </div>
    );
  }

  if (integrations.length === 0 && !loading) {
    if (portalUrlSetButKeyMissing) {
      return (
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="border-amber-500/50 bg-amber-500/10 flex flex-col gap-3 rounded-lg border p-4 text-sm">
            <p className="font-medium">Portal API key required</p>
            <p className="text-muted-foreground text-xs">
              Configure Portal gateway URL and API key (or connect with OAuth) in <strong>Settings → Portal</strong>.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => load()} className="self-start">
            Retry
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="border-destructive/50 bg-destructive/5 flex flex-col gap-3 rounded-lg border p-4 text-sm">
          <p className="font-medium">Could not reach the integrations service</p>
          <p className="text-muted-foreground text-xs">
            Set <code className="rounded bg-muted px-1">INTEGRATIONS_URL</code> in the agent .env (e.g. http://localhost:1717) and run the
            integrations service (<code className="rounded bg-muted px-1">cd integrations && npm run dev</code>), or configure Portal in <strong>Settings → Portal</strong>.
          </p>
          <Button variant="secondary" size="sm" onClick={() => load()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
          <Badge variant="secondary" className="rounded-full text-[10px] font-medium uppercase">
            Beta
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Connect your favorite apps. The agent uses these via connectionId — no secrets in skills.
        </p>
      </div>

      <p className="text-muted-foreground text-xs">
        Portal gateway and Connect with Sulala are in <strong>Settings → Portal</strong>.
      </p>

      {/* Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            type="search"
            placeholder="Search apps"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* App grid */}
      <div className="grid gap-2 sm:grid-cols-2">
        {filteredApps.map((app) => (
          <AppCard
            key={app.id}
            app={app}
            connecting={connectingProvider === app.id}
            onConnect={() => handleConnect(app.id)}
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>

      {filteredApps.length === 0 && (
        <p className="text-muted-foreground py-8 text-center text-sm">No apps match your search.</p>
      )}
    </div>
  );
}

const DISCORD_SETUP_URL = "https://discord.com/developers/applications";
const STRIPE_SETUP_URL = "https://dashboard.stripe.com/apikeys";

function AppCard({
  app,
  connecting,
  onConnect,
  onDisconnect,
  portalMode = false,
}: {
  app: IntegrationItem;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: (id: string) => void;
  portalMode?: boolean;
}) {
  const isConnected = app.connections.length > 0;
  const isTokenOnly = app.tokenOnly === true;
  const isDiscord = app.id === "discord";
  const isStripe = app.id === "stripe";

  const handleCardAction = () => {
    if (isConnected) return;
    if (isTokenOnly && isDiscord) {
      window.open(DISCORD_SETUP_URL, "_blank", "noopener,noreferrer");
      return;
    }
    if (isTokenOnly && isStripe) {
      window.open(STRIPE_SETUP_URL, "_blank", "noopener,noreferrer");
      return;
    }
    onConnect();
  };

  return (
    <div
      className="border-border hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
      onClick={handleCardAction}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardAction();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg p-1.5">
        {app.iconUrl ? (
          <img src={app.iconUrl} alt="" className="size-full object-contain" />
        ) : (
          <span className="text-muted-foreground text-sm font-medium">{app.name.charAt(0)}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{app.name}</span>
          {isConnected && (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Connected
            </Badge>
          )}
          {isTokenOnly && !isConnected && (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              Setup
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground truncate text-sm">{app.description}</p>
        {isDiscord && isTokenOnly && (
          <p className="text-muted-foreground mt-0.5 text-xs">
            Set <code className="rounded bg-muted px-1">DISCORD_BOT_TOKEN</code> in agent .env or Settings → Channels. Click to open Discord Developer Portal.
          </p>
        )}
        {isStripe && isTokenOnly && (
          <p className="text-muted-foreground mt-0.5 text-xs">
            Set Secret Key in Settings → Payment or <code className="rounded bg-muted px-1">STRIPE_SECRET_KEY</code> in agent .env. Click to open Stripe API keys.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isConnected && !portalMode ? (
          app.connections.map((c) => (
            <Button
              key={c.id}
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={(e) => {
                e.stopPropagation();
                onDisconnect(c.id);
              }}
              title="Disconnect"
            >
              <Trash2 className="size-3.5 text-muted-foreground" />
            </Button>
          ))
        ) : isConnected && portalMode ? (
          <span title="Manage in Portal">
            <ChevronRight className="text-muted-foreground size-5" />
          </span>
        ) : connecting ? (
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        ) : (
          <ChevronRight className="text-muted-foreground size-5" />
        )}
      </div>
    </div>
  );
}
