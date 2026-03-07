import { useRef, useState } from "react";
import { ArrowLeft, Copy, Eye, EyeOff, Lock, MoreVertical, Plus, Puzzle, Share2, Upload } from "lucide-react";
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
import type { AgentRegistrySkill } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { useSkills } from "../hooks/useSkills";
import { SkillWizardFlow } from "@/features/skill-wizard";

type SkillsState = ReturnType<typeof useSkills>;

export function SkillsPage(state: SkillsState) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [publishDialog, setPublishDialog] = useState<{ slug: string; name: string } | null>(null);
  const {
    skills,
    skillsLoading,
    skillsSearch,
    setSkillsSearch,
    registrySkills,
    registryLoading,
    systemRegistrySkills,
    systemRegistryLoading,
    installingSlug,
    uploadingSkill,
    publishingSlug,
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
    handleUploadSkill,
    handleUninstallSkill,
    handlePublishSkill,
    handleUpdateSkills,
    refreshRegistry,
    validateSkillEnvConfig,
    publishStatusMap,
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
            <Button variant="outline" size="sm" onClick={() => setUploadDialogOpen(true)}>
              <Upload className="mr-1 size-4" />
              Upload skill
            </Button>
            <input
              className="border-input bg-background h-9 w-48 rounded-md border px-3 text-sm placeholder:text-muted-foreground"
              placeholder="Search…"
              value={skillsSearch}
              onChange={(e) => setSkillsSearch(e.target.value)}
            />
            {skillsTab === "installed" || skillsTab === "myskills" ? (
              <>
                <Button variant="outline" size="sm" onClick={loadSkills} disabled={skillsLoading}>
                  {skillsLoading ? "…" : "Refresh"}
                </Button>
                {skillsTab === "installed" && (
                  <Button variant="secondary" size="sm" onClick={handleUpdateSkills} disabled={skillsUpdating}>
                    {skillsUpdating ? "…" : "Update all"}
                  </Button>
                )}
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={refreshRegistry} disabled={registryLoading}>
                {registryLoading ? "…" : "Refresh"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={skillsTab} onValueChange={(v) => setSkillsTab(v as "installed" | "myskills" | "hub")}>
            <TabsList className="mb-4">
              <TabsTrigger value="installed">Installed</TabsTrigger>
              <TabsTrigger value="myskills">My skills</TabsTrigger>
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
                handleUninstallSkill={handleUninstallSkill}
                onPublishOpen={(slug, name) => setPublishDialog({ slug, name })}
                validateSkillEnvConfig={validateSkillEnvConfig}
                publishStatusMap={publishStatusMap}
              />
            </TabsContent>
            <TabsContent value="myskills" className="mt-0">
              <InstalledTab
                skills={skills.filter((s) => s.source === "user")}
                skillsLoading={skillsLoading}
                skillsSearch={skillsSearch}
                skillsConfig={skillsConfig}
                skillsUpdates={skillsUpdates}
                visibleSecretKeys={visibleSecretKeys}
                setVisibleSecretKeys={setVisibleSecretKeys}
                handleSkillConfigToggle={handleSkillConfigToggle}
                handleSkillEntryUpdate={handleSkillEntryUpdate}
                handleSkillEntrySave={handleSkillEntrySave}
                handleUninstallSkill={handleUninstallSkill}
                onPublishOpen={(slug, name) => setPublishDialog({ slug, name })}
                validateSkillEnvConfig={validateSkillEnvConfig}
                publishStatusMap={publishStatusMap}
                emptyMessage={
                  <>
                    Skills you or the AI created appear here. They’re stored in{" "}
                    <code className="text-xs">~/.sulala/workspace/skills/my/&lt;name&gt;/README.md</code>. Create one via
                    &quot;Create skill&quot; or ask the agent to create a skill for you.
                  </>
                }
              />
            </TabsContent>
            <TabsContent value="hub" className="mt-0">
              <HubTab
                skills={skills}
                registrySkills={registrySkills}
                registryLoading={registryLoading}
                systemRegistrySkills={systemRegistrySkills}
                systemRegistryLoading={systemRegistryLoading}
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

      <UploadSkillDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUpload={handleUploadSkill}
        uploading={uploadingSkill}
      />

      <PublishToStoreDialog
        slug={publishDialog?.slug}
        name={publishDialog?.name}
        onClose={() => setPublishDialog(null)}
        onPublish={handlePublishSkill}
        publishingSlug={publishingSlug}
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
  handleUninstallSkill,
  onPublishOpen,
  validateSkillEnvConfig,
  publishStatusMap,
  emptyMessage,
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
  | "handleUninstallSkill"
  | "validateSkillEnvConfig"
  | "publishStatusMap"
> & { onPublishOpen?: (slug: string, name: string) => void; emptyMessage?: React.ReactNode }) {
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
        {emptyMessage ?? (
          <>
            No installed skills. Add skills to ~/.sulala/workspace/skills/&lt;name&gt;/README.md, or install from the From Hub tab.
          </>
        )}
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
        // Debug: log env and envHints coming from API for each skill
        // eslint-disable-next-line no-console
        console.debug("[InstalledTab] skill", row.slug, "env", s.env, "envHints", (s as any).envHints);
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
            envHints={(s as any).envHints}
            oauthScopes={s.oauthScopes}
            missing={s.missing}
            enabled={enabled}
            hasUpdate={skillsUpdates.has(row.slug)}
            entry={entry}
            visibleSecretKeys={visibleSecretKeys}
            setVisibleSecretKeys={setVisibleSecretKeys}
            onToggle={() => handleSkillConfigToggle(row.slug, !enabled)}
            onEntryUpdate={(updates) => handleSkillEntryUpdate(row.slug, updates)}
            onEntrySave={(requiredEnv, legacy) => handleSkillEntrySave(row.slug, requiredEnv, legacy)}
            canUninstall={s.source === "user" || s.source === "installed"}
            onUninstall={() => handleUninstallSkill(row.slug, s.source)}
            canPublish={s.source === "user" && !!onPublishOpen}
            onPublish={onPublishOpen ? () => onPublishOpen(row.slug, row.name) : undefined}
            publishStatus={publishStatusMap?.[row.slug]}
            validateSkillEnvConfig={validateSkillEnvConfig}
          />
        );
      })}
    </div>
  );
}

function UploadSkillDialog({
  open,
  onOpenChange,
  onUpload,
  uploading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (markdown: string, slug?: string, toolsYaml?: string) => Promise<void>;
  uploading: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolsFileInputRef = useRef<HTMLInputElement>(null);
  const [markdown, setMarkdown] = useState("");
  const [slug, setSlug] = useState("");
  const [toolsYaml, setToolsYaml] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file?.name.endsWith(".md")) {
      const r = new FileReader();
      r.onload = () => setMarkdown(String(r.result ?? ""));
      r.readAsText(file);
    }
    e.target.value = "";
  };

  const handleToolsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (file.name.endsWith(".yaml") || file.name.endsWith(".yml"))) {
      const r = new FileReader();
      r.onload = () => setToolsYaml(String(r.result ?? ""));
      r.readAsText(file);
    }
    e.target.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const content = markdown.trim();
    if (!content) {
      setError("Paste or upload a skill markdown file.");
      return;
    }
    try {
      await onUpload(content, slug.trim() || undefined, toolsYaml.trim() || undefined);
      setMarkdown("");
      setSlug("");
      setToolsYaml("");
      onOpenChange(false);
    } catch {
      // onError handled in hook
    }
  };

  const handleClose = () => {
    setMarkdown("");
    setSlug("");
    setToolsYaml("");
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton>
        <DialogHeader>
          <DialogTitle>Upload skill</DialogTitle>
          <DialogDescription>
            Paste or upload a skill .md file (required) and optional tools.yaml. The skill will be saved to your workspace and enabled.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file (.md)
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
            <Label htmlFor="upload-markdown">Skill Markdown (full file with frontmatter)</Label>
            <textarea
              id="upload-markdown"
              className="min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder="---\nname: my-skill\ndescription: Use when...\n---\n\n# My Skill\n..."
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => toolsFileInputRef.current?.click()}
              >
                Choose file (.yaml)
              </Button>
              <input
                ref={toolsFileInputRef}
                type="file"
                accept=".yaml,.yml"
                className="hidden"
                onChange={handleToolsFileChange}
              />
            </div>
            <Label htmlFor="upload-tools">tools.yaml (optional)</Label>
            <textarea
              id="upload-tools"
              className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
              value={toolsYaml}
              onChange={(e) => setToolsYaml(e.target.value)}
              placeholder="tools:\n  - name: my_tool\n    description: ...\n    auth: none\n    request: ..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="upload-slug">Slug (optional, derived from name if empty)</Label>
            <Input
              id="upload-slug"
              placeholder="my-skill"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={uploading}>
              {uploading ? "Uploading…" : "Upload & use"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PublishToStoreDialog({
  slug,
  name,
  onClose,
  onPublish,
  publishingSlug,
}: {
  slug: string | undefined;
  name: string | undefined;
  onClose: () => void;
  onPublish: (slug: string, options: { priceIntent: "free" | "paid"; intendedPriceCents?: number }) => Promise<void>;
  publishingSlug: string | null;
}) {
  const [priceIntent, setPriceIntent] = useState<"free" | "paid">("free");
  const [priceDollars, setPriceDollars] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = !!slug;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug) return;
    setError(null);
    try {
      const intendedPriceCents =
        priceIntent === "paid" && priceDollars.trim() !== ""
          ? Math.round(parseFloat(priceDollars) * 100)
          : undefined;
      await onPublish(slug, {
        priceIntent,
        intendedPriceCents: intendedPriceCents !== undefined && Number.isFinite(intendedPriceCents) ? intendedPriceCents : undefined,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed. Set SKILLS_REGISTRY_URL in the agent .env to your store (e.g. http://localhost:3002).");
    }
  };

  const handleClose = () => {
    setSuccess(false);
    setError(null);
    setPriceIntent("free");
    setPriceDollars("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Publish to store</DialogTitle>
          <DialogDescription>
            Submit &quot;{name ?? slug}&quot; to the skill store. Others can install it after an admin approves. Set <code className="text-xs">SKILLS_REGISTRY_URL</code> in the agent .env to your store URL (e.g. http://localhost:3002). No API key needed unless your store requires one.
          </DialogDescription>
        </DialogHeader>
        {success ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Submitted to the store. An admin will review it. You can track it under My skills on the store.
            </p>
            <DialogFooter>
              <Button onClick={handleClose}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Price</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="priceIntent"
                    checked={priceIntent === "free"}
                    onChange={() => setPriceIntent("free")}
                  />
                  Free
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="priceIntent"
                    checked={priceIntent === "paid"}
                    onChange={() => setPriceIntent("paid")}
                  />
                  Paid
                </label>
              </div>
            </div>
            {priceIntent === "paid" && (
              <div className="space-y-2">
                <Label htmlFor="publish-price">Price (USD)</Label>
                <Input
                  id="publish-price"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="4.99"
                  value={priceDollars}
                  onChange={(e) => setPriceDollars(e.target.value)}
                />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!!publishingSlug}>
                {publishingSlug === slug ? "Submitting…" : "Submit to store"}
              </Button>
            </DialogFooter>
          </form>
        )}
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
  envHints,
  oauthScopes,
  missing,
  enabled,
  hasUpdate,
  entry,
  visibleSecretKeys,
  setVisibleSecretKeys,
  onToggle,
  onEntryUpdate,
  onEntrySave,
  canUninstall,
  onUninstall,
  canPublish,
  onPublish,
  publishStatus,
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
  envHints?: Record<string, string>;
  oauthScopes?: string[];
  missing?: string[];
  enabled: boolean;
  hasUpdate: boolean;
  entry: Record<string, unknown>;
  visibleSecretKeys: Record<string, boolean>;
  setVisibleSecretKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onToggle: () => void;
  onEntryUpdate: (updates: Record<string, unknown>) => void;
  onEntrySave: (requiredEnv?: string[], legacy?: Record<string, unknown>) => void;
  canUninstall?: boolean;
  onUninstall?: () => void;
  canPublish?: boolean;
  onPublish?: () => void;
  publishStatus?: "pending" | "approved";
  validateSkillEnvConfig: (
    entry: Record<string, unknown>,
    envVars: string[],
    legacy?: Record<string, unknown>
  ) => { valid: boolean; errors: Record<string, string> };
}) {
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);
  // Debug: inspect envHints arriving at SkillCard
  // eslint-disable-next-line no-console
  console.debug("[SkillCard] skill", slug, "env", env, "envHints", envHints);
  return (
    <article className="border-border/70 bg-card/30 relative flex flex-col gap-3 rounded-xl border p-4">
      <div className="absolute right-3 top-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground size-8 shrink-0">
                <MoreVertical className="size-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onToggle}>
                {enabled ? "Disable" : "Enable"}
              </DropdownMenuItem>
              {canPublish && onPublish && !publishStatus && (
                <DropdownMenuItem onClick={onPublish}>
                  <Share2 className="size-4" />
                  Publish to store
                </DropdownMenuItem>
              )}
              {canUninstall && onUninstall && (
                <DropdownMenuItem variant="destructive" onClick={() => setUninstallDialogOpen(true)}>
                  Uninstall
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
     
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
          {publishStatus === "approved" && (
            <Badge variant="default" className="text-xs">
              Approved
            </Badge>
          )}
          {publishStatus === "pending" && (
            <Badge variant="secondary" className="text-xs">
              Pending review
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
          {publishStatus === "pending" && (
            <span className="text-muted-foreground text-xs">Already submitted</span>
          )}
          {publishStatus === "approved" && (
            <span className="text-muted-foreground text-xs">Published</span>
          )}
          {source && <span className="text-xs text-muted-foreground capitalize">{source}</span>}
        </div>
      </div>
      <Dialog open={uninstallDialogOpen} onOpenChange={setUninstallDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove skill?</DialogTitle>
            <DialogDescription>
              &quot;{name}&quot; will be uninstalled. You can install it again from the hub later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUninstallDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onUninstall?.();
                setUninstallDialogOpen(false);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SkillPermissionsForm
        entry={entry}
        onEntryUpdate={onEntryUpdate}
        onEntrySave={onEntrySave}
      />
      {env && env.length > 0 && (
        <SkillEnvForm
          slug={slug}
          env={env}
          envHints={envHints}
          entry={entry}
          visibleSecretKeys={visibleSecretKeys}
          setVisibleSecretKeys={setVisibleSecretKeys}
          onEntryUpdate={onEntryUpdate}
          onEntrySave={onEntrySave}
          validateSkillEnvConfig={validateSkillEnvConfig}
        />
      )}
      {(oauthScopes?.length || (Array.isArray(entry.oauthScopes) && entry.oauthScopes.length > 0)) && (
        <SkillOAuthScopesForm
          slug={slug}
          defaultScopes={oauthScopes}
          entry={entry}
          onEntryUpdate={onEntryUpdate}
          onEntrySave={onEntrySave}
          env={env}
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

function SkillOAuthScopesForm({
  slug,
  defaultScopes,
  entry,
  onEntryUpdate,
  onEntrySave,
  env,
}: {
  slug: string;
  defaultScopes?: string[];
  entry: Record<string, unknown>;
  onEntryUpdate: (updates: Record<string, unknown>) => void;
  onEntrySave: (requiredEnv?: string[], legacy?: Record<string, unknown>) => void;
  env?: string[];
}) {
  const entryScopes = Array.isArray(entry.oauthScopes) ? entry.oauthScopes : undefined;
  const scopes = entryScopes ?? defaultScopes ?? [];
  const value = scopes.join("\n");

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    const next = raw
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    onEntryUpdate({ ...entry, oauthScopes: next });
  };

  const handleBlur = () => {
    onEntrySave(env, undefined);
  };

  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t pt-2 text-xs">
      <div className="text-muted-foreground flex items-center gap-1.5 font-medium">
        OAuth scopes
      </div>
      <textarea
        id={`skill-${slug}-oauth-scopes`}
        placeholder="One scope URL per line (e.g. https://www.googleapis.com/auth/gmail.readonly)"
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        rows={Math.min(6, Math.max(2, scopes.length + 1))}
        className="border-input bg-background w-full resize-y rounded px-2 py-1.5 text-xs font-mono"
        aria-label="OAuth scopes"
      />
      <p className="text-muted-foreground text-[10px]">
        Used when building the auth URL for own-credentials flow. Edit to add or remove scopes; saved in skill config.
      </p>
    </div>
  );
}

function SkillEnvForm({
  slug,
  env,
  envHints,
  entry,
  visibleSecretKeys,
  setVisibleSecretKeys,
  onEntryUpdate,
  onEntrySave,
  validateSkillEnvConfig,
}: {
  slug: string;
  env: string[];
  envHints?: Record<string, string>;
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
        const hint = envHints?.[envVar];
        let renderedHint: React.ReactNode = null;
        if (hint) {
          const urlMatch = hint.match(/https?:\/\/\S+/);
          if (urlMatch) {
            const url = urlMatch[0].replace(/[),.]+$/, "");
            const idx = hint.indexOf(urlMatch[0]);
            const before = hint.slice(0, idx);
            const after = hint.slice(idx + urlMatch[0].length);
            renderedHint = (
              <>
                {before}
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {url}
                </a>
                {after}
              </>
            );
          } else {
            renderedHint = hint;
          }
        }
        // Debug: see env + hint wiring in UI
        // eslint-disable-next-line no-console
        console.debug("[SkillEnvForm] envVar", slug, envVar, "hint", hint);
        return (
          <Field key={envVar} className="min-w-[200px]">
            <FieldLabel htmlFor={id}>{envVar}</FieldLabel>
            <div className="relative">
              <Input
                id={id}
                type={showEyeForKey(envVar) ? (visible ? "text" : "password") : "text"}
                placeholder={isRedacted ? "(already set)" : `Enter ${envVar}`}
                value={value}
                onChange={(e) => {
                  const v = e.target.value;
                  const updates: Record<string, unknown> = { ...entry, [envVar]: v };
                  if (slug === "bluesky" && envVar === "BSKY_HANDLE") updates.handle = v;
                  if (slug === "bluesky" && envVar === "BSKY_APP_PASSWORD") updates.apiKey = v;
                  onEntryUpdate(updates);
                }}
                onBlur={() => onEntrySave(env, legacy)}
                className={`h-9 text-sm ${showEyeForKey(envVar) ? "pr-9" : ""} ${err ? "border-destructive" : ""}`}
                aria-invalid={!!err}
                aria-describedby={err ? `${id}-err` : undefined}
                autoComplete="off"
              />
              {showEyeForKey(envVar) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setVisibleSecretKeys((prev) => ({ ...prev, [visibleKey]: !prev[visibleKey] }))}
                  aria-label={visible ? "Hide" : "Show"}
                >
                  {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
            </div>
            {err && (
              <FieldError id={`${id}-err`}>
                {err}
              </FieldError>
            )}
            
            {(showEyeForKey(envVar) || renderedHint) && (

              <FieldDescription>
                {renderedHint && (
                  <>
                    {renderedHint}
                    <br />
                  </>
                )}
                {showEyeForKey(envVar)
                  ? "Tokens and keys are stored securely. Use the eye icon to show or hide."
                  : null}
              </FieldDescription>
            )}
          </Field>
        );
      })}
    </div>
  );
}

function HubTab({
  skills,
  registrySkills,
  registryLoading,
  systemRegistrySkills,
  systemRegistryLoading,
  skillsSearch,
  setSelectedHubSkill,
}: {
  skills: SkillsState["skills"];
  registrySkills: SkillsState["registrySkills"];
  registryLoading: boolean;
  systemRegistrySkills: SkillsState["registrySkills"];
  systemRegistryLoading: boolean;
  skillsSearch: string;
  setSelectedHubSkill: (s: AgentRegistrySkill | null) => void;
}) {
  const installedSlugs = new Set(
    skills
      .filter((s) => s.source === "user" || s.source === "workspace" || s.source === "managed")
      .map((s) => s.slug ?? s.name)
  );
  const filterRows = (rows: AgentRegistrySkill[]) =>
    rows
      .filter((r) => !installedSlugs.has(r.slug))
      .filter(
        (r) =>
          !skillsSearch.trim() ||
          (r.name || r.slug).toLowerCase().includes(skillsSearch.toLowerCase()) ||
          (r.description || "").toLowerCase().includes(skillsSearch.toLowerCase())
      );
  const systemFiltered = filterRows(systemRegistrySkills);
  const communityFiltered = filterRows(registrySkills);
  const loading = registryLoading || systemRegistryLoading;
  const hasAny = systemFiltered.length > 0 || communityFiltered.length > 0;

  if (loading && !registrySkills.length && !systemRegistrySkills.length) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }
  if (!hasAny) {
    return (
      <p className="text-muted-foreground text-sm">
        {systemRegistrySkills.length === 0 && registrySkills.length === 0
          ? "Hub registry is empty or not configured. Set VITE_SKILLS_REGISTRY_URL to your store URL."
          : "All listed skills are already installed, or no matching search."}
      </p>
    );
  }

  const SkillCard = ({ r }: { r: AgentRegistrySkill }) => {
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
  };

  return (
    <div className="space-y-6">
      {systemFiltered.length > 0 && (
        <section>
          <h3 className="text-muted-foreground mb-3 text-sm font-medium">System skills</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {systemFiltered.map((r) => (
              <SkillCard key={r.slug} r={r} />
            ))}
          </div>
        </section>
      )}
      {communityFiltered.length > 0 && (
        <section>
          <h3 className="text-muted-foreground mb-3 text-sm font-medium">Community / Hub</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {communityFiltered.map((r) => (
              <SkillCard key={r.slug} r={r} />
            ))}
          </div>
        </section>
      )}
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
                    await onInstall(skill.slug, "managed");
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
