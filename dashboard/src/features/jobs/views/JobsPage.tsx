import { useEffect, useState } from "react";
import { MoreHorizontal, Play, FileText, Power, Trash2 } from "lucide-react";
import { fetchConfig, fetchAgentModels, type Config, type AgentModel } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTs, formatChatTs } from "@/lib/format";
import type { Schedule, ScheduleRun } from "@/lib/api";

/** End-user friendly presets. Label shown in UI, value is cron expression. */
const SCHEDULE_PRESETS: { label: string; value: string }[] = [
  { label: "Every day at 9:00 AM", value: "0 9 * * *" },
  { label: "Every day at 8:00 AM", value: "0 8 * * *" },
  { label: "Every day at 12:00 PM (noon)", value: "0 12 * * *" },
  { label: "Every day at 6:00 PM", value: "0 18 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every Monday at 9:00 AM", value: "0 9 * * 1" },
  { label: "Every weekday at 9:00 AM", value: "0 9 * * 1-5" },
  { label: "Custom (advanced)", value: "__custom__" },
];

function cronToLabel(cron: string): string {
  const found = SCHEDULE_PRESETS.find((p) => p.value === cron && p.value !== "__custom__");
  return found?.label ?? (cron ? `Custom: ${cron}` : "—");
}

export type JobsPageProps = {
  schedules: Schedule[];
  loading: boolean;
  load: () => void;
  onCreateSchedule: (body: {
    name?: string;
    description?: string;
    cron_expression: string;
    prompt?: string;
    delivery?: { channel: string; target?: string }[];
    provider?: string | null;
    model?: string | null;
  }) => Promise<void>;
  onUpdateSchedule: (
    id: string,
    body: {
      name?: string;
      description?: string;
      cron_expression?: string;
      prompt?: string | null;
      delivery?: { channel: string; target?: string }[] | null;
      provider?: string | null;
      model?: string | null;
      enabled?: boolean;
    }
  ) => Promise<void>;
  onDeleteSchedule: (id: string) => Promise<void>;
  onRunSchedule: (id: string) => Promise<{ id: string; type: string; status: string }>;
  onFetchScheduleRuns: (id: string) => Promise<{ runs: ScheduleRun[] }>;
};

export function JobsPage(props: JobsPageProps) {
  const {
    schedules,
    load,
    onCreateSchedule,
    onUpdateSchedule,
    onDeleteSchedule,
    onRunSchedule,
    onFetchScheduleRuns,
  } = props;

  const [name, setName] = useState("Morning post");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("Fetch daily news and post one to Bluesky.");
  const [schedulePreset, setSchedulePreset] = useState("0 9 * * *");
  const [customCron, setCustomCron] = useState("");
  const [deliveryTelegram, setDeliveryTelegram] = useState(true);
  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [providers, setProviders] = useState<Config["aiProviders"]>([]);
  const [models, setModels] = useState<AgentModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [logsJob, setLogsJob] = useState<Schedule | null>(null);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runFeedback, setRunFeedback] = useState<{ jobId: string; message: string } | null>(null);

  const cronExpression =
    schedulePreset === "__custom__" ? customCron.trim() : schedulePreset;

  useEffect(() => {
    fetchConfig()
      .then((c) => setProviders(c?.aiProviders ?? []))
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    if (!provider || (provider !== "ollama" && provider !== "openrouter")) {
      setModels([]);
      setModel("");
      return;
    }
    setModelsLoading(true);
    fetchAgentModels(provider)
      .then((r) => setModels(r.models ?? []))
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
  }, [provider]);

  const handleAdd = async () => {
    if (!prompt.trim()) return;
    setSubmitting(true);
    try {
      const delivery = deliveryTelegram ? [{ channel: "telegram", target: "default" }] : [];
      await onCreateSchedule({
        name: name.trim() || "Scheduled job",
        description: description.trim() || undefined,
        cron_expression: cronExpression.trim(),
        prompt: prompt.trim(),
        delivery: delivery.length ? delivery : undefined,
        provider: provider.trim() || null,
        model: model.trim() || null,
      });
      setName("Morning post");
      setDescription("");
      setPrompt("Fetch daily news and post one to Bluesky.");
      setSchedulePreset("0 9 * * *");
      setCustomCron("");
      setDeliveryTelegram(true);
      setProvider("");
      setModel("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleEnabled = async (row: Schedule) => {
    setActionId(row.id);
    try {
      await onUpdateSchedule(row.id, { enabled: !row.enabled });
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setActionId(id);
    try {
      await onDeleteSchedule(id);
    } finally {
      setActionId(null);
    }
  };

  const handleRun = async (row: Schedule) => {
    setActionId(row.id);
    setRunFeedback(null);
    try {
      const result = await onRunSchedule(row.id);
      setRunFeedback({ jobId: row.id, message: `Job enqueued (task ${result.id.slice(0, 12)}…)` });
      load();
    } catch (e) {
      setRunFeedback({ jobId: row.id, message: e instanceof Error ? e.message : "Run failed" });
    } finally {
      setActionId(null);
    }
  };

  const handleOpenLogs = (row: Schedule) => {
    setLogsJob(row);
  };

  useEffect(() => {
    if (!logsJob) {
      setRuns([]);
      return;
    }
    setRunsLoading(true);
    onFetchScheduleRuns(logsJob.id)
      .then(({ runs: r }) => setRuns(r))
      .catch(() => setRuns([]))
      .finally(() => setRunsLoading(false));
  }, [logsJob?.id, onFetchScheduleRuns]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New job</CardTitle>
          <CardDescription>
            Describe what you want in plain language. The agent will use your skills (e.g. news, Bluesky) and run on schedule. Job results are sent to Telegram: the first chat that messages the bot becomes the notification target, or set it in Settings → Channels.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-muted-foreground block text-sm">Name</label>
              <input
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Morning post"
              />
            </div>
            <div className="space-y-2">
              <label className="text-muted-foreground block text-sm">Schedule</label>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={schedulePreset}
                onChange={(e) => setSchedulePreset(e.target.value)}
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              {schedulePreset === "__custom__" && (
                <div className="mt-2 space-y-1">
                  <label className="text-muted-foreground block text-xs">
                    Cron expression: minute hour day month weekday (e.g. 0 9 * * * = 9:00 daily)
                  </label>
                  <input
                    className="border-input bg-background h-9 w-full rounded-md border px-3 font-mono text-sm"
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                    placeholder="0 9 * * *"
                  />
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-muted-foreground block text-sm">Description (optional)</label>
            <input
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short context for this job"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-muted-foreground block text-sm">AI Provider (optional)</label>
              <select
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="">Use default (OpenRouter/OpenAI if configured)</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                {providers.length === 0 && (
                  <>
                    <option value="">Use default</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="openai">OpenAI</option>
                    <option value="claude">Claude</option>
                    <option value="gemini">Gemini</option>
                    <option value="ollama">Ollama</option>
                  </>
                )}
              </select>
              <p className="text-muted-foreground text-xs">
                Leave empty to use app default (prefers OpenRouter or OpenAI when configured). Do not use Ollama for jobs unless it is always running.
              </p>
              {provider === "ollama" && (
                <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                  <strong>Warning:</strong> Using Ollama for scheduled jobs is not recommended. The job will not run if Ollama is not running when the job triggers. Use OpenRouter or OpenAI for reliable scheduled runs.
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-muted-foreground block text-sm">Model (optional)</label>
              {provider && (provider === "ollama" || provider === "openrouter") ? (
                <select
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={modelsLoading}
                >
                  <option value="">Use provider default</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={provider ? providers.find((p) => p.id === provider)?.defaultModel ?? "e.g. gpt-4o-mini" : "Select provider first"}
                  disabled={!provider}
                />
              )}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-muted-foreground block text-sm">Prompt *</label>
            <textarea
              className="border-input bg-background min-h-[80px] w-full rounded-md border px-3 py-2 text-sm"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Fetch daily news and post one to Bluesky."
              rows={3}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deliveryTelegram}
                onChange={(e) => setDeliveryTelegram(e.target.checked)}
              />
              Notify via Telegram when job completes or fails
            </label>
            <Button
              onClick={handleAdd}
              disabled={submitting || !prompt.trim() || !cronExpression}
            >
              {submitting ? "Adding…" : "Add job"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Scheduled jobs</CardTitle>
            <CardDescription>Agent jobs (prompt + schedule). You get a Telegram notification on success or failure if delivery is set.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[320px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Cron</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[70px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground text-center text-sm">
                      No scheduled jobs. Add one above.
                    </TableCell>
                  </TableRow>
                ) : (
                  schedules.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name || row.id}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {row.prompt || row.task_type || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[120px] truncate text-xs">
                        {row.provider ? `${row.provider}${row.model ? ` / ${row.model}` : ""}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {cronToLabel(row.cron_expression)}
                      </TableCell>
                      <TableCell>
                        {row.delivery ? (
                          <Badge variant="outline">Telegram</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.enabled ? "default" : "secondary"}>
                          {row.enabled ? "On" : "Off"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatTs(row.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                disabled={actionId === row.id}
                                title="Actions"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleRun(row)}>
                                <Play className="size-4" />
                                Test
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleOpenLogs(row)}>
                                <FileText className="size-4" />
                                Logs
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleToggleEnabled(row)}>
                                <Power className="size-4" />
                                {row.enabled ? "Disable" : "Enable"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => handleDelete(row.id)}
                              >
                                <Trash2 className="size-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {runFeedback?.jobId === row.id && (
                            <span className="text-muted-foreground text-xs">
                              {runFeedback.message}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
      <Sheet open={!!logsJob} onOpenChange={(open) => !open && setLogsJob(null)}>
        <SheetContent side="right" className="w-full max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{logsJob?.name || logsJob?.id} — Run logs</SheetTitle>
            <SheetDescription>
              Recent runs for this job. Status: pending, running, done, or failed.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {runsLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : runs.length === 0 ? (
              <p className="text-muted-foreground text-sm">No runs yet. Use Test to run now.</p>
            ) : (
              runs.map((r) => (
                <div
                  key={r.id}
                  className="border-input rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant={
                        r.status === "done"
                          ? "default"
                          : r.status === "failed"
                            ? "destructive"
                            : r.status === "running"
                              ? "secondary"
                              : "outline"
                      }
                    >
                      {r.status}
                    </Badge>
                    <span className="text-muted-foreground font-mono text-xs">
                      {r.id.slice(0, 16)}…
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {formatChatTs(r.created_at)}
                    {r.finished_at != null && r.started_at != null && (
                      <> · {Math.round((r.finished_at - r.started_at) / 1000)}s</>
                    )}
                  </p>
                  {r.error && (
                    <p className="mt-2 text-destructive text-xs">{r.error}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
