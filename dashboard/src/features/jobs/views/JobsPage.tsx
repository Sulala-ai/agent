import { useEffect, useState } from "react";
import { MoreHorizontal, Play, FileText, Power, Trash2, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { fetchConfig, fetchAgentModels, fetchParseJobPrompt, type Config, type AgentModel } from "@/lib/api";
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
import { fetchChannelsTelegram, type Schedule, type ScheduleRun, type ParseJobResult, type TelegramChannelState } from "@/lib/api";

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

/** Quick ideas: short label + full prompt (user can click to fill the field). */
const QUICK_IDEAS: { label: string; prompt: string }[] = [
  { label: "Morning news → Bluesky", prompt: "Fetch daily news and post one to Bluesky every morning at 9." },
  { label: "Hourly RSS summary", prompt: "Summarize my RSS feeds and send a short summary every hour." },
  { label: "Weekday weather reminder", prompt: "Send me the weather for my location every weekday at 8 AM." },
  { label: "Daily digest to Telegram", prompt: "Collect top stories from my configured sources and send a daily digest to Telegram at 6 PM." },
  { label: "Bluesky post every 12h", prompt: "Post a tip or quote to Bluesky every 12 hours." },
  { label: "Backup reminder weekly", prompt: "Remind me to run my backup every Monday at 9 AM." },
];

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
  onNavigateToSettings?: () => void;
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
    onNavigateToSettings,
  } = props;

  const [telegramChannel, setTelegramChannel] = useState<TelegramChannelState | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedJob, setParsedJob] = useState<ParseJobResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  const effectivePrompt = parsedJob ? parsedJob.prompt : prompt.trim();
  const effectiveCron = parsedJob ? parsedJob.cron_expression : cronExpression;
  const effectiveName = parsedJob ? parsedJob.name : (name.trim() || "Scheduled job");

  useEffect(() => {
    fetchConfig()
      .then((c) => setProviders(c?.aiProviders ?? []))
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    fetchChannelsTelegram()
      .then(setTelegramChannel)
      .catch(() => setTelegramChannel(null));
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

  const handleParse = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setParseError(null);
    setParsing(true);
    try {
      const result = await fetchParseJobPrompt({ message: text });
      setParsedJob(result);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Failed to understand schedule");
      setParsedJob(null);
    } finally {
      setParsing(false);
    }
  };

  const handleAdd = async () => {
    if (!effectivePrompt) return;
    setSubmitting(true);
    setParseError(null);
    try {
      const delivery = deliveryTelegram ? [{ channel: "telegram", target: "default" }] : [];
      await onCreateSchedule({
        name: effectiveName,
        description: description.trim() || undefined,
        cron_expression: effectiveCron.trim(),
        prompt: effectivePrompt,
        delivery: delivery.length ? delivery : undefined,
        provider: provider.trim() || null,
        model: model.trim() || null,
      });
      setParsedJob(null);
      setChatInput("");
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
            Describe what you want in plain language; the AI will figure out the task and schedule. The agent uses your skills (e.g. news, Bluesky) and runs on that schedule. Results can be sent to Telegram (first chat that messages the bot, or set in Settings → Channels).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-muted-foreground block text-sm">Describe your job</label>
            <p className="text-muted-foreground mb-1.5 text-xs">Quick ideas — click to use</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_IDEAS.map((idea) => (
                <Button
                  key={idea.label}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs font-normal"
                  onClick={() => setChatInput(idea.prompt)}
                  disabled={parsing}
                >
                  {idea.label}
                </Button>
              ))}
            </div>
            <textarea
              className="border-input bg-background min-h-[88px] w-full rounded-md border px-3 py-2 text-sm"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="e.g. Fetch daily news and post one to Bluesky every morning at 9"
              rows={3}
              disabled={parsing}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={handleParse}
                disabled={parsing || !chatInput.trim()}
              >
                {parsing ? "Understanding…" : (
                  <>
                    <Sparkles className="mr-1.5 size-4" />
                    Understand & schedule
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                Advanced form
              </Button>
            </div>
            {parseError && (
              <p className="text-destructive text-sm">{parseError}</p>
            )}
          </div>

          {parsedJob && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-muted-foreground text-sm font-medium">Job preview — confirm or edit below</p>
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{parsedJob.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Task</dt>
                  <dd>{parsedJob.prompt}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Schedule</dt>
                  <dd>{cronToLabel(parsedJob.cron_expression)}</dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={deliveryTelegram}
                    onChange={(e) => setDeliveryTelegram(e.target.checked)}
                  />
                  Notify via Telegram
                </label>
                {deliveryTelegram && telegramChannel !== null && !telegramChannel.configured && (
                  <p className="text-amber-600 dark:text-amber-400 text-sm w-full">
                    Telegram is not set up. Set it up in Settings → Channels to receive job notifications.
                    {onNavigateToSettings && (
                      <Button variant="link" className="h-auto p-0 ml-1 text-sm" onClick={onNavigateToSettings}>
                        Open Settings
                      </Button>
                    )}
                  </p>
                )}
                <Button
                  onClick={handleAdd}
                  disabled={submitting || !effectivePrompt || (deliveryTelegram && (telegramChannel === null || !telegramChannel.configured))}
                >
                  {submitting ? "Adding…" : "Confirm & add job"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setParsedJob(null)}>
                  Discard
                </Button>
              </div>
            </div>
          )}

          {showAdvanced && (
            <div className="space-y-4 border-t pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-muted-foreground block text-sm">Name</label>
                  <input
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    value={parsedJob ? parsedJob.name : name}
                    onChange={(e) => {
                      if (parsedJob) setParsedJob({ ...parsedJob, name: e.target.value });
                      else setName(e.target.value);
                    }}
                    placeholder="Morning post"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-muted-foreground block text-sm">Schedule</label>
                  <select
                    className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    value={
                      parsedJob
                        ? (SCHEDULE_PRESETS.some((p) => p.value === parsedJob.cron_expression) ? parsedJob.cron_expression : "__custom__")
                        : schedulePreset
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (parsedJob)
                        setParsedJob({
                          ...parsedJob,
                          cron_expression: v === "__custom__" ? (parsedJob.cron_expression || "0 9 * * *") : v,
                        });
                      else setSchedulePreset(v);
                    }}
                  >
                    {SCHEDULE_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {((parsedJob && parsedJob.cron_expression && !SCHEDULE_PRESETS.find((p) => p.value === parsedJob!.cron_expression)) || (!parsedJob && schedulePreset === "__custom__")) && (
                    <div className="mt-2 space-y-1">
                      <label className="text-muted-foreground block text-xs">Cron expression</label>
                      <input
                        className="border-input bg-background h-9 w-full rounded-md border px-3 font-mono text-sm"
                        value={parsedJob ? parsedJob.cron_expression : customCron}
                        onChange={(e) => {
                          if (parsedJob) setParsedJob({ ...parsedJob, cron_expression: e.target.value });
                          else setCustomCron(e.target.value);
                        }}
                        placeholder="0 9 * * *"
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-muted-foreground block text-sm">Prompt</label>
                <textarea
                  className="border-input bg-background min-h-[60px] w-full rounded-md border px-3 py-2 text-sm"
                  value={parsedJob ? parsedJob.prompt : prompt}
                  onChange={(e) => {
                    if (parsedJob) setParsedJob({ ...parsedJob, prompt: e.target.value });
                    else setPrompt(e.target.value);
                  }}
                  placeholder="e.g. Fetch daily news and post one to Bluesky."
                  rows={2}
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
                    <option value="">Use default</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    {providers.length === 0 && (
                      <>
                        <option value="openrouter">OpenRouter</option>
                        <option value="openai">OpenAI</option>
                        <option value="ollama">Ollama</option>
                      </>
                    )}
                  </select>
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
                      placeholder={provider ? "e.g. gpt-4o-mini" : "Select provider first"}
                      disabled={!provider}
                    />
                  )}
                </div>
              </div>
              {!parsedJob && (
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={deliveryTelegram}
                      onChange={(e) => setDeliveryTelegram(e.target.checked)}
                    />
                    Notify via Telegram
                  </label>
                  {deliveryTelegram && telegramChannel !== null && !telegramChannel.configured && (
                    <p className="text-amber-600 dark:text-amber-400 text-sm w-full">
                      Telegram is not set up. Set it up in Settings → Channels to receive job notifications.
                      {onNavigateToSettings && (
                        <Button variant="link" className="h-auto p-0 ml-1 text-sm" onClick={onNavigateToSettings}>
                          Open Settings
                        </Button>
                      )}
                    </p>
                  )}
                  <Button
                    onClick={handleAdd}
                    disabled={
                      submitting ||
                      !prompt.trim() ||
                      !cronExpression ||
                      (deliveryTelegram && (telegramChannel === null || !telegramChannel.configured))
                    }
                  >
                    {submitting ? "Adding…" : "Add job"}
                  </Button>
                </div>
              )}
            </div>
          )}
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
