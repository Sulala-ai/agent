import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchMcpConfig, updateMcpConfig, type McpServerEntry } from "@/lib/api";
import { FileJson, Plus, Server, Trash2 } from "lucide-react";

type EditMode = "form" | "json";

function parseServersFromJson(text: string): McpServerEntry[] | null {
  try {
    const raw = JSON.parse(text) as unknown;
    const arr = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && "servers" in raw && Array.isArray((raw as { servers: unknown }).servers)
        ? (raw as { servers: unknown[] }).servers
        : null;
    if (!arr) return null;
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
      result.push({ name, command, args, env });
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
  const [editMode, setEditMode] = useState<EditMode>("form");
  const [jsonText, setJsonText] = useState("");

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

  useEffect(() => {
    if (editMode === "json") setJsonText(JSON.stringify({ servers }, null, 2));
  }, [editMode, servers]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let toSave: McpServerEntry[];
      if (editMode === "json") {
        const parsed = parseServersFromJson(jsonText);
        if (!parsed) {
          setError("Invalid JSON. Use { \"servers\": [ { \"name\", \"command\", \"args\"?, \"env\"? } ] } or an array of servers.");
          setSaving(false);
          return;
        }
        toSave = parsed.map((s) => ({
          ...s,
          env: s.env ? Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, v === "" ? "***" : v])) : undefined,
        }));
      } else {
        toSave = servers.map((s) => ({
          ...s,
          env: s.env
            ? Object.fromEntries(
                Object.entries(s.env).map(([k, v]) => [k, v === "" ? "***" : v])
              )
            : undefined,
        }));
      }
      await updateMcpConfig(toSave);
      const { servers: next } = await load();
      if (editMode === "json") setJsonText(JSON.stringify({ servers: next }, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const switchToFormFromJson = () => {
    const parsed = parseServersFromJson(jsonText);
    if (parsed?.length) setServers(parsed);
    setEditMode("form");
  };

  const addServer = () => {
    setServers((prev) => [
      ...prev,
      { name: "", command: "npx", args: ["-y", "package-name"], env: {} },
    ]);
  };

  const updateServer = (index: number, patch: Partial<McpServerEntry>) => {
    setServers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const updateServerEnv = (index: number, key: string, value: string) => {
    setServers((prev) => {
      const next = [...prev];
      const env = { ...(next[index].env ?? {}) };
      if (value === "") delete env[key];
      else env[key] = value;
      next[index] = { ...next[index], env };
      return next;
    });
  };

  const removeServer = (index: number) => {
    setServers((prev) => prev.filter((_, i) => i !== index));
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
              Add MCP servers as an alternative to Integrations (e.g. YouTube, Twitter, Gmail with API keys).
              Use the form or paste JSON. Tools appear as <code className="rounded bg-muted px-1">mcp_&lt;name&gt;_&lt;tool&gt;</code>.
              Config is saved to <code className="rounded bg-muted px-1">~/.sulala/mcp.json</code>.
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
          <Tabs
            value={editMode}
            onValueChange={(v) => {
              if (v === "form") switchToFormFromJson();
              else setEditMode("json");
            }}
            className="w-full"
          >
            <TabsList className="grid w-full max-w-xs grid-cols-2">
              <TabsTrigger value="form" className="flex items-center gap-2">
                Form
              </TabsTrigger>
              <TabsTrigger value="json" className="flex items-center gap-2">
                <FileJson className="size-4" />
                JSON
              </TabsTrigger>
            </TabsList>
            <TabsContent value="json" className="mt-4 space-y-2">
              <Label className="text-muted-foreground text-sm">
                Paste or edit config. Use <code className="rounded bg-muted px-1">{"{ \"servers\": [ ... ] }"}</code> or an array of server objects.
              </Label>
              <textarea
                className="border-input bg-background min-h-[280px] w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
              />
            </TabsContent>
            <TabsContent value="form" className="mt-4">
          {error && (
            <p className="text-destructive text-sm">{error}</p>
          )}
          {servers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No MCP servers configured. Click Add server and set name, command, args, and any env keys (e.g. YOUTUBE_API_KEY).
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {servers.map((s, i) => (
                <div
                  key={i}
                  className="rounded-lg border bg-card p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">Server {i + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeServer(i)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <div className="grid gap-2 grid-cols-[auto_1fr] items-center text-sm">
                    <Label className="text-muted-foreground">Name</Label>
                    <Input
                      placeholder="e.g. youtube"
                      value={s.name}
                      onChange={(e) => updateServer(i, { name: e.target.value.trim() })}
                    />
                    <Label className="text-muted-foreground">Command</Label>
                    <Input
                      placeholder="e.g. npx"
                      value={s.command}
                      onChange={(e) => updateServer(i, { command: e.target.value.trim() })}
                    />
                    <Label className="text-muted-foreground">Args</Label>
                    <Input
                      placeholder='e.g. -y, zubeid-youtube-mcp-server (comma-separated)'
                      value={Array.isArray(s.args) ? s.args.join(", ") : ""}
                      onChange={(e) =>
                        updateServer(
                          i,
                          { args: e.target.value.split(",").map((a) => a.trim()).filter(Boolean) }
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-sm">Env (API keys, etc.)</Label>
                    <div className="space-y-2">
                      {Object.entries(s.env ?? {}).map(([k, v]) => (
                        <div key={k} className="flex gap-2 items-center">
                          <Input
                            className="flex-1 font-mono text-sm"
                            placeholder="KEY"
                            value={k}
                            readOnly
                          />
                          <Input
                            type="password"
                            className="flex-1 font-mono text-sm"
                            placeholder="value"
                            value={v === "***" ? "" : v}
                            onChange={(e) => updateServerEnv(i, k, e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateServerEnv(i, k, "")}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                      <AddEnvRow
                        onAdd={(key, value) => {
                          if (key) updateServerEnv(i, key, value);
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addServer}>
              <Plus className="size-4 mr-1" />
              Add server
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save & reload tools"}
            </Button>
          </div>
            </TabsContent>
          </Tabs>
          {editMode === "json" && (
            <div className="flex gap-2 pt-2">
              <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save & reload tools"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
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
