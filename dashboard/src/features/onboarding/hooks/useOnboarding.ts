import { useState, useEffect, useCallback } from "react";
import {
  fetchOnboardStatus,
  putOnboardComplete,
  fetchOnboardEnv,
  putOnboardEnv,
  fetchRecommendedModels,
  fetchAgentSkillsRegistry,
  fetchAgentSkillInstall,
  fetchOllamaStatus,
  postOllamaPull,
  postOllamaInstall,
  fetchSystemCapabilities,
  type OnboardEnvKeys,
  type RecommendedOllamaModel,
  type AgentRegistrySkill,
  type SystemCapabilities,
} from "@/lib/api";

export const PROVIDERS = [
  { id: "openrouter", label: "OpenRouter", envKey: "OPENROUTER_API_KEY", apiKeyUrl: "https://openrouter.ai/keys" },
  { id: "ollama", label: "Ollama (Local – No API Key Required)", envKey: null, apiKeyUrl: null },
  { id: "openai", label: "OpenAI", envKey: "OPENAI_API_KEY", apiKeyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic (Claude)", envKey: "ANTHROPIC_API_KEY", apiKeyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "google", label: "Google / Gemini", envKey: "GOOGLE_GEMINI_API_KEY", apiKeyUrl: "https://aistudio.google.com/app/apikey" },
];

export const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GEMINI_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export type OnboardingState = {
  statusLoading: boolean;
  statusComplete: boolean | null;
  step: number;
  selectedProviders: string[];
  envKeys: OnboardEnvKeys;
  envKeysInput: Record<string, string>;
  recommendedModels: RecommendedOllamaModel[];
  registrySkills: AgentRegistrySkill[];
  selectedSkills: string[];
  ollamaRunning: boolean | null;
  ollamaStatusLoading: boolean;
  pullState: { inProgress: boolean; model: string; lastLine: string; percent: number };
  pullingModels: Set<string>;
  loading: boolean;
  error: string | null;
  systemCapabilities: SystemCapabilities | null;
};

export function useOnboarding(onComplete?: () => void) {
  const [state, setState] = useState<OnboardingState>({
    statusLoading: true,
    statusComplete: null,
    step: 0,
    selectedProviders: [],
    envKeys: {},
    envKeysInput: {},
    recommendedModels: [],
    registrySkills: [],
    selectedSkills: [],
    ollamaRunning: null,
    ollamaStatusLoading: false,
    pullState: { inProgress: false, model: "", lastLine: "", percent: 0 },
    pullingModels: new Set(),
    loading: false,
    error: null,
    systemCapabilities: null,
  });

  const loadStatus = useCallback(async () => {
    setState((s) => ({ ...s, statusLoading: true }));
    try {
      const { complete } = await fetchOnboardStatus();
      setState((s) => ({ ...s, statusComplete: complete, statusLoading: false }));
      return complete;
    } catch (e) {
      setState((s) => ({
        ...s,
        statusComplete: false,
        statusLoading: false,
        error: e instanceof Error ? e.message : "Failed to load status",
      }));
      return false;
    }
  }, []);

  const loadEnv = useCallback(async () => {
    try {
      const { keys } = await fetchOnboardEnv();
      setState((s) => ({ ...s, envKeys: keys }));
      return keys;
    } catch {
      return {};
    }
  }, []);

  const loadRecommendedModels = useCallback(async () => {
    try {
      const { models } = await fetchRecommendedModels();
      setState((s) => ({ ...s, recommendedModels: models }));
      return models;
    } catch {
      return [];
    }
  }, []);

  const loadRegistrySkills = useCallback(async () => {
    try {
      const { skills } = await fetchAgentSkillsRegistry();
      setState((s) => ({ ...s, registrySkills: skills }));
      return skills;
    } catch {
      return [];
    }
  }, []);

  const checkOllama = useCallback(async () => {
    setState((s) => ({ ...s, ollamaStatusLoading: true }));
    try {
      const { running } = await fetchOllamaStatus();
      setState((s) => ({ ...s, ollamaRunning: running, ollamaStatusLoading: false }));
      return running;
    } catch {
      setState((s) => ({ ...s, ollamaRunning: false, ollamaStatusLoading: false }));
      return false;
    }
  }, []);

  const pollPullStatus = useCallback(async () => {
    const { fetchOllamaPullStatus } = await import("@/lib/api");
    const data = await fetchOllamaPullStatus();
    setState((s) => ({ ...s, pullState: data }));
    return data;
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const loadSystemCapabilities = useCallback(async () => {
    try {
      const caps = await fetchSystemCapabilities();
      setState((s) => ({ ...s, systemCapabilities: caps }));
      return caps;
    } catch {
      setState((s) => ({ ...s, systemCapabilities: null }));
      return null;
    }
  }, []);

  useEffect(() => {
    if (state.step === 0) loadSystemCapabilities();
  }, [state.step, loadSystemCapabilities]);

  useEffect(() => {
    if (state.step === 1 || state.step === 2) loadEnv();
  }, [state.step, loadEnv]);

  useEffect(() => {
    if (state.step === 2 && state.selectedProviders.includes("ollama")) {
      loadRecommendedModels();
      checkOllama();
    }
  }, [state.step, state.selectedProviders, loadRecommendedModels, checkOllama]);

  useEffect(() => {
    if (state.step === 4) loadRegistrySkills();
  }, [state.step, loadRegistrySkills]);

  useEffect(() => {
    if (!state.pullState.inProgress) return;
    const t = setInterval(pollPullStatus, 500);
    return () => clearInterval(t);
  }, [state.pullState.inProgress, pollPullStatus]);

  const setStep = (step: number) => setState((s) => ({ ...s, step }));
  const setSelectedProviders = (selectedProviders: string[]) =>
    setState((s) => ({ ...s, selectedProviders }));
  const setEnvKeysInput = (envKeysInput: Record<string, string>) =>
    setState((s) => ({ ...s, envKeysInput }));
  const setSelectedSkills = (selectedSkills: string[]) =>
    setState((s) => ({ ...s, selectedSkills }));
  const setError = (error: string | null) => setState((s) => ({ ...s, error }));

  const saveEnv = async (nextStep?: number, extraKeys?: Record<string, string>) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const keys = state.envKeysInput;
      const filtered: Record<string, string> = { ...extraKeys };
      for (const [k, v] of Object.entries(keys)) {
        if (typeof v === "string" && v.trim()) filtered[k] = v.trim();
      }
      await putOnboardEnv(filtered);
      const { keys: nextKeys } = await fetchOnboardEnv();
      setState((s) => ({ ...s, envKeys: nextKeys, envKeysInput: {}, loading: false, step: nextStep ?? 2 }));
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to save API keys",
      }));
    }
  };

  const installOllama = async () => {
    setState((s) => ({ ...s, error: null }));
    try {
      await postOllamaInstall();
      await checkOllama();
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : "Failed to install Ollama",
      }));
    }
  };

  const pullModel = async (modelId: string) => {
    setState((s) => ({
      ...s,
      pullingModels: new Set(s.pullingModels).add(modelId),
      error: null,
    }));
    try {
      await postOllamaPull(modelId);
      pollPullStatus();
    } catch (e) {
      setState((s) => ({
        ...s,
        pullingModels: (() => {
          const next = new Set(s.pullingModels);
          next.delete(modelId);
          return next;
        })(),
        error: e instanceof Error ? e.message : "Failed to pull model",
      }));
    }
  };

  const installSkill = async (slug: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      await fetchAgentSkillInstall(slug, "managed");
      setState((s) => ({
        ...s,
        selectedSkills: [...new Set([...s.selectedSkills, slug])],
        loading: false,
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to install skill",
      }));
    }
  };

  const finishOnboarding = async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      await putOnboardComplete();
      setState((s) => ({ ...s, statusComplete: true, loading: false }));
      onComplete?.();
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to complete onboarding",
      }));
    }
  };

  return {
    ...state,
    loadStatus,
    loadSystemCapabilities,
    installOllama,
    loadEnv,
    loadRecommendedModels,
    loadRegistrySkills,
    checkOllama,
    setStep,
    setSelectedProviders,
    setEnvKeysInput,
    setSelectedSkills,
    setError,
    saveEnv,
    pullModel,
    installSkill,
    finishOnboarding,
  };
}
