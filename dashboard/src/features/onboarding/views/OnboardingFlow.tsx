import { createContext, useContext } from "react";

function parseModelSizeBytes(sizeStr: string): number | null {
  if (!sizeStr) return null;
  const m = sizeStr.match(/~?(\d+(?:\.\d+)?)\s*(GB|MB|gb|mb)/);
  if (!m) return null;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  if (unit === "GB") return Math.round(val * 1024 * 1024 * 1024);
  if (unit === "MB") return Math.round(val * 1024 * 1024);
  return null;
}
import { ChevronRight, Check, Copy, Cpu, HardDrive, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState } from "react";
import { useOnboarding, PROVIDERS, PROVIDER_ENV_KEYS } from "../hooks/useOnboarding";
import type { RecommendedOllamaModel } from "@/lib/api";
import { putOnboardEnv, fetchConfig } from "@/lib/api";

const OnboardingContext = createContext<ReturnType<typeof useOnboarding> | null>(null);
function useOnboardingContext() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("OnboardingFlow must wrap steps");
  return ctx;
}

const STEP_LABELS_WITH_OLLAMA = [
  "Choose AI Provider",
  "Provider Configuration",
  "Integrations",
  "Ollama Model Setup",
  "Finish",
];
const STEP_LABELS_WITHOUT_OLLAMA = [
  "Choose AI Provider",
  "Provider Configuration",
  "Integrations",
  "Finish",
];

function Step1ProviderSelection() {
  const { selectedProviders, setSelectedProviders, setStep, systemCapabilities } = useOnboardingContext();
  const ollamaDisabled = systemCapabilities && !systemCapabilities.ollamaSuitable;
  const toggle = (id: string) => {
    if (id === "ollama" && ollamaDisabled) return;
    const next = selectedProviders.includes(id)
      ? selectedProviders.filter((p) => p !== id)
      : [...selectedProviders, id];
    setSelectedProviders(next);
  };
  const canNext = selectedProviders.length >= 1;

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Select at least one AI provider to continue. Ollama runs locally and needs no API key.
      </p>
      {ollamaDisabled && systemCapabilities && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="text-amber-700 dark:text-amber-400">
            ⚠️ {systemCapabilities.ollamaSuitableReason}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Use a cloud provider (OpenAI, OpenRouter, etc.) instead.
          </p>
        </div>
      )}
      {selectedProviders.includes("ollama") && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="text-amber-700 dark:text-amber-400">
            ⚠️ Ollama cannot run tools and perform like other providers (e.g. OpenAI, OpenRouter). For full tool support and best results, add a cloud provider.
          </p>
        </div>
      )}
      <div className="grid gap-3">
        {PROVIDERS.map((p) => (
          <label
            key={p.id}
            className={`border-input flex items-center gap-3 rounded-lg border p-4 transition-colors ${
              p.id === "ollama" && ollamaDisabled
                ? "cursor-not-allowed opacity-60"
                : "hover:bg-muted/50 cursor-pointer"
            }`}
          >
            <Checkbox
              checked={selectedProviders.includes(p.id)}
              onCheckedChange={() => toggle(p.id)}
              disabled={p.id === "ollama" && !!ollamaDisabled}
            />
            <div className="flex-1">
              <div className="font-medium">
                {p.label}
                {"recommended" in p && p.recommended && (
                  <span className="text-emerald-600 dark:text-emerald-400 ml-2 text-xs">(Recommended)</span>
                )}
                {p.id === "ollama" && ollamaDisabled && (
                  <span className="text-amber-600 dark:text-amber-400 ml-2 text-xs">(Not recommended)</span>
                )}
              </div>
              {p.envKey && (
                <div className="text-muted-foreground text-xs">Requires API key</div>
              )}
            </div>
          </label>
        ))}
      </div>
      <div className="flex justify-between">
        <div />
        <Button disabled={!canNext} onClick={() => setStep(1)}>
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
      </div>
    </div>
  );
}

function Step2ProviderConfig() {
  const {
    selectedProviders,
    envKeys,
    envKeysInput,
    setEnvKeysInput,
    saveEnv,
    setStep,
    loading,
    error,
  } = useOnboardingContext();
  const cloudProviders = selectedProviders.filter((p) => p !== "ollama");
  const keyLabels: Record<string, string> = {
    OPENAI_API_KEY: "OpenAI API Key",
    ANTHROPIC_API_KEY: "Anthropic API Key",
    GOOGLE_GEMINI_API_KEY: "Google Gemini API Key",
    GEMINI_API_KEY: "Gemini API Key (alt)",
    OPENROUTER_API_KEY: "OpenRouter API Key",
  };
  const providerKeys = cloudProviders.flatMap((p) => {
    const k = PROVIDER_ENV_KEYS[p];
    return k ? [k] : [];
  });
  const hasUnset = providerKeys.some((k) => envKeys[k] !== "set");
  const canSkip = !hasUnset || providerKeys.length === 0;
  const hasInput = providerKeys.some((k) => (envKeysInput[k] ?? "").trim().length > 0);

  return (
    <div className="space-y-6">
      {cloudProviders.length === 0 ? (
        <p className="text-muted-foreground text-sm">No cloud providers selected. Skipping API keys.</p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Enter API keys for selected providers. Keys are saved securely to <code className="rounded bg-muted px-1 text-xs">~/.sulala/.env</code>.
          </p>
          <div className="grid gap-4">
            {providerKeys.map((key) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>{keyLabels[key] ?? key}</Label>
                <Input
                  id={key}
                  type="password"
                  placeholder={envKeys[key] === "set" ? "(already set)" : "sk-..."}
                  value={envKeysInput[key] ?? ""}
                  onChange={(e) =>
                    setEnvKeysInput({ ...envKeysInput, [key]: e.target.value })
                  }
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
        </>
      )}
      {error && <div className="text-destructive text-sm">{error}</div>}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(0)}>
          Back
        </Button>
        <div className="flex gap-2">
          {(canSkip || hasInput) && (
            <Button variant="outline" onClick={() => setStep(2)}>
              {cloudProviders.length === 0 ? "Next" : "Skip for now"}
            </Button>
          )}
          {hasInput && (
            <Button onClick={() => saveEnv(2)} disabled={loading}>
              {loading ? "Saving…" : "Save & Next"}
            </Button>
          )}
          {canSkip && !hasInput && cloudProviders.length > 0 && (
            <Button onClick={() => setStep(2)}>Next</Button>
          )}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_PORTAL_GATEWAY_URL = import.meta.env.VITE_DEFAULT_PORTAL_GATEWAY_URL || "https://portal.sulala.ai/api/gateway";

function Step3Integrations() {
  const {
    envKeys,
    envKeysInput,
    setEnvKeysInput,
    saveEnv,
    setStep,
    setError,
    loading,
    error,
    selectedProviders,
  } = useOnboardingContext();
  const hasPortalInput = (envKeysInput.PORTAL_API_KEY ?? "").trim().length > 0;
  const portalConfigured = envKeys.PORTAL_API_KEY === "set" || hasPortalInput;
  const hasOllama = selectedProviders.includes("ollama");
  const nextStep = hasOllama ? 4 : 3;
  /** Portal gateway URL from agent config (.env / ~/.sulala/.env), or default. */
  const [portalGatewayUrl, setPortalGatewayUrl] = useState<string>(DEFAULT_PORTAL_GATEWAY_URL);
  /** ChatGPT Apps SDK / MCP OAuth 2.1 (optional). */
  const [mcpOAuthEnabled, setMcpOAuthEnabled] = useState(false);
  const [mcpOAuthResourceUrl, setMcpOAuthResourceUrl] = useState("");
  const [mcpOAuthAuthServer, setMcpOAuthAuthServer] = useState("");
  const [mcpOAuthScopes, setMcpOAuthScopes] = useState("openid");
  const [mcpOAuthSaving, setMcpOAuthSaving] = useState(false);
  const [mcpOAuthSaved, setMcpOAuthSaved] = useState(false);

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        const url = (c.portalGatewayUrl ?? "").trim() || DEFAULT_PORTAL_GATEWAY_URL;
        setPortalGatewayUrl(url);
        const co = c.chatgptOAuth;
        if (co) {
          setMcpOAuthEnabled(!!co.enabled);
          setMcpOAuthResourceUrl(co.resourceUrl ?? "");
          setMcpOAuthAuthServer(co.authorizationServer ?? "");
          setMcpOAuthScopes(Array.isArray(co.scopesSupported) && co.scopesSupported.length ? co.scopesSupported.join(", ") : "openid");
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = () => {
    saveEnv(nextStep, { PORTAL_GATEWAY_URL: portalGatewayUrl });
  };

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        Connect with Sulala to use GitHub, Gmail, and other apps. Enter your Portal API key below.
      </p>
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="portal-gateway-url-onboard">Portal gateway URL</Label>
          <Input
            id="portal-gateway-url-onboard"
            type="url"
            placeholder={DEFAULT_PORTAL_GATEWAY_URL}
            value={portalGatewayUrl}
            onChange={(e) => setPortalGatewayUrl(e.target.value.trim() || DEFAULT_PORTAL_GATEWAY_URL)}
            className="font-mono text-xs"
          />
          <p className="text-muted-foreground text-xs">
            Use <code className="rounded bg-muted px-1">http://localhost:3004/api/gateway</code> for local Portal, or leave default for portal.sulala.ai
          </p>
        </div>
        <a
          href={
            portalGatewayUrl
              ? `${portalGatewayUrl.replace(/\/api\/gateway$/i, "").replace(/\/$/, "")}/api-keys`
              : "https://portal.sulala.ai/api-keys"
          }
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline inline-block text-xs"
        >
          Create API key →
        </a>
        <div className="space-y-2">
          <Label htmlFor="portal-api-key">Portal API Key</Label>
          <Input
            id="portal-api-key"
            type="password"
            placeholder={envKeys.PORTAL_API_KEY === "set" ? "(already set)" : "sk_live_..."}
            value={envKeysInput.PORTAL_API_KEY ?? ""}
            onChange={(e) =>
              setEnvKeysInput({ ...envKeysInput, PORTAL_API_KEY: e.target.value })
            }
            autoComplete="off"
          />
        </div>

        {/* ChatGPT Apps SDK / MCP OAuth 2.1 — optional setup for ChatGPT connector */}
        <div className="border-border space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="mcp-oauth-enabled"
              checked={mcpOAuthEnabled}
              onCheckedChange={(v) => setMcpOAuthEnabled(v === true)}
            />
            <Label htmlFor="mcp-oauth-enabled" className="cursor-pointer font-medium">
              Enable ChatGPT (Apps SDK) OAuth
            </Label>
          </div>
          <p className="text-muted-foreground text-xs">
            Expose this agent as an MCP resource server so ChatGPT can connect with OAuth 2.1 (Auth0, Stytch, etc.). You must host this agent at a public HTTPS URL and configure your IdP with the redirect URIs below.
          </p>
          {mcpOAuthEnabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="mcp-oauth-resource">Resource URL (this MCP server)</Label>
                <Input
                  id="mcp-oauth-resource"
                  type="url"
                  placeholder="https://your-agent.example.com"
                  value={mcpOAuthResourceUrl}
                  onChange={(e) => setMcpOAuthResourceUrl(e.target.value.trim())}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-oauth-auth-server">Authorization server (IdP issuer URL)</Label>
                <Input
                  id="mcp-oauth-auth-server"
                  type="url"
                  placeholder="https://tenant.auth0.com or https://api.stytch.com/v1/"
                  value={mcpOAuthAuthServer}
                  onChange={(e) => setMcpOAuthAuthServer(e.target.value.trim())}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-oauth-scopes">Scopes (comma-separated)</Label>
                <Input
                  id="mcp-oauth-scopes"
                  type="text"
                  placeholder="openid, files:read"
                  value={mcpOAuthScopes}
                  onChange={(e) => setMcpOAuthScopes(e.target.value.trim() || "openid")}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground text-xs">Allowlist these redirect URIs in your IdP</Label>
                <div className="bg-muted/50 flex flex-col gap-1 rounded p-2 font-mono text-xs">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all">https://chatgpt.com/connector/oauth/&#123;callback_id&#125;</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 size-7"
                      onClick={() => navigator.clipboard.writeText("https://chatgpt.com/connector/oauth/{callback_id}")}
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all">https://platform.openai.com/apps-manage/oauth</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 size-7"
                      onClick={() => navigator.clipboard.writeText("https://platform.openai.com/apps-manage/oauth")}
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={mcpOAuthSaving || !mcpOAuthResourceUrl.trim() || !mcpOAuthAuthServer.trim()}
                onClick={async () => {
                  setMcpOAuthSaving(true);
                  setError(null);
                  try {
                    await putOnboardEnv({
                      MCP_OAUTH_ENABLED: mcpOAuthEnabled ? "1" : "0",
                      MCP_OAUTH_RESOURCE_URL: mcpOAuthResourceUrl.trim(),
                      MCP_OAUTH_AUTHORIZATION_SERVER: mcpOAuthAuthServer.trim(),
                      MCP_OAUTH_SCOPES_SUPPORTED: mcpOAuthScopes.trim() || "openid",
                    });
                    setMcpOAuthSaved(true);
                    setTimeout(() => setMcpOAuthSaved(false), 2000);
                    await loadEnv();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setMcpOAuthSaving(false);
                  }
                }}
              >
                {mcpOAuthSaving ? "Saving…" : mcpOAuthSaved ? "Saved" : "Save ChatGPT OAuth settings"}
              </Button>
            </>
          )}
        </div>
      </div>
      {error && <div className="text-destructive text-sm">{error}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setStep(1)}>
            Back
          </Button>
        </div>
        <div className="flex gap-2">
          {portalConfigured && !hasPortalInput && (
            <Button onClick={() => setStep(nextStep)}>Next</Button>
          )}
          {portalConfigured && hasPortalInput && (
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Saving…" : "Save & Next"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  m,
  installed,
  pulling,
  onPull,
}: {
  m: RecommendedOllamaModel;
  installed: boolean;
  pulling: boolean;
  onPull: () => void;
}) {
  return (
    <div className="border-input flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium">{m.name}</div>
        <div className="text-muted-foreground text-sm">{m.description}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          <span className="flex items-center gap-1">
            <HardDrive className="size-3" /> {m.size}
          </span>
          <span className="flex items-center gap-1">
            <Zap className="size-3" /> {m.ram} RAM
          </span>
          <span className="flex items-center gap-1">
            <Cpu className="size-3" /> {m.cpu}
          </span>
          {m.gpu !== "None" && <span>GPU: {m.gpu}</span>}
        </div>
      </div>
      <Button
        variant={installed ? "secondary" : "default"}
        size="sm"
        onClick={onPull}
        disabled={installed || pulling}
      >
        {installed ? "Installed" : pulling ? "Installing…" : "Install"}
      </Button>
    </div>
  );
}

function Step3OllamaModels() {
  const {
    recommendedModels,
    ollamaRunning,
    ollamaStatusLoading,
    pullState,
    pullingModels,
    pullModel,
    installOllama,
    setStep,
    checkOllama,
    systemCapabilities,
    error,
  } = useOnboardingContext();

  const handleInstallOllama = () => {
    if (
      !window.confirm(
        "Ollama will be downloaded and installed (~500MB). This requires network access and sufficient disk space. Continue?"
      )
    )
      return;
    installOllama();
  };

  const handlePullModel = (m: { id: string; name: string; size: string }) => {
    const freeBytes = systemCapabilities?.storageFreeBytes ?? 0;
    const modelBytes = parseModelSizeBytes(m.size);
    if (modelBytes != null && freeBytes > 0 && modelBytes > freeBytes) {
      alert(`Insufficient storage. This model needs ~${m.size}. You have ${(freeBytes / 1024 / 1024 / 1024).toFixed(1)}GB free.`);
      return;
    }
    if (
      !window.confirm(
        `Download and install ${m.name}? This will use ~${m.size} of disk space. Continue?`
      )
    )
      return;
    pullModel(m.id);
  };

  const installedIds = new Set<string>(); // We don't fetch installed; assume not installed for onboarding
  if (pullState.inProgress && pullState.model) {
    installedIds.add(pullState.model);
  }

  const ollamaNotSuitable = systemCapabilities && !systemCapabilities.ollamaSuitable;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
        <p className="text-amber-700 dark:text-amber-400">
          ⚠️ Ollama cannot run tools and perform like other providers (e.g. OpenAI, OpenRouter). For full tool support and best results, use a cloud provider.
        </p>
      </div>
      {ollamaNotSuitable && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="text-amber-700 dark:text-amber-400">
            ⚠️ {systemCapabilities!.ollamaSuitableReason} Ollama may not run well here.
          </p>
        </div>
      )}
      {ollamaStatusLoading ? (
        <p className="text-muted-foreground text-sm">Checking Ollama…</p>
      ) : ollamaRunning === false ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
          <p className="text-amber-700 dark:text-amber-400 text-sm">
            ⚠️ Ollama is not running. Click Install to download Ollama, or install from{" "}
            <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="underline">
              ollama.com
            </a>{" "}
            and run <code>ollama serve</code>.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="default" size="sm" onClick={handleInstallOllama} disabled={ollamaStatusLoading}>
              Install Ollama
            </Button>
            <Button variant="outline" size="sm" onClick={checkOllama} disabled={ollamaStatusLoading}>
              Check again
            </Button>
          </div>
        </div>
      ) : null}
      {pullState.inProgress && (
        <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-4">
          <div className="font-medium">Pulling {pullState.model}…</div>
          {pullState.percent >= 0 && pullState.percent <= 100 && (
            <Progress value={pullState.percent} className="mt-2 h-2" />
          )}
          {pullState.lastLine && (
            <div className="text-muted-foreground mt-1 truncate font-mono text-xs">{pullState.lastLine}</div>
          )}
        </div>
      )}
      <p className="text-muted-foreground text-sm">
        Select models to install. You can skip and install later from Settings.
      </p>
      <div className="grid gap-3">
        {recommendedModels.map((m) => (
          <ModelRow
            key={m.id}
            m={m}
            installed={false}
            pulling={pullingModels.has(m.id)}
            onPull={() => handlePullModel(m)}
          />
        ))}
      </div>
      {error && <div className="text-destructive text-sm">{error}</div>}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
        <Button onClick={() => setStep(4)}>Skip or Next</Button>
      </div>
    </div>
  );
}

function Step6Finish() {
  const {
    selectedProviders,
    finishOnboarding,
    loading,
    error,
    setStep,
  } = useOnboardingContext();
  const hasOllama = selectedProviders.includes("ollama");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold">Summary</h3>
        <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
          <li className="flex items-center gap-2">
            <Check className="size-4 text-green-600" />
            AI providers: {selectedProviders.join(", ") || "None"}
          </li>
        </ul>
      </div>
      <p className="text-muted-foreground text-sm">
        Click Finish to complete onboarding and open the dashboard. You can change providers anytime in Settings.
      </p>
      {error && <div className="text-destructive text-sm">{error}</div>}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(hasOllama ? 3 : 2)}>Back</Button>
        <Button onClick={finishOnboarding} disabled={loading}>
          {loading ? "Finishing…" : "Finish"}
        </Button>
      </div>
    </div>
  );
}

type OnboardingFlowProps = { onComplete?: () => void };

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const onboarding = useOnboarding(onComplete);
  const { step, selectedProviders, setStep, loadEnv, setError } = onboarding;
  const hasOllama = selectedProviders.includes("ollama");
  const totalSteps = hasOllama ? 5 : 4;
  const stepLabels = hasOllama ? STEP_LABELS_WITH_OLLAMA : STEP_LABELS_WITHOUT_OLLAMA;
  const current = Math.max(0, Math.min(step, totalSteps - 1));


  const cardDescriptions: Record<number, string> = {
    0: "Choose which AI providers you want to use.",
    1: "Enter API keys for cloud providers.",
    2: "Create an API key at portal.sulala.ai. Required to connect GitHub, Gmail, and other apps.",
    ...(hasOllama
      ? { 3: "Install local models with Ollama.", 4: "Review and complete setup." }
      : { 3: "Review and complete setup." }),
  };

  return (
    <OnboardingContext.Provider value={onboarding}>
    <div className="bg-background flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to Sulala</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Step {current + 1} of {totalSteps}: {stepLabels[current]}
          </p>
          <Progress value={((current + 1) / totalSteps) * 100} className="mt-4 h-2" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{stepLabels[current]}</CardTitle>
            <CardDescription>
              {cardDescriptions[current]}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {current === 0 && <Step1ProviderSelection />}
            {current === 1 && <Step2ProviderConfig />}
            {current === 2 && <Step3Integrations />}
            {current === 3 && (hasOllama ? <Step3OllamaModels /> : <Step6Finish />)}
            {current === 4 && hasOllama && <Step6Finish />}
          </CardContent>
        </Card>
      </div>
    </div>
    </OnboardingContext.Provider>
  );
}
