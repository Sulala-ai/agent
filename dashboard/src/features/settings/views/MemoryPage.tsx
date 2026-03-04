import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  fetchAgentMemoryScopeKeys,
  fetchAgentMemory,
  type AgentMemoryScopeKeys,
  type AgentMemoryEntry,
} from "@/lib/api";
import { Brain, Download } from "lucide-react";

export function MemoryPage() {
  const [scopeKeys, setScopeKeys] = useState<AgentMemoryScopeKeys | null>(null);
  const [scope, setScope] = useState<"session" | "shared">("session");
  const [scopeKey, setScopeKey] = useState("");
  const [entries, setEntries] = useState<AgentMemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    fetchAgentMemoryScopeKeys()
      .then((keys) => {
        setScopeKeys(keys);
        if (keys.session.length > 0) {
          setScope("session");
          setScopeKey(keys.session[0]);
        } else if (keys.shared.length > 0) {
          setScope("shared");
          setScopeKey(keys.shared[0]);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const keysForScope = scope === "session" ? scopeKeys?.session ?? [] : scopeKeys?.shared ?? [];

  useEffect(() => {
    if (!scopeKey || !keysForScope.includes(scopeKey)) {
      setEntries([]);
      return;
    }
    setEntriesLoading(true);
    fetchAgentMemory({ scope, scope_key: scopeKey, limit: 200 })
      .then((r) => setEntries(r.entries ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setEntriesLoading(false));
  }, [scope, scopeKey]);

  const handleExport = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { scope, scope_key: scopeKey, exported_at: new Date().toISOString(), entries },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sulala-memory-${scope}-${scopeKey.replace(/[^a-z0-9-_]/gi, "_")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleString();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">Loading memory…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="size-4" />
            Agent memory
          </CardTitle>
          <CardDescription>
            View stored memory (session-scoped or shared across sessions). Use the chat to add
            entries via the write_memory tool.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="memory-scope">Scope</Label>
              <select
                id="memory-scope"
                className="flex h-9 w-[140px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={scope}
                onChange={(e) => {
                  const v = e.target.value as "session" | "shared";
                  setScope(v);
                  const keys = v === "session" ? scopeKeys?.session ?? [] : scopeKeys?.shared ?? [];
                  setScopeKey(keys[0] ?? "");
                }}
              >
                <option value="session">Session</option>
                <option value="shared">Shared</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-scope-key">
                {scope === "session" ? "Session" : "Shared key"}
              </Label>
              <select
                id="memory-scope-key"
                className="flex h-9 min-w-[200px] max-w-[320px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={scopeKey}
                onChange={(e) => setScopeKey(e.target.value)}
              >
                {keysForScope.length === 0 ? (
                  <option value="">— No keys —</option>
                ) : (
                  keysForScope.map((k) => (
                    <option key={k} value={k}>
                      {k.length > 40 ? k.slice(0, 37) + "…" : k}
                    </option>
                  ))
                )}
              </select>
            </div>
            {entries.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="size-4 mr-1" />
                Export JSON
              </Button>
            )}
          </div>
          {entriesLoading && (
            <p className="text-muted-foreground text-sm">Loading entries…</p>
          )}
          {!entriesLoading && scopeKey && keysForScope.includes(scopeKey) && (
            <div className="rounded-md border">
              {entries.length === 0 ? (
                <p className="p-4 text-muted-foreground text-sm">
                  No memory entries for this {scope} key.
                </p>
              ) : (
                <ul className="divide-y divide-border max-h-[400px] overflow-y-auto">
                  {entries.map((e) => (
                    <li key={e.id} className="p-3 text-sm">
                      <p className="text-foreground">{e.content}</p>
                      <p className="mt-1 text-muted-foreground text-xs">{formatDate(e.created_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
