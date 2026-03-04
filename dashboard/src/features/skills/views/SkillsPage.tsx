import { useState } from "react";
import { ArrowLeft, Copy, Eye, EyeOff, LayoutTemplate, Lock, Plus, Puzzle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getHubSkillContentUrl, getHubRegistryUrl, getHubBaseUrl } from "@/lib/api";
import type { AgentRegistrySkill, AgentSkillTemplate } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { useSkills } from "../hooks/useSkills";
import { SkillWizardFlow } from "@/features/skill-wizard";

type SkillsState = ReturnType<typeof useSkills>;

const TEMPLATE_FIELD_LABELS: Record<string, string> = {
  apiKey: "API Key",
  handle: "Handle",
  name: "Name",
  timezone: "Timezone",
};

export function SkillsPage(state: SkillsState) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [templateToUse, setTemplateToUse] = useState<AgentSkillTemplate | null>(null);
  const {
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
    visibleSecretKeys,
    setVisibleSecretKeys,
    loadSkills,
    handleSkillConfigToggle,
    handleSkillEntryUpdate,
    handleSkillEntrySave,
    handleInstallSkill,
    handleUseTemplate,
    handleUpdateSkills,
    refreshRegistry,
    validateSkillEnvConfig,
    templates,
    templatesLoading,
  } = state;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Skills</CardTitle>
            <CardDescription>Config: {skillsConfigPath}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm" onClick={() => setWizardOpen(true)}>
              <Plus className="mr-1 size-4" />
              Create skill
            </Button>
            <input
              className="border-input bg-background h-9 w-48 rounded-md border px-3 text-sm placeholder:text-muted-foreground"
              placeholder="Search…"
              value={skillsSearch}
              onChange={(e) => setSkillsSearch(e.target.value)}
            />
            {skillsTab === "installed" ? (
              <>
                <Button variant="outline" size="sm" onClick={loadSkills} disabled={skillsLoading}>
                  {skillsLoading ? "…" : "Refresh"}
                </Button>
                <Button variant="secondary" size="sm" onClick={handleUpdateSkills} disabled={skillsUpdating}>
                  {skillsUpdating ? "…" : "Update all"}
                </Button>
              </>
            ) : skillsTab === "templates" ? (
              <Button variant="outline" size="sm" onClick={loadSkills} disabled={templatesLoading}>
                {templatesLoading ? "…" : "Refresh"}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={refreshRegistry} disabled={registryLoading}>
                {registryLoading ? "…" : "Refresh"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={skillsTab} onValueChange={(v) => setSkillsTab(v as "installed" | "hub" | "templates")}>
            <TabsList className="mb-4">
              <TabsTrigger value="installed">Installed</TabsTrigger>
              <TabsTrigger value="templates">Templates</TabsTrigger>
              <TabsTrigger value="hub">From Hub</TabsTrigger>
            </TabsList>
            <TabsContent value="installed" className="mt-0">
              <InstalledTab
                skills={skills}
                skillsLoading={skillsLoading}
                skillsSearch={skillsSearch}
                skillsConfig={skillsConfig}
                skillsUpdates={skillsUpdates}
                visibleSecretKeys={visibleSecretKeys}
                setVisibleSecretKeys={setVisibleSecretKeys}
                handleSkillConfigToggle={handleSkillConfigToggle}
                handleSkillEntryUpdate={handleSkillEntryUpdate}
                handleSkillEntrySave={handleSkillEntrySave}
                validateSkillEnvConfig={validateSkillEnvConfig}
              />
            </TabsContent>
            <TabsContent value="templates" className="mt-0">
              <TemplatesTab
                skills={skills}
                templates={templates}
                templatesLoading={templatesLoading}
                installingSlug={installingSlug}
                onUseTemplate={setTemplateToUse}
              />
            </TabsContent>
            <TabsContent value="hub" className="mt-0">
              <HubTab
                skills={skills}
                registrySkills={registrySkills}
                registryLoading={registryLoading}
                skillsSearch={skillsSearch}
                setSelectedHubSkill={setSelectedHubSkill}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <SkillDetailSheet
        skill={selectedHubSkill}
        installingSlug={installingSlug}
        onClose={() => setSelectedHubSkill(null)}
        onInstall={handleInstallSkill}
      />

      <SkillWizardFlow
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onSuccess={loadSkills}
      />

      <UseTemplateDialog
        template={templateToUse}
        installingSlug={installingSlug}
        onClose={() => setTemplateToUse(null)}
        onSubmit={handleUseTemplate}
      />
    </>
  );
}

function InstalledTab({
  skills,
  skillsLoading,
  skillsSearch,
  skillsConfig,
  skillsUpdates,
  visibleSecretKeys,
  setVisibleSecretKeys,
  handleSkillConfigToggle,
  handleSkillEntryUpdate,
  handleSkillEntrySave,
  validateSkillEnvConfig,
}: Pick<
  SkillsState,
  | "skills"
  | "skillsLoading"
  | "skillsSearch"
  | "skillsConfig"
  | "skillsUpdates"
  | "visibleSecretKeys"
  | "setVisibleSecretKeys"
  | "handleSkillConfigToggle"
  | "handleSkillEntryUpdate"
  | "handleSkillEntrySave"
  | "validateSkillEnvConfig"
>) {
  const filtered = skills.filter(
    (s) =>
      !skillsSearch.trim() ||
      s.name.toLowerCase().includes(skillsSearch.toLowerCase()) ||
      s.description.toLowerCase().includes(skillsSearch.toLowerCase())
  );

  if (skillsLoading && !skills.length) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }
  if (filtered.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No installed skills. Add skills to ~/.sulala/workspace/skills/&lt;name&gt;/SKILL.md, or install from the From Hub tab.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {filtered.map((s) => {
        const slug = s.slug ?? s.filePath.split(/[/\\]/).pop()?.replace(/\.md$/, "") ?? s.name;
        const row = { slug, name: s.name, description: s.description, installed: true as const, skill: s };
        const entry = skillsConfig?.entries?.[row.slug] ?? {};
        const enabled = entry.enabled !== false;
        return (
          <SkillCard
            key={row.slug}
            slug={row.slug}
            name={row.name}
            description={s.description}
            category={s.category}
            version={s.version}
            tags={s.tags}
            status={s.status}
            source={s.source}
            env={s.env}
            missing={s.missing}
            enabled={enabled}
            hasUpdate={skillsUpdates.has(row.slug)}
            entry={entry}
            visibleSecretKeys={visibleSecretKeys}
            setVisibleSecretKeys={setVisibleSecretKeys}
            onToggle={() => handleSkillConfigToggle(row.slug, !enabled)}
            onEntryUpdate={(updates) => handleSkillEntryUpdate(row.slug, updates)}
            onEntrySave={(requiredEnv, legacy) => handleSkillEntrySave(row.slug, requiredEnv, legacy)}
            validateSkillEnvConfig={validateSkillEnvConfig}
          />
        );
      })}
    </div>
  );
}

function TemplatesTab({
  skills,
  templates,
  templatesLoading,
  installingSlug,
  onUseTemplate,
}: {
  skills: SkillsState["skills"];
  templates: AgentSkillTemplate[];
  templatesLoading: boolean;
  installingSlug: string | null;
  onUseTemplate: (t: AgentSkillTemplate) => void;
}) {
  const installedSlugs = new Set(
    skills.map((s) => s.slug ?? s.filePath.split(/[/\\]/).pop()?.replace(/\.md$/, "") ?? s.name)
  );
  const available = templates.filter((t) => !installedSlugs.has(t.slug));

  if (templatesLoading && !templates.length) {
    return <p className="text-muted-foreground text-sm">Loading templates…</p>;
  }
  if (available.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {templates.length === 0
          ? "No templates available. Add template skills to the registry."
          : "All templates are already installed. Check Installed or From Hub."}
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {available.map((t) => (
        <article
          key={t.slug}
          className="border-border/70 bg-card/30 flex flex-col gap-3 rounded-xl border p-4"
        >
          <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
            <LayoutTemplate className="size-5" />
          </span>
          <div className="flex flex-1 flex-col gap-2 min-w-0">
            <Badge variant="secondary" className="text-xs w-fit">
              Template
            </Badge>
            <h3 className="font-semibold text-sm">{t.name || t.slug}</h3>
            <p className="text-muted-foreground line-clamp-3 text-xs flex-1">{t.description || ""}</p>
            <Button
              size="sm"
              className="w-fit mt-1"
              disabled={installingSlug !== null}
              onClick={() => onUseTemplate(t)}
            >
              {installingSlug === t.slug ? "Installing…" : "Use template"}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

function UseTemplateDialog({
  template,
  installingSlug,
  onClose,
  onSubmit,
}: {
  template: AgentSkillTemplate | null;
  installingSlug: string | null;
  onClose: () => void;
  onSubmit: (slug: string, formValues: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const open = !!template;
  const requiredFields = template?.requiredFields ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    if (!template) return;
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(template.slug, values);
      setValues({});
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setValues({});
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Use template: {template?.name ?? template?.slug}</DialogTitle>
          <DialogDescription>
            {template?.description}
            {requiredFields.length > 0
              ? " Fill in the fields below; the skill will be installed and configured."
              : " No configuration needed. Click Install to add this skill."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {requiredFields.map((field) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={`template-${field}`}>
                {TEMPLATE_FIELD_LABELS[field] ?? field}
              </Label>
              <input
                id={`template-${field}`}
                type={/password|secret|key|token/i.test(field) ? "password" : "text"}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                value={values[field] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                placeholder={TEMPLATE_FIELD_LABELS[field] ?? field}
                autoComplete="off"
              />
            </div>
          ))}
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || installingSlug !== null}>
              {submitting || installingSlug ? "Installing…" : "Install"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SkillCard({
  slug,
  name,
  description,
  category,
  version,
  tags,
  status,
  source,
  env,
  missing,
  enabled,
  hasUpdate,
  entry,
  visibleSecretKeys,
  setVisibleSecretKeys,
  onToggle,
  onEntryUpdate,
  onEntrySave,
  validateSkillEnvConfig,
}: {
  slug: string;
  name: string;
  description: string;
  category?: string;
  version?: string;
  tags?: string[];
  status: string;
  source?: string;
  env?: string[];
  missing?: string[];
  enabled: boolean;
  hasUpdate: boolean;
  entry: Record<string, unknown>;
  visibleSecretKeys: Record<string, boolean>;
  setVisibleSecretKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onToggle: () => void;
  onEntryUpdate: (updates: Record<string, unknown>) => void;
  onEntrySave: (requiredEnv?: string[], legacy?: Record<string, unknown>) => void;
  validateSkillEnvConfig: (
    entry: Record<string, unknown>,
    envVars: string[],
    legacy?: Record<string, unknown>
  ) => { valid: boolean; errors: Record<string, string> };
}) {
  return (
    <article className="border-border/70 bg-card/30 flex flex-col gap-3 rounded-xl border p-4">
      <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
        <Puzzle className="size-5" />
      </span>
      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-xs">
            Free
          </Badge>
          {category && (
            <Badge variant="outline" className="text-xs">
              {category}
            </Badge>
          )}
          {version && <span className="text-xs text-muted-foreground">v{version}</span>}
          {hasUpdate && (
            <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400">
              Update
            </Badge>
          )}
          <Badge variant={status === "eligible" ? "default" : status === "blocked" ? "destructive" : "secondary"}>
            {status}
          </Badge>
        </div>
        <h3 className="font-semibold text-sm">{name}</h3>
        <p className="text-muted-foreground line-clamp-3 text-xs flex-1">{description}</p>
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 4).map((t) => (
              <span key={t} className="text-xs text-muted-foreground/80">
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant={enabled ? "outline" : "secondary"} size="sm" className="h-8" onClick={onToggle}>
            {enabled ? "Disable" : "Enable"}
          </Button>
          {source && <span className="text-xs text-muted-foreground capitalize">{source}</span>}
        </div>
      </div>
      <SkillPermissionsForm
        entry={entry}
        onEntryUpdate={onEntryUpdate}
        onEntrySave={onEntrySave}
      />
      {env && env.length > 0 && (
        <SkillEnvForm
          slug={slug}
          env={env}
          entry={entry}
          visibleSecretKeys={visibleSecretKeys}
          setVisibleSecretKeys={setVisibleSecretKeys}
          onEntryUpdate={onEntryUpdate}
          onEntrySave={onEntrySave}
          validateSkillEnvConfig={validateSkillEnvConfig}
        />
      )}
      {missing && missing.length > 0 && (
        <p className="text-muted-foreground text-xs">Missing bins: {missing.join(", ")}</p>
      )}
    </article>
  );
}

function SkillPermissionsForm({
  entry,
  onEntryUpdate,
  onEntrySave,
}: {
  entry: Record<string, unknown>;
  onEntryUpdate: (updates: Record<string, unknown>) => void;
  onEntrySave: (requiredEnv?: string[], legacy?: Record<string, unknown>) => void;
}) {
  const readOnly = entry.readOnly === true;
  const allowedToolsRaw = Array.isArray(entry.allowedTools)
    ? entry.allowedTools.join(", ")
    : typeof entry.allowedTools === "string"
      ? entry.allowedTools
      : "";

  const setReadOnly = (checked: boolean) => {
    onEntryUpdate({ ...entry, readOnly: checked });
    onEntrySave(undefined, undefined);
  };

  const setAllowedTools = (value: string) => {
    const arr = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onEntryUpdate({ ...entry, allowedTools: arr.length ? arr : undefined });
  };

  return (
    <div className="mt-1 flex flex-col gap-2 border-t pt-2 text-xs">
      <div className="text-muted-foreground flex items-center gap-1.5 font-medium">
        <Lock className="size-3.5" />
        Permissions
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={readOnly}
          onChange={(e) => setReadOnly(e.target.checked)}
          className="size-4 rounded border-input"
        />
        <span className="text-muted-foreground">Read only</span>
      </label>
      <div>
        <label className="text-muted-foreground block mb-0.5">Allowed tools</label>
        <input
          type="text"
          placeholder="Leave empty for global allowlist"
          value={allowedToolsRaw}
          onChange={(e) => setAllowedTools(e.target.value)}
          onBlur={() => onEntrySave(undefined, undefined)}
          className="border-input bg-background w-full rounded px-2 py-1.5 text-xs"
          aria-label="Allowed tools"
        />
        <p className="text-muted-foreground mt-0.5 text-[10px]">
          Comma-separated (e.g. read_file, run_task). Empty = use global.
        </p>
      </div>
    </div>
  );
}

function SkillEnvForm({
  slug,
  env,
  entry,
  visibleSecretKeys,
  setVisibleSecretKeys,
  onEntryUpdate,
  onEntrySave,
  validateSkillEnvConfig,
}: {
  slug: string;
  env: string[];
  entry: Record<string, unknown>;
  visibleSecretKeys: Record<string, boolean>;
  setVisibleSecretKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onEntryUpdate: (updates: Record<string, unknown>) => void;
  onEntrySave: (requiredEnv?: string[], legacy?: Record<string, unknown>) => void;
  validateSkillEnvConfig: (
    entry: Record<string, unknown>,
    envVars: string[],
    legacy?: Record<string, unknown>
  ) => { valid: boolean; errors: Record<string, string> };
}) {
  const legacy: Record<string, unknown> | undefined =
    slug === "bluesky" ? { BSKY_HANDLE: entry.handle, BSKY_APP_PASSWORD: entry.apiKey } : undefined;
  const validation = validateSkillEnvConfig(entry, env, legacy);
  const showEyeForKey = (key: string) => /PASSWORD|SECRET|KEY|TOKEN/i.test(key);

  return (
    <div className="mt-1 flex flex-wrap gap-3 border-t pt-2 text-xs">
      {env.map((envVar) => {
        const raw = entry[envVar] ?? legacy?.[envVar];
        const isRedacted = raw === "set";
        const value = isRedacted ? "" : String(raw ?? "");
        const err = validation.errors[envVar];
        const id = `skill-${slug}-${envVar}`;
        const visibleKey = `${slug}-${envVar}`;
        const visible = visibleSecretKeys[visibleKey];
        return (
          <div key={envVar} className="min-w-[140px]">
            <label className="text-muted-foreground block" htmlFor={id}>
              {envVar}
            </label>
            <div className="relative mt-0.5">
              <input
                id={id}
                type={showEyeForKey(envVar) ? (visible ? "text" : "password") : "text"}
                placeholder={isRedacted ? "(already set)" : envVar}
                value={value}
                onChange={(e) => {
                  const v = e.target.value;
                  const updates: Record<string, unknown> = { ...entry, [envVar]: v };
                  if (slug === "bluesky" && envVar === "BSKY_HANDLE") updates.handle = v;
                  if (slug === "bluesky" && envVar === "BSKY_APP_PASSWORD") updates.apiKey = v;
                  onEntryUpdate(updates);
                }}
                onBlur={() => onEntrySave(env, legacy)}
                className={`border-input bg-background w-full rounded px-2 py-1 ${showEyeForKey(envVar) ? "pr-8" : ""} ${err ? "border-destructive" : ""}`}
                aria-invalid={!!err}
                aria-describedby={err ? `${id}-err` : undefined}
              />
              {showEyeForKey(envVar) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setVisibleSecretKeys((prev) => ({ ...prev, [visibleKey]: !prev[visibleKey] }))}
                  aria-label={visible ? "Hide" : "Show"}
                >
                  {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
            </div>
            {err && (
              <p id={`${id}-err`} className="text-destructive mt-0.5 text-xs">
                {err}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HubTab({
  skills,
  registrySkills,
  registryLoading,
  skillsSearch,
  setSelectedHubSkill,
}: {
  skills: SkillsState["skills"];
  registrySkills: SkillsState["registrySkills"];
  registryLoading: boolean;
  skillsSearch: string;
  setSelectedHubSkill: (s: AgentRegistrySkill | null) => void;
}) {
  const installedSlugs = new Set(
    skills
      .filter((s) => s.source === "user" || s.source === "workspace" || s.source === "managed")
      .map((s) => s.slug ?? s.name)
  );
  const rows = registrySkills.filter((r) => !installedSlugs.has(r.slug));
  const filtered = rows.filter(
    (r) =>
      !skillsSearch.trim() ||
      (r.name || r.slug).toLowerCase().includes(skillsSearch.toLowerCase()) ||
      (r.description || "").toLowerCase().includes(skillsSearch.toLowerCase())
  );

  if (registryLoading && !registrySkills.length) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }
  if (filtered.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {rows.length === 0
          ? "All hub skills are already installed, or the hub registry is empty."
          : "No matching skills. Try a different search."}
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {filtered.map((r) => {
        const priceLabel =
          r.priceCents != null && r.priceCents > 0 ? `$${(r.priceCents / 100).toFixed(2)}` : "Free";
        return (
          <article key={r.slug} className="border-border/70 bg-card/30 flex flex-col gap-3 rounded-xl border p-4">
            <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
              <Puzzle className="size-5" />
            </span>
            <div className="flex flex-1 flex-col gap-2 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="text-xs">
                  {priceLabel}
                </Badge>
                {r.category && (
                  <Badge variant="outline" className="text-xs">
                    {r.category}
                  </Badge>
                )}
                {r.version && <span className="text-xs text-muted-foreground">v{r.version}</span>}
              </div>
              <h3 className="font-semibold text-sm">{r.name || r.slug}</h3>
              <p className="text-muted-foreground line-clamp-3 text-xs flex-1">{r.description || ""}</p>
              {r.tags && r.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {r.tags.slice(0, 4).map((t) => (
                    <span key={t} className="text-xs text-muted-foreground/80">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
              <Button variant="outline" size="sm" className="w-fit mt-1" onClick={() => setSelectedHubSkill(r)}>
                View & install
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SkillDetailSheet({
  skill,
  installingSlug,
  onClose,
  onInstall,
}: {
  skill: AgentRegistrySkill | null;
  installingSlug: string | null;
  onClose: () => void;
  onInstall: (slug: string, target: "managed" | "workspace") => Promise<void>;
}) {
  if (!skill) return null;

  const isPaid = (skill.priceCents ?? 0) > 0;
  const hubBaseUrl = getHubBaseUrl();
  const storeSkillUrl = hubBaseUrl ? `${hubBaseUrl}/skills/${skill.slug}` : null;

  return (
    <Sheet open={!!skill} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-lg sm:max-w-xl overflow-y-auto p-6 sm:p-8">
        <SheetHeader className="space-y-3 p-0">
          <Button variant="ghost" size="sm" className="w-fit -ml-2" onClick={onClose}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to skills
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isPaid ? "default" : "secondary"}>
              {isPaid ? `$${(skill.priceCents! / 100).toFixed(2)}` : "Free"}
            </Badge>
            {skill.category && <Badge variant="outline">{skill.category}</Badge>}
            {skill.version && <Badge variant="secondary">v{skill.version}</Badge>}
            {skill.tags?.map((t) => (
              <Badge key={t} variant="secondary" className="font-normal">
                #{t}
              </Badge>
            ))}
          </div>
          <SheetTitle className="text-left">{skill.name || skill.slug}</SheetTitle>
          <SheetDescription className="text-left">{skill.description}</SheetDescription>
          {(skill.creatorName || skill.creatorId) && (
            <p className="text-xs text-muted-foreground">
              Creator: {skill.creatorName ?? skill.creatorId}
            </p>
          )}
        </SheetHeader>
        <div className="mt-6 space-y-6">
          {isPaid ? (
            <Card className="p-4">
              <CardHeader className="px-0 pt-0 pb-3">
                <CardTitle className="text-sm">Purchase required</CardTitle>
                <CardDescription className="text-xs mt-1.5">
                  This skill is paid. Buy it on the store to get an install URL with your license.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0 pb-0 pt-2 space-y-3">
                {storeSkillUrl ? (
                  <Button asChild>
                    <a href={storeSkillUrl} target="_blank" rel="noopener noreferrer">
                      Buy on store
                    </a>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Set VITE_SKILLS_REGISTRY_URL to the hub base URL to see the store link.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <div>
                <h4 className="text-sm font-medium mb-2">Install directly</h4>
                <Button
                  disabled={installingSlug !== null}
                  onClick={async () => {
                    await onInstall(skill.slug, "workspace");
                    onClose();
                  }}
                >
                  {installingSlug === skill.slug ? "Installing…" : "Install"}
                </Button>
              </div>
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Install via URL or CLI</CardTitle>
                  <CardDescription className="text-xs">
                    For users who want to install from the command line or use the install URL.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {getHubSkillContentUrl(skill.slug) && (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground block mb-1">Install URL</label>
                        <div className="flex gap-1">
                          <input
                            readOnly
                            className="border-input bg-muted flex-1 rounded px-2 py-1.5 font-mono text-xs"
                            value={getHubSkillContentUrl(skill.slug)!}
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="shrink-0 h-8 w-8"
                            onClick={() => navigator.clipboard.writeText(getHubSkillContentUrl(skill.slug)!)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        CLI:{" "}
                        <code className="rounded bg-muted px-1 py-0.5">
                          sulala skill install --from-url="{getHubSkillContentUrl(skill.slug)}"
                        </code>
                      </p>
                    </>
                  )}
                  {getHubRegistryUrl() && (
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">Registry URL (for env)</label>
                      <div className="flex gap-1">
                        <input
                          readOnly
                          className="border-input bg-muted flex-1 rounded px-2 py-1.5 font-mono text-xs"
                          value={`SKILLS_REGISTRY_URL=${getHubRegistryUrl()}`}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="shrink-0 h-8 w-8"
                          onClick={() => navigator.clipboard.writeText(`SKILLS_REGISTRY_URL=${getHubRegistryUrl()}`)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Then:{" "}
                        <code className="rounded bg-muted px-1 py-0.5">
                          sulala skill install {skill.slug}
                        </code>
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
