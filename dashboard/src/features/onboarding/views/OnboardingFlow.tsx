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
import { ChevronRight, Check, Cpu, HardDrive, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { useOnboarding, PROVIDERS, PROVIDER_ENV_KEYS } from "../hooks/useOnboarding";
import type { RecommendedOllamaModel } from "@/lib/api";

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
              <div className="font-medium">{p.label}</div>
              {p.id === "ollama" && ollamaDisabled && (
                <div className="text-amber-600 dark:text-amber-400 mt-0.5 text-xs">Not available on this system</div>
              )}
              {p.envKey && (
                <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                  <span>Requires API key</span>
                  {"apiKeyUrl" in p && typeof p.apiKeyUrl === "string" && (
                    <a
                      href={p.apiKeyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Get API key →
                    </a>
                  )}
                </div>
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
  const keyUrls: Record<string, string> = {};
  PROVIDERS.forEach((p) => {
    if (p.envKey && "apiKeyUrl" in p && typeof (p as { apiKeyUrl?: string }).apiKeyUrl === "string") {
      keyUrls[p.envKey] = (p as { apiKeyUrl: string }).apiKeyUrl;
    }
  });
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
                <div className="flex flex-wrap items-center gap-x-2">
                  <Label htmlFor={key}>{keyLabels[key] ?? key}</Label>
                  {keyUrls[key] && (
                    <a
                      href={keyUrls[key]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary text-xs hover:underline"
                    >
                      Get API key →
                    </a>
                  )}
                </div>
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

function Step3Integrations() {
  const { setStep, selectedProviders } = useOnboardingContext();
  const hasOllama = selectedProviders.includes("ollama");
  const nextStep = hasOllama ? 4 : 3;

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        You can connect apps (GitHub, Gmail, Twitter, etc.) in two ways:
      </p>
      <ul className="text-muted-foreground list-disc list-inside space-y-1 text-sm">
        <li>
          <strong>MCP Servers</strong> — Integrations → MCP Servers tab. Add servers and API keys (e.g. YouTube, Twitter). Find more at{" "}
          <a href="https://mcpservers.org/" target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">
            mcpservers.org
          </a>
          .
        </li>
        <li>
          <strong>Sulala Portal</strong> — To use Portal for OAuth apps, add your API key later in <strong>Settings → Portal</strong>.
        </li>
      </ul>
      <p className="text-muted-foreground text-xs">
        Neither is required now. You can set up either option anytime from the dashboard.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={() => setStep(1)}>
          Back
        </Button>
        <Button onClick={() => setStep(nextStep)}>
          Next
          <ChevronRight className="ml-1 size-4" />
        </Button>
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
  const { step, selectedProviders } = onboarding;
  const hasOllama = selectedProviders.includes("ollama");
  const totalSteps = hasOllama ? 5 : 4;
  const stepLabels = hasOllama ? STEP_LABELS_WITH_OLLAMA : STEP_LABELS_WITHOUT_OLLAMA;
  const current = Math.max(0, Math.min(step, totalSteps - 1));

  const cardDescriptions: Record<number, string> = {
    0: "Choose which AI providers you want to use.",
    1: "Enter API keys for cloud providers.",
    2: "Connect apps via MCP servers or Sulala Portal (optional). Add Portal API key in Settings → Portal if you use Portal.",
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
