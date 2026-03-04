import { useState } from "react";
import {
  fetchAgentSkills,
  fetchAgentSkillsRegistry,
  fetchAgentSkillsConfig,
  fetchAgentSkillsConfigSave,
  fetchAgentSkillsUpdates,
  fetchAgentSkillsUpdate,
  fetchAgentSkillInstall,
  fetchAgentSkillsTemplates,
} from "@/lib/api";
import type { AgentSkill, AgentRegistrySkill, AgentSkillsConfig, AgentSkillTemplate } from "@/lib/api";

export function useSkills(onError: (msg: string) => void) {
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsSearch, setSkillsSearch] = useState("");
  const [registrySkills, setRegistrySkills] = useState<AgentRegistrySkill[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [selectedHubSkill, setSelectedHubSkill] = useState<AgentRegistrySkill | null>(null);
  const [skillsUpdating, setSkillsUpdating] = useState(false);
  const [skillsConfig, setSkillsConfig] = useState<AgentSkillsConfig | null>(null);
  const [skillsConfigPath, setSkillsConfigPath] = useState<string>("~/.sulala/config.json");
  const [skillsUpdates, setSkillsUpdates] = useState<Set<string>>(new Set());
  const [skillsTab, setSkillsTab] = useState<"installed" | "hub" | "templates">("installed");
  const [templates, setTemplates] = useState<AgentSkillTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [visibleSecretKeys, setVisibleSecretKeys] = useState<Record<string, boolean>>({});
  const loadSkills = () => {
    setSkillsLoading(true);
    fetchAgentSkills()
      .then((r) => setSkills(r.skills || []))
      .catch(() => setSkills([]))
      .finally(() => setSkillsLoading(false));
  };

  const loadSkillsData = () => {
    loadSkills();
    setRegistryLoading(true);
    fetchAgentSkillsConfig()
      .then((r) => {
        setSkillsConfig(r.skills ?? null);
        if (r.configPath) setSkillsConfigPath(r.configPath);
      })
      .catch(() => setSkillsConfig(null));
    fetchAgentSkillsUpdates()
      .then((r) => setSkillsUpdates(new Set(r.updates.map((u) => u.slug))))
      .catch(() => setSkillsUpdates(new Set()));
    fetchAgentSkillsRegistry()
      .then((r) => setRegistrySkills(r.skills || []))
      .catch(() => setRegistrySkills([]))
      .finally(() => setRegistryLoading(false));
    setTemplatesLoading(true);
    fetchAgentSkillsTemplates()
      .then((r) => setTemplates(r.templates || []))
      .catch(() => setTemplates([]))
      .finally(() => setTemplatesLoading(false));
  };

  const validateSkillEnvConfig = (
    entry: Record<string, unknown>,
    envVars: string[],
    legacy?: Record<string, unknown>
  ): { valid: boolean; errors: Record<string, string> } => {
    const errors: Record<string, string> = {};
    for (const envVar of envVars) {
      const v = entry[envVar] ?? legacy?.[envVar];
      const s = typeof v === "string" ? v.trim() : "";
      if (!s) errors[envVar] = `Required (${envVar})`;
    }
    return { valid: Object.keys(errors).length === 0, errors };
  };

  const handleSkillConfigToggle = async (slug: string, enabled: boolean) => {
    const existing = skillsConfig?.entries?.[slug] ?? {};
    const next = { ...skillsConfig, entries: { ...skillsConfig?.entries, [slug]: { ...existing, enabled } } };
    setSkillsConfig(next);
    try {
      const res = await fetchAgentSkillsConfigSave(next);
      if (res.configPath) setSkillsConfigPath(res.configPath);
      loadSkills();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save config");
    }
  };

  const handleSkillEntryUpdate = (slug: string, updates: Record<string, unknown>) => {
    const existing = skillsConfig?.entries?.[slug] ?? {};
    setSkillsConfig({ ...skillsConfig, entries: { ...skillsConfig?.entries, [slug]: { ...existing, ...updates } } });
  };

  const handleSkillEntrySave = async (slug?: string, requiredEnv?: string[], legacy?: Record<string, unknown>) => {
    if (!skillsConfig) return;
    if (slug && requiredEnv?.length) {
      const entry = skillsConfig?.entries?.[slug] ?? {};
      const { valid, errors } = validateSkillEnvConfig(entry as Record<string, unknown>, requiredEnv, legacy);
      if (!valid) {
        onError(`Set required values: ${Object.keys(errors).join(", ")}`);
        return;
      }
    }
    try {
      await fetchAgentSkillsConfigSave(skillsConfig);
      onError(null as unknown as string);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save config");
    }
  };

  const handleInstallSkill = async (slug: string, target: "managed" | "workspace") => {
    setInstallingSlug(slug);
    try {
      await fetchAgentSkillInstall(slug, target);
      loadSkills();
      const r = await fetchAgentSkillsConfig();
      setSkillsConfig(r.skills ?? null);
      if (r.configPath) setSkillsConfigPath(r.configPath);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Install failed");
    } finally {
      setInstallingSlug(null);
    }
  };

  const handleUpdateSkills = async () => {
    setSkillsUpdating(true);
    try {
      const r = await fetchAgentSkillsUpdate();
      loadSkills();
      if (r.failed.length > 0) onError(`Update failed: ${r.failed.map((f) => f.slug).join(", ")}`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSkillsUpdating(false);
    }
  };

  const refreshRegistry = () => {
    setRegistryLoading(true);
    fetchAgentSkillsRegistry()
      .then((r) => setRegistrySkills(r.skills || []))
      .catch(() => setRegistrySkills([]))
      .finally(() => setRegistryLoading(false));
  };

  const handleUseTemplate = async (
    slug: string,
    formValues: Record<string, string>
  ): Promise<void> => {
    setInstallingSlug(slug);
    try {
      await fetchAgentSkillInstall(slug, "workspace");
      const r = await fetchAgentSkillsConfig();
      const config = r.skills ?? { entries: {} };
      const entries = { ...config.entries, [slug]: { enabled: true, ...formValues } };
      await fetchAgentSkillsConfigSave({ ...config, entries });
      setSkillsConfig({ ...config, entries });
      loadSkills();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Template setup failed");
    } finally {
      setInstallingSlug(null);
    }
  };

  return {
    skills,
    skillsLoading,
    skillsSearch,
    setSkillsSearch,
    registrySkills,
    registryLoading,
    installingSlug,
    selectedHubSkill,
    setSelectedHubSkill,
    skillsUpdating,
    skillsConfig,
    skillsConfigPath,
    skillsUpdates,
    skillsTab,
    setSkillsTab,
    templates,
    templatesLoading,
    visibleSecretKeys,
    setVisibleSecretKeys,
    loadSkills,
    loadSkillsData,
    handleSkillConfigToggle,
    handleSkillEntryUpdate,
    handleSkillEntrySave,
    handleInstallSkill,
    handleUseTemplate,
    handleUpdateSkills,
    refreshRegistry,
    validateSkillEnvConfig,
  };
}
