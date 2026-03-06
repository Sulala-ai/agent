import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchOnboardEnv, putOnboardEnv, type OnboardEnvKeys } from "@/lib/api";

export type StorePublishSettingsCardProps = {
  /** Store base URL for "Create API key" link (e.g. from SKILLS_REGISTRY_URL). */
  storeBaseUrl?: string | null;
  onSaved?: () => void;
  onError?: (msg: string) => void;
};

export function StorePublishSettingsCard({
  storeBaseUrl,
  onSaved,
  onError,
}: StorePublishSettingsCardProps) {
  const [envKeys, setEnvKeys] = useState<OnboardEnvKeys>({});
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchOnboardEnv()
      .then(({ keys }) => setEnvKeys(keys ?? {}))
      .catch(() => setEnvKeys({}))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      if (apiKey.trim()) body.STORE_PUBLISH_API_KEY = apiKey.trim();
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

  const keyPlaceholder = envKeys.STORE_PUBLISH_API_KEY === "set" ? "(already set)" : "sk_pub_...";
  const createKeyUrl = storeBaseUrl
    ? `${storeBaseUrl.replace(/\/$/, "")}/my-skills`
    : null;

  return (
    <div className="border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-4 text-sm">
      <p className="font-medium">Store publish API key</p>
      <p className="text-muted-foreground text-xs">
        Publish skills from the dashboard (Skills → My skills → Publish to store). Create a key on the store (My skills → Create publish API key), then paste it here.
      </p>
      {loading ? (
        <p className="text-muted-foreground text-xs">Loading…</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="store-publish-api-key" className="text-xs">
              API key
            </Label>
            <Input
              id="store-publish-api-key"
              type="password"
              placeholder={keyPlaceholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              className="h-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="secondary" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {createKeyUrl && (
              <a
                href={createKeyUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline text-xs"
              >
                Create API key on store →
              </a>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
