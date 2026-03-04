import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchOnboardEnv,
  putOnboardEnv,
  fetchOllamaStatus,
  fetchConfig,
  fetchJobDefault,
  updateJobDefault,
  fetchAgentModels,
  type OnboardEnvKeys,
  type Config,
  type AgentModel,
} from "@/lib/api";

const KEY_LABELS: Record<string, string> = {
  OPENAI_API_KEY: "OpenAI API Key",
  ANTHROPIC_API_KEY: "Anthropic (Claude) API Key",
  GOOGLE_GEMINI_API_KEY: "Google Gemini API Key",
  GEMINI_API_KEY: "Gemini API Key (alt)",
  OPENROUTER_API_KEY: "OpenRouter API Key",
  OLLAMA_BASE_URL: "Ollama Base URL",
  GATEWAY_API_KEY: "Gateway API Key",
};

export function AIProvidersTab() {
  const [envKeys, setEnvKeys] = useState<OnboardEnvKeys>({});
  const [envKeysInput, setEnvKeysInput] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [config, setConfig] = useState<Config | null>(null);
  const [jobDefaultProvider, setJobDefaultProvider] = useState("");
  const [jobDefaultModel, setJobDefaultModel] = useState("");
  const [jobDefaultModels, setJobDefaultModels] = useState<AgentModel[]>([]);
  const [jobDefaultModelsLoading, setJobDefaultModelsLoading] = useState(false);
  const [jobDefaultSaving, setJobDefaultSaving] = useState(false);
  const [jobDefaultMessage, setJobDefaultMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    Promise.all([fetchOnboardEnv(), fetchOllamaStatus(), fetchConfig(), fetchJobDefault()])
      .then(([env, ollama, cfg, jobDef]) => {
        setEnvKeys(env.keys || {});
        setOllamaRunning(ollama.running);
        setConfig(cfg ?? null);
        setJobDefaultProvider(jobDef.defaultProvider ?? "");
        setJobDefaultModel(jobDef.defaultModel ?? "");
      })
      .catch(() => setMessage({ type: "error", text: "Failed to load" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!jobDefaultProvider || (jobDefaultProvider !== "ollama" && jobDefaultProvider !== "openrouter")) {
      setJobDefaultModels([]);
      return;
    }
    setJobDefaultModelsLoading(true);
    fetchAgentModels(jobDefaultProvider)
      .then((r) => setJobDefaultModels(r.models ?? []))
      .catch(() => setJobDefaultModels([]))
      .finally(() => setJobDefaultModelsLoading(false));
  }, [jobDefaultProvider]);

  const checkOllama = async () => {
    setOllamaLoading(true);
    try {
      const { running } = await fetchOllamaStatus();
      setOllamaRunning(running);
    } finally {
      setOllamaLoading(false);
    }
  };

  const saveKeys = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(envKeysInput)) {
        if (typeof v === "string" && v.trim()) filtered[k] = v.trim();
      }
      await putOnboardEnv(filtered);
      const { keys } = await fetchOnboardEnv();
      setEnvKeys(keys);
      setEnvKeysInput({});
      setMessage({ type: "success", text: "API keys saved. Restart the agent for changes to take effect." });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const keysToShow = Object.keys(KEY_LABELS);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Providers</CardTitle>
          <CardDescription>
            Add or update API keys. Saved to <code className="rounded bg-muted px-1 text-xs">~/.sulala/.env</code>. Restart the agent for changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {keysToShow.map((key) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={key}>{KEY_LABELS[key] ?? key}</Label>
              <Input
                id={key}
                type="password"
                placeholder={envKeys[key] === "set" ? "(already set)" : ""}
                value={envKeysInput[key] ?? ""}
                onChange={(e) =>
                  setEnvKeysInput((prev) => ({ ...prev, [key]: e.target.value }))
                }
                autoComplete="off"
              />
            </div>
          ))}
          {message && (
            <p
              className={
                message.type === "success"
                  ? "text-green-600 dark:text-green-400 text-sm"
                  : "text-destructive text-sm"
              }
            >
              {message.text}
            </p>
          )}
          <Button onClick={saveKeys} disabled={saving || Object.keys(envKeysInput).length === 0}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Default for scheduled jobs</CardTitle>
          <CardDescription>
            When a job uses &quot;Use default&quot;, this provider and model are used. Set this to OpenRouter or OpenAI (not Ollama) so jobs run reliably even when Ollama is not running.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="job-default-provider">Provider</Label>
              <select
                id="job-default-provider"
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={jobDefaultProvider}
                onChange={(e) => {
                  setJobDefaultProvider(e.target.value);
                  setJobDefaultModel("");
                }}
              >
                <option value="">Use env default</option>
                {(config?.aiProviders ?? [])
                  .filter((p) => p.id !== "ollama")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                <option value="ollama">Ollama (not recommended for jobs)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-default-model">Model</Label>
              {jobDefaultProvider && (jobDefaultProvider === "ollama" || jobDefaultProvider === "openrouter") ? (
                <select
                  id="job-default-model"
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={jobDefaultModel}
                  onChange={(e) => setJobDefaultModel(e.target.value)}
                  disabled={jobDefaultModelsLoading}
                >
                  <option value="">Use provider default</option>
                  {jobDefaultModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="job-default-model"
                  className="h-9 text-sm"
                  value={jobDefaultModel}
                  onChange={(e) => setJobDefaultModel(e.target.value)}
                  placeholder={jobDefaultProvider ? "e.g. gpt-4o-mini" : "Set provider first"}
                  disabled={!jobDefaultProvider}
                />
              )}
            </div>
          </div>
          {jobDefaultProvider === "ollama" && (
            <p className="text-amber-600 dark:text-amber-400 text-sm">
              Ollama is not recommended for scheduled jobs. If Ollama is not running when the job runs, the job will fail.
            </p>
          )}
          {jobDefaultMessage && (
            <p
              className={
                jobDefaultMessage.type === "success"
                  ? "text-green-600 dark:text-green-400 text-sm"
                  : "text-destructive text-sm"
              }
            >
              {jobDefaultMessage.text}
            </p>
          )}
          <Button
            onClick={async () => {
              setJobDefaultSaving(true);
              setJobDefaultMessage(null);
              try {
                await updateJobDefault({
                  defaultProvider: jobDefaultProvider.trim() || null,
                  defaultModel: jobDefaultModel.trim() || null,
                });
                setJobDefaultMessage({ type: "success", text: "Job default saved. New jobs using “Use default” will use this." });
              } catch (e) {
                setJobDefaultMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to save" });
              } finally {
                setJobDefaultSaving(false);
              }
            }}
            disabled={jobDefaultSaving}
          >
            {jobDefaultSaving ? "Saving…" : "Save job default"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Ollama</CardTitle>
          <CardDescription>Local AI. No API key required. Install from ollama.com</CardDescription>
        </CardHeader>
        <CardContent>
          {ollamaRunning ? (
            <p className="text-green-600 dark:text-green-400 text-sm">Ollama is running.</p>
          ) : (
            <p className="text-muted-foreground text-sm">Ollama is not running.</p>
          )}
          <Button variant="outline" size="sm" onClick={checkOllama} disabled={ollamaLoading} className="mt-2">
            {ollamaLoading ? "Checking…" : "Check again"}
          </Button>
          <p className="text-muted-foreground mt-2 text-xs">
            Install from <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="underline">ollama.com</a> or run <code>ollama serve</code> in terminal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
