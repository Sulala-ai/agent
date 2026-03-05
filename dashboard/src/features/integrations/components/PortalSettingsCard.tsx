import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchOnboardEnv, putOnboardEnv, type OnboardEnvKeys } from "@/lib/api";

export type PortalSettingsCardProps = {
  /** When true, show as required (Portal URL set but key missing). */
  required?: boolean;
  /** Current portal gateway URL from agent config (editable in the card). */
  portalGatewayUrl?: string | null;
  onSaved?: () => void;
  onError?: (msg: string) => void;
};

const DEFAULT_PORTAL_GATEWAY_URL = import.meta.env.VITE_DEFAULT_PORTAL_GATEWAY_URL || "https://portal.sulala.ai/api/gateway";

export function PortalSettingsCard({
  required = false,
  portalGatewayUrl,
  onSaved,
  onError,
}: PortalSettingsCardProps) {
  const [envKeys, setEnvKeys] = useState<OnboardEnvKeys>({});
  const [portalUrl, setPortalUrl] = useState(portalGatewayUrl?.trim() || DEFAULT_PORTAL_GATEWAY_URL);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPortalUrl(portalGatewayUrl?.trim() || DEFAULT_PORTAL_GATEWAY_URL);
  }, [portalGatewayUrl]);

  useEffect(() => {
    setLoading(true);
    fetchOnboardEnv()
      .then(({ keys }) => {
        setEnvKeys(keys ?? {});
      })
      .catch(() => setEnvKeys({}))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    const url = portalUrl.trim();
    if (!url) {
      onError?.("Enter Portal gateway URL");
      return;
    }
    if (required && !apiKey.trim()) {
      onError?.("Enter Portal API key");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string> = { PORTAL_GATEWAY_URL: url };
      if (apiKey.trim()) body.PORTAL_API_KEY = apiKey.trim();
      await putOnboardEnv(body);
      const { keys } = await fetchOnboardEnv();
      setEnvKeys(keys ?? {});
      if (apiKey.trim()) setApiKey("");
      onSaved?.();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const keyPlaceholder = envKeys.PORTAL_API_KEY === "set" ? "(already set)" : "sk_live_...";
  const saveDisabled = saving || !portalUrl.trim() || (required && !apiKey.trim());

  return (
    <div className="border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <p className="font-medium">{required ? "Portal API key required" : "Portal settings"}</p>
      <p className="text-muted-foreground text-xs">
        {required
          ? "Create an API key at your Portal and enter it below. Takes effect immediately."
          : "Connect GitHub, Gmail, and other apps via Portal. Saved keys take effect immediately."}
      </p>
      {loading ? (
        <p className="text-muted-foreground text-xs">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="space-y-1">
            <Label htmlFor="portal-gateway-url" className="text-xs">
              Portal gateway URL
            </Label>
            <Input
              id="portal-gateway-url"
              type="url"
              placeholder={DEFAULT_PORTAL_GATEWAY_URL}
              value={portalUrl}
              onChange={(e) => setPortalUrl(e.target.value)}
              className="h-8 font-mono text-xs"
            />
            <p className="text-muted-foreground text-[10px]">
              e.g. http://localhost:3004/api/gateway for local Portal, or https://portal.sulala.ai/api/gateway
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="portal-api-key" className="text-xs">
              Portal API Key
            </Label>
            <Input
              id="portal-api-key"
              type="password"
              placeholder={keyPlaceholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              className="h-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={save} disabled={saveDisabled}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <a
              href={(() => {
                const trimmed = portalUrl.trim();
                if (!trimmed) return "https://portal.sulala.ai/api/keys";
                try {
                  const base = trimmed.replace(/\/api\/gateway$/i, "");
                  const withProtocol = /^https?:\/\//i.test(base) ? base : `https://${base}`;
                  return new URL("/api-keys", withProtocol).toString();
                } catch {
                  return "https://portal.sulala.ai/api/keys";
                }
              })()}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline text-xs"
            >
              Create API key →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
