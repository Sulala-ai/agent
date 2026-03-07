import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchMcpConfig, updateMcpConfig, reloadMcpConfig, buildMcpServerWithAi, type McpServerEntry } from "@/lib/api";
import { ExternalLink, FileDown, Pencil, Plus, RefreshCw, Server, Sparkles, Trash2 } from "lucide-react";

/** Normalize any common MCP config input to a servers array (we accept multiple formats but store one). */
function normalizeInputToServersArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  if ("servers" in o && Array.isArray(o.servers)) return o.servers;
  if ("mcpServers" in o && o.mcpServers && typeof o.mcpServers === "object" && !Array.isArray(o.mcpServers)) {
    return Object.entries(o.mcpServers as Record<string, unknown>).map(([name, s]) => ({
      name,
      ...(s && typeof s === "object" ? (s as Record<string, unknown>) : {}),
    }));
  }
  return [];
}

/** Suggestion prompts for Build with AI (click to fill the description). */
const BUILD_WITH_AI_SUGGESTIONS = [
  "Gmail – read and send emails",
  "YouTube – search and get video details",
  "GitHub – repos, issues, PRs",
  "Slack – channels and messages",
  "Google Drive – list and read files",
  "Notion – pages and databases",
  "Figma – list files and comments",
  "Postgres / SQL – run queries",
];

/** Resolve icon to image URL: Simple Icons slug → cdn.simpleicons.org, else treat as URL. */
function getIconUrl(icon: string): string {
  const trimmed = icon.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://cdn.simpleicons.org/${encodeURIComponent(trimmed)}`;
}

function parseServersFromJson(text: string): McpServerEntry[] | null {
  try {
    const raw = JSON.parse(text) as unknown;
    const arr = normalizeInputToServersArray(raw);
    const recognized =
      Array.isArray(raw) ||
      (raw && typeof raw === "object" && ("servers" in (raw as Record<string, unknown>) || "mcpServers" in (raw as Record<string, unknown>)));
    if (!recognized) return null;
    const result: McpServerEntry[] = [];
    for (const s of arr) {
      const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const command = typeof o.command === "string" ? o.command.trim() : "";
      if (!name || !command) continue;
      const args = Array.isArray(o.args) ? (o.args as unknown[]).map((a) => String(a)) : undefined;
      let env: Record<string, string> | undefined;
      if (o.env && typeof o.env === "object" && !Array.isArray(o.env)) {
        env = {};
        for (const [k, v] of Object.entries(o.env)) {
          if (typeof k === "string" && typeof v === "string") env[k] = v;
        }
        if (Object.keys(env).length === 0) env = undefined;
      }
      const icon = typeof o.icon === "string" ? o.icon.trim() || undefined : undefined;
      const credentialsUrl = typeof o.credentialsUrl === "string" ? o.credentialsUrl.trim() || undefined : undefined;
      result.push({ name, command, args, env, icon, credentialsUrl });
    }
    return result;
  } catch {
    return null;
  }
}

export function McpServersTab({ onError }: { onError?: (msg: string) => void }) {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [formServer, setFormServer] = useState<McpServerEntry>({ name: "", command: "npx", args: ["-y", "package-name"], env: {} });
  const [buildWithAiDescription, setBuildWithAiDescription] = useState("");
  const [buildWithAiLoading, setBuildWithAiLoading] = useState(false);
  const [buildWithAiResult, setBuildWithAiResult] = useState<{ taskId: string; message: string } | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (serverDialogOpen) {
      if (editingIndex !== null && servers[editingIndex]) {
        setFormServer({ ...servers[editingIndex], env: { ...(servers[editingIndex].env ?? {}) } });
      } else {
        setFormServer({ name: "", command: "npx", args: ["-y", "package-name"], env: {} });
      }
    }
  }, [serverDialogOpen, editingIndex, servers]);

  const updateFormServer = (patch: Partial<McpServerEntry>) => {
    setFormServer((prev) => ({ ...prev, ...patch }));
  };

  const updateFormServerEnv = (key: string, value: string) => {
    setFormServer((prev) => {
      const env = { ...(prev.env ?? {}) };
      if (value === "") delete env[key];
      else env[key] = value;
      return { ...prev, env };
    });
  };

  const saveServerFromDialog = () => {
    if (!formServer.name?.trim() || !formServer.command?.trim()) return;
    if (editingIndex !== null) {
      setServers((prev) => {
        const next = [...prev];
        next[editingIndex] = { ...formServer };
        return next;
      });
    } else {
      setServers((prev) => [...prev, { ...formServer }]);
    }
    setServerDialogOpen(false);
  };

  const load = async (): Promise<{ servers: McpServerEntry[] }> => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMcpConfig();
      const list = data.servers ?? [];
      setServers(list);
      return { servers: list };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onError?.(e instanceof Error ? e.message : String(e));
      return { servers: [] };
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const toSave: McpServerEntry[] = servers.map((s) => ({
        ...s,
        env: s.env
          ? Object.fromEntries(
              Object.entries(s.env).map(([k, v]) => [k, v === "" ? "***" : v])
            )
          : undefined,
      }));
      await updateMcpConfig(toSave);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleReloadFromFile = async () => {
    setReloading(true);
    setError(null);
    try {
      const data = await reloadMcpConfig();
      setServers(data.servers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setReloading(false);
    }
  };

  const handleImportFromJson = () => {
    setImportError(null);
    const parsed = parseServersFromJson(importJsonText);
    if (!parsed?.length) {
      setImportError("Invalid or empty. Use { \"servers\": [ ... ] } or { \"mcpServers\": { \"name\": { ... } } }.");
      return;
    }
    setServers((prev) => [...prev, ...parsed]);
    setImportJsonText("");
    setImportDialogOpen(false);
  };

  const openAddServer = () => {
    setEditingIndex(null);
    setServerDialogOpen(true);
  };

  const openEditServer = (index: number) => {
    setEditingIndex(index);
    setServerDialogOpen(true);
  };

  const removeServer = (index: number) => {
    setServers((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBuildWithAi = async () => {
    const desc = buildWithAiDescription.trim();
    if (!desc) return;
    setBuildWithAiLoading(true);
    setBuildWithAiResult(null);
    setError(null);
    try {
      const result = await buildMcpServerWithAi(desc);
      setBuildWithAiResult(result);
      setBuildWithAiDescription("");
      setTimeout(() => load(), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setBuildWithAiLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-muted-foreground text-sm">Loading MCP servers…</div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="size-5" />
            MCP Servers
          </CardTitle>
          <CardDescription className="space-y-1">
            <span className="block">
              MCP is for users who want to run and configure their own servers (e.g. API keys in env)—more setup, more control or services not in Connections.
            </span>
            <span className="block">
              Add MCP servers one at a time. Tools appear as <code className="rounded bg-muted px-1">mcp_&lt;name&gt;_&lt;tool&gt;</code>.
              Config is saved to <code className="rounded bg-muted px-1">~/.sulala/mcp.json</code>. If you edit that file by hand, click &quot;Reload from file&quot; so the agent picks up changes without restarting.
            </span>
            <span className="block">
              Find more servers at{" "}
              <a
                href="https://mcpservers.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:no-underline"
              >
                mcpservers.org
              </a>
              .
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="default" size="sm" onClick={openAddServer}>
              <Plus className="size-4 mr-1" />
              Add server
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
              <FileDown className="size-4 mr-1" />
              Import from JSON
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save & reload tools"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleReloadFromFile} disabled={reloading} title="Re-read mcp.json and reload tools (use after editing the file by hand)">
              <RefreshCw className={`size-4 mr-1 ${reloading ? "animate-spin" : ""}`} />
              {reloading ? "Reloading…" : "Reload from file"}
            </Button>
          </div>
          {servers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No MCP servers configured. Click Add server to create one, or Import from JSON to add from a config snippet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {servers.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {s.icon ? (
                      <img
                        src={getIconUrl(s.icon)}
                        alt=""
                        className="size-5 shrink-0 rounded object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Server className="size-5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-medium truncate" title={s.name || `Server ${i + 1}`}>
                      {s.name || `Server ${i + 1}`}
                    </span>
                  </div>
                  <span className="text-muted-foreground truncate max-w-[40%]" title={[s.command, ...(s.args ?? [])].join(" ")}>
                    {s.command} {Array.isArray(s.args) && s.args.length ? s.args.join(" ") : ""}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {s.credentialsUrl && (
                      <a
                        href={s.credentialsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary text-xs inline-flex items-center gap-0.5"
                        title="Where to get API keys"
                      >
                        <ExternalLink className="size-3.5" />
                        Get keys
                      </a>
                    )}
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => openEditServer(i)} title="Edit">
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeServer(i)}
                      title="Remove"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-5" />
            Build with AI
          </CardTitle>
          <CardDescription>
            Describe the MCP server you want. The agent will find an existing npm MCP server or guide you, then add it so it appears here and as <code className="rounded bg-muted px-1">mcp_&lt;name&gt;_*</code> tools.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-xs font-medium">Suggestions</p>
          <div className="flex flex-wrap gap-2">
            {BUILD_WITH_AI_SUGGESTIONS.map((label) => (
              <Button
                key={label}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto py-1.5 px-2.5 text-xs font-normal whitespace-nowrap"
                onClick={() => setBuildWithAiDescription(label)}
                disabled={buildWithAiLoading}
              >
                {label}
              </Button>
            ))}
          </div>
          <textarea
            className="border-input bg-background min-h-[80px] w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g. Gmail MCP server to read inbox and send emails"
            value={buildWithAiDescription}
            onChange={(e) => setBuildWithAiDescription(e.target.value)}
            disabled={buildWithAiLoading}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleBuildWithAi}
              disabled={buildWithAiLoading || !buildWithAiDescription.trim()}
            >
              {buildWithAiLoading ? "Starting…" : "Build with AI"}
            </Button>
            {buildWithAiResult && (
              <span className="text-muted-foreground text-sm">
                {buildWithAiResult.message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={serverDialogOpen} onOpenChange={setServerDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" showCloseButton>
          <DialogHeader>
            <DialogTitle>{editingIndex !== null ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
            <DialogDescription>
              Name is used as the tool prefix (e.g. <code className="rounded bg-muted px-1">mcp_&lt;name&gt;_&lt;tool&gt;</code>). Command and args are run to start the server (e.g. npx + package, or node + path).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label className="text-muted-foreground text-sm">Icon (optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="e.g. github, youtube or https://…"
                  value={formServer.icon ?? ""}
                  onChange={(e) => updateFormServer({ icon: e.target.value.trim() || undefined })}
                />
                {formServer.icon && (
                  <img
                    src={getIconUrl(formServer.icon)}
                    alt=""
                    className="size-8 shrink-0 rounded object-contain border border-input bg-muted"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                Use a{" "}
                <a
                  href="https://simpleicons.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:no-underline"
                >
                  Simple Icons
                </a>{" "}
                slug (e.g. <code className="rounded bg-muted px-1">github</code>, <code className="rounded bg-muted px-1">youtube</code>) or any image URL.
              </p>
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground text-sm">Name</Label>
              <Input
                placeholder="e.g. youtube"
                value={formServer.name}
                onChange={(e) => updateFormServer({ name: e.target.value.trim() })}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground text-sm">Command</Label>
              <Input
                placeholder="e.g. npx or node"
                value={formServer.command}
                onChange={(e) => updateFormServer({ command: e.target.value.trim() })}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground text-sm">Args (comma-separated)</Label>
              <Input
                placeholder='e.g. -y, package-name or /path/to/index.js'
                value={Array.isArray(formServer.args) ? formServer.args.join(", ") : ""}
                onChange={(e) =>
                  updateFormServer({
                    args: e.target.value.split(",").map((a) => a.trim()).filter(Boolean),
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground text-sm">Env (API keys, etc.)</Label>
              <p className="text-muted-foreground text-xs">
                Add a &quot;Credentials help URL&quot; below so users know where to get these keys.
              </p>
              <div className="space-y-2">
                {Object.entries(formServer.env ?? {}).map(([k, v]) => (
                  <div key={k} className="flex gap-2 items-center">
                    <Input className="flex-1 font-mono text-sm" placeholder="KEY" value={k} readOnly />
                    <Input
                      type="password"
                      className="flex-1 font-mono text-sm"
                      placeholder="value"
                      value={v === "***" ? "" : v}
                      onChange={(e) => updateFormServerEnv(k, e.target.value)}
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => updateFormServerEnv(k, "")}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <AddEnvRow
                  onAdd={(key, value) => {
                    if (key) updateFormServerEnv(key, value);
                  }}
                />
              </div>
              <div className="grid gap-2 pt-1">
                <Label className="text-muted-foreground text-sm">Credentials help URL (optional)</Label>
                <Input
                  type="url"
                  placeholder="e.g. https://developers.google.com/gmail/api/quickstart/nodejs"
                  value={formServer.credentialsUrl ?? ""}
                  onChange={(e) => updateFormServer({ credentialsUrl: e.target.value.trim() || undefined })}
                />
                <p className="text-muted-foreground text-xs">
                  Link to official docs on where and how to get API keys for this server. Shown as &quot;Get keys&quot; in the list.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setServerDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveServerFromDialog} disabled={!formServer.name?.trim() || !formServer.command?.trim()}>
              {editingIndex !== null ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open);
          if (!open) setImportError(null);
        }}
      >
        <DialogContent className="max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>Import from JSON</DialogTitle>
            <DialogDescription>
              Paste JSON to add servers (they will be appended). Accepts{" "}
              <code className="rounded bg-muted px-1">{"{ \"servers\": [ ... ] }"}</code> or{" "}
              <code className="rounded bg-muted px-1">{"{ \"mcpServers\": { \"name\": { ... } } }"}</code>.
            </DialogDescription>
          </DialogHeader>
          {importError && <p className="text-destructive text-sm">{importError}</p>}
          <textarea
            className="border-input bg-background min-h-[160px] w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={importJsonText}
            onChange={(e) => setImportJsonText(e.target.value)}
            spellCheck={false}
            placeholder='{"mcpServers":{"bluesky":{"command":"node","args":["/path/to/index.js"],"env":{...}}}}'
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleImportFromJson}>
              Add these servers to list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddEnvRow({ onAdd }: { onAdd: (key: string, value: string) => void }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const handleAdd = () => {
    const k = key.trim();
    if (k) {
      onAdd(k, value.trim());
      setKey("");
      setValue("");
    }
  };
  return (
    <div className="flex gap-2 items-center">
      <Input
        className="flex-1 font-mono text-sm"
        placeholder="e.g. YOUTUBE_API_KEY"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <Input
        type="password"
        className="flex-1 font-mono text-sm"
        placeholder="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
        Add env
      </Button>
    </div>
  );
}
