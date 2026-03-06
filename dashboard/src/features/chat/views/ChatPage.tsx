import React, { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Check, ChevronRight, History, ImagePlus, Loader2, Lightbulb, ShieldAlert, User, X } from "lucide-react";
import { TypingIndicator, BlinkingCursor } from "@/components/ui/typing-indicator";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatChatTs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { useChat } from "../hooks/useChat";
import type { AgentMessage, IntegrationItem } from "@/lib/api";

/** Detect when the agent is asking the job creation yes/no question. */
function isJobCreationYesNoQuestion(content: string | null | undefined): boolean {
  const c = content ?? "";
  return /would you like me to create (a )?job for you/i.test(c);
}
import { fetchMcpConfig } from "@/lib/api";
import { getConnectedIntegrations } from "@/features/integrations/lib";
import { AutomationSuggestionsBar } from "../components/AutomationSuggestionsBar";
import { MissingIntegrationsModal } from "../components/MissingIntegrationsModal";
import { AUTOMATION_IDEAS, type AutomationIdea } from "../types/automationIdeas";

type ChatPageProps = ReturnType<typeof useChat> & {
  integrations?: IntegrationItem[];
  onNavigateToIntegrations?: () => void;
  missingIntegrationsFromServer?: string[] | null;
  onClearMissingIntegrationsFromServer?: () => void;
};

const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-2 mt-3 text-lg font-bold first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 mt-2 text-sm font-bold first:mt-0">{children}</h3>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-inside list-disc space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 list-inside list-decimal space-y-0.5">{children}</ol>
  ),
  code: ({
    className,
    children,
    ...props
  }: { className?: string; children?: React.ReactNode }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="mb-2 overflow-x-auto rounded bg-muted p-2 text-xs">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      );
    }
    return (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-xs"
        {...props}
      >
        {children}
      </code>
    );
  },
  a: ({
    href,
    children,
  }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      className="text-primary underline hover:no-underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-2 border-muted-foreground/30 pl-3 italic">
      {children}
    </blockquote>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) =>
    src ? (
      <img
        src={src}
        alt={alt ?? "attachment"}
        className="my-1 max-h-48 max-w-full rounded object-contain"
      />
    ) : null,
};

/** Convert attachment bracket to markdown images so user-uploaded URLs render as images. */
function userContentWithImages(content: string | null): string {
  if (!content) return "";
  return content.replace(
    /\[Attached media \(use these URLs when posting images[^\]]*\):\s*([^\]]+)\]/,
    (_, urls) =>
      urls
        .split(",")
        .map((u: string) => u.trim())
        .filter(Boolean)
        .map((url: string) => `![attached](${url})`)
        .join("\n")
  );
}

function ChatMessage({
  message,
  isLast,
  isStreaming,
}: {
  message: AgentMessage;
  isLast?: boolean;
  isStreaming?: boolean;
}) {
  const m = message;
  const ts = m.created_at ? formatChatTs(m.created_at) : null;
  const usage = m.usage;
  const hasUsage =
    usage &&
    ((usage.prompt_tokens ?? 0) > 0 || (usage.completion_tokens ?? 0) > 0);

  if (m.role === "user") {
    const userContent = userContentWithImages(m.content);
    return (
      <div className="flex items-start gap-2 justify-end">
        <div className="border-border bg-muted/30 flex max-w-[min(85%,42rem)] flex-col gap-0.5 rounded-lg rounded-tr-sm px-3 py-2 text-sm">
          <div className="chat-markdown text-foreground break-words [&>*:last-child]:mb-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {userContent}
            </ReactMarkdown>
          </div>
          {ts && (
            <div className="text-muted-foreground text-right text-xs">{ts}</div>
          )}
        </div>
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="rounded-full">
            <User className="size-4" />
          </AvatarFallback>
        </Avatar>
      </div>
    );
  }

  if (m.role === "assistant") {
    return (
      <div className="flex items-start gap-2">
        <div className="size-8 shrink-0 flex items-center justify-center overflow-hidden rounded-full bg-muted">
          <img src="/icon.svg" alt="" className="size-5 dark:hidden" aria-hidden /><img src="/logo_white.svg" alt="" className="size-5 hidden dark:block" aria-hidden />
        </div>
        <div className="border-border bg-muted/30 flex max-w-[min(85%,42rem)] flex-1 flex-col gap-0.5 rounded-lg rounded-tl-sm px-3 py-2 text-sm">
          {(m.thinking ?? "") && (
            <details className="text-muted-foreground border-border mb-2 rounded border border-dashed py-1.5 pl-2 pr-2 text-xs" open={isStreaming}>
              <summary className="cursor-pointer font-medium flex items-center gap-2">
                Thinking
                {isStreaming && <TypingIndicator className="ml-1" />}
              </summary>
              <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans">{m.thinking}</pre>
            </details>
          )}
          {(m.content ?? "") ? (
            <div className="flex items-end gap-x-1">
              <div className="chat-markdown text-foreground min-w-0 flex-1 [&>*:last-child]:mb-0">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {String(m.content)}
                </ReactMarkdown>
              </div>
              {isStreaming && <BlinkingCursor className="shrink-0" />}
            </div>
          ) : isStreaming && isLast ? (
            <TypingIndicator />
          ) : null}
          {m.tool_calls?.length ? (
            <details className="text-muted-foreground mt-1 text-xs group/details">
              <summary className="cursor-pointer list-none flex items-center gap-1 opacity-80 hover:opacity-100 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/details:rotate-90" />
                <span>Show details</span>
                <span className="opacity-75">
                  ({m.tool_calls.length} tool call{m.tool_calls.length !== 1 ? "s" : ""})
                </span>
              </summary>
              <div className="mt-1.5 border-l border-border/50 pl-4">
                <div className="opacity-80">
                  Tool calls:{" "}
                  {m.tool_calls.map((tc) => `${tc.name}(${tc.arguments?.slice(0, 40) ?? ""}${(tc.arguments?.length ?? 0) > 40 ? "…" : ""})`).join(", ")}
                </div>
              </div>
            </details>
          ) : null}
          {(ts || hasUsage || (m.cost_usd != null && m.cost_usd > 0)) ? (
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs opacity-80">
              {ts && <span>{ts}</span>}
              {hasUsage && (
                <span>
                  {usage!.prompt_tokens ?? 0} in / {usage!.completion_tokens ?? 0} out
                  {usage!.total_tokens != null && ` (${usage!.total_tokens} total)`}
                </span>
              )}
              {m.cost_usd != null && m.cost_usd > 0 && (
                <span title="Estimated cost for this response">
                  ${m.cost_usd.toFixed(6)}
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (m.role === "tool" || m.name) {
    const toolName = m.name ?? "tool";
    const content = String(m.content ?? "");
    return (
      <details className="text-muted-foreground group/tool flex gap-2 pl-10 text-xs">
        <summary className="cursor-pointer list-none flex flex-1 items-start gap-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 shrink-0 mt-0.5 transition-transform group-open/tool:rotate-90" />
          <div className="flex-1 min-w-0 rounded bg-muted/20 px-2 py-1">
            <span className="font-medium">Tool result ({toolName})</span>
            {ts && <span className="ml-1 opacity-75">· {ts}</span>}
          </div>
        </summary>
        <div className="pl-10 pr-2 pb-1">
          <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted/20 p-2 text-xs font-sans">
            {content || "(empty)"}
          </pre>
        </div>
      </details>
    );
  }

  return null;
}

export function ChatPage(props: ChatPageProps) {
  const {
    configuredProviders = [],
    chatMessages,
    chatInput,
    setChatInput,
    chatProvider,
    setChatProvider,
    chatModel,
    setChatModel,
    chatModelsLoading,
    chatSessions,
    chatSessionsLoading,
    chatLoading,
    chatAgentSessionId,
    models,
    ollamaRunning,
    ollamaStatusLoading,
    ollamaPullState,
    checkOllama,
    handleSelectSession,
    handleChatSend,
    sendMessage,
    handleNewChat,
    pendingActionId,
    pendingActionDetails,
    pendingActionLoading,
    handleApprovePending,
    handleRejectPending,
    setLastAppliedIdea,
    chatAttachments = [],
    setChatAttachments,
    integrations = [],
    onNavigateToIntegrations,
    missingIntegrationsFromServer = null,
    onClearMissingIntegrationsFromServer,
  } = props;

  const [missingModalOpen, setMissingModalOpen] = useState(false);
  const [missingModalRequired, setMissingModalRequired] = useState<string[]>([]);
  const [missingModalIdeaTitle, setMissingModalIdeaTitle] = useState<string>("");
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [mcpServerNames, setMcpServerNames] = useState<string[]>([]);

  useEffect(() => {
    fetchMcpConfig()
      .then(({ servers }) => setMcpServerNames(servers?.map((s) => s.name.toLowerCase()) ?? []))
      .catch(() => setMcpServerNames([]));
  }, []);

  const connectedIds = getConnectedIntegrations(integrations);
  /** Capabilities satisfied by OAuth integrations OR MCP servers (e.g. gmail MCP or gmail OAuth both allow gmail ideas). */
  const availableIds = Array.from(
    new Set([...connectedIds.map((id) => id.toLowerCase()), ...mcpServerNames])
  );

  const showSuggestionsBar = chatMessages.length === 0 && chatInput.length === 0;

  const handleSelectIdea = (idea: AutomationIdea) => {
    setChatInput(idea.base_prompt);
    setLastAppliedIdea?.(idea);
  };

  const handleMissingIntegrations = (idea: AutomationIdea) => {
    setMissingModalRequired(idea.required_integrations);
    setMissingModalIdeaTitle(idea.title);
    setMissingModalOpen(true);
  };

  const handleModalConnect = (_provider: string) => {
    setMissingModalOpen(false);
    onNavigateToIntegrations?.();
  };

  const handleSessionSelect = (sessionId: string) => {
    handleSelectSession(sessionId);
    setHistoryDrawerOpen(false);
  };

  const currentSessionLabel =
    chatAgentSessionId && chatSessions.length > 0
      ? chatSessions.find((s) => s.id === chatAgentSessionId)?.session_key ?? "Current chat"
      : "Chat history";

  const handleIdeaPick = (idea: AutomationIdea) => {
    handleSelectIdea(idea);
  };

  const showOllamaBanner = chatProvider === "ollama" && ollamaRunning === false && !ollamaStatusLoading;
  const showPullBanner = chatProvider === "ollama" && ollamaPullState?.inProgress;
  const showOllamaToolsWarning = chatProvider === "ollama";

  return (
    <Card className="flex flex-1 flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">AI Chat</CardTitle>
          <CardDescription>
            Agent with sessions and tools (e.g. run_task). OpenAI supports tool calls.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Lightbulb className="size-3.5" />
                Try an idea
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[220px] max-w-[min(300px,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto overflow-x-hidden"
            >
              {AUTOMATION_IDEAS.map((idea) => (
                <DropdownMenuItem
                  key={idea.id}
                  onClick={() => handleIdeaPick(idea)}
                  className="flex min-w-0 flex-col items-start gap-0.5 py-2"
                >
                  <span className="truncate font-medium w-full">{idea.title}</span>
                  <span className="text-muted-foreground line-clamp-2 text-xs font-normal w-full min-w-0">
                    {idea.description}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={handleNewChat}>
            New chat
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {showOllamaBanner && (
          <div className="bg-muted border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span>Ollama is not running. Set it up to use the default AI.</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href="/onboard" target="_blank" rel="noopener noreferrer">
                  Set up Ollama
                </a>
              </Button>
              <Button variant="secondary" size="sm" onClick={checkOllama} disabled={ollamaStatusLoading}>
                Check again
              </Button>
            </div>
          </div>
        )}
        {showPullBanner && ollamaPullState && (
          <div className="bg-primary/10 border-primary/20 flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <div className="font-medium">Pulling model {ollamaPullState.model}…</div>
            {ollamaPullState.percent >= 0 && ollamaPullState.percent <= 100 && (
              <div className="flex items-center gap-2">
                <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-[width] duration-300"
                    style={{ width: `${ollamaPullState.percent}%` }}
                  />
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">{ollamaPullState.percent}%</span>
              </div>
            )}
            {ollamaPullState.lastLine && (
              <div className="text-muted-foreground truncate font-mono text-xs" title={ollamaPullState.lastLine}>
                {ollamaPullState.lastLine}
              </div>
            )}
          </div>
        )}
        {showOllamaToolsWarning && (
          <div className="bg-amber-500/10 border-amber-500/50 flex items-center gap-2 rounded-lg border p-3 text-sm">
            <ShieldAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span className="text-amber-700 dark:text-amber-400">
              Ollama cannot run tools and perform like other providers (e.g. OpenAI, OpenRouter). For full tool support, switch to a cloud provider.
            </span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Sheet open={historyDrawerOpen} onOpenChange={setHistoryDrawerOpen}>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 min-w-[140px] justify-between"
              onClick={() => setHistoryDrawerOpen(true)}
              disabled={chatSessionsLoading}
            >
              <History className="size-3.5 shrink-0" />
              <span className="truncate">{currentSessionLabel}</span>
            </Button>
            <SheetContent side="right" className="flex flex-col w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Chat history</SheetTitle>
                <SheetDescription>
                  Switch to a previous chat or start a new one.
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-4 pb-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start mb-2"
                  onClick={() => handleSessionSelect("")}
                >
                  New chat
                </Button>
                {chatSessions.length === 0 && !chatSessionsLoading && (
                  <p className="text-muted-foreground text-sm py-2">No chats yet.</p>
                )}
                {chatSessionsLoading && (
                  <p className="text-muted-foreground text-sm py-2 flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Loading…
                  </p>
                )}
                <ul className="space-y-1">
                  {chatSessions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => handleSessionSelect(s.id)}
                        className={cn(
                          "w-full text-left rounded-md px-3 py-2 text-sm transition-colors",
                          s.id === chatAgentSessionId
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-muted"
                        )}
                      >
                        <span className="truncate block">{s.session_key}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </SheetContent>
          </Sheet>
          <select
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value={chatProvider}
            onChange={(e) => {
              const v = e.target.value;
              setChatProvider(v);
              const p = configuredProviders.find((x) => x.id === v);
              setChatModel(p?.defaultModel || "");
            }}
          >
            {(configuredProviders.length === 0 || !chatProvider || !configuredProviders.some((p) => p.id === chatProvider)) && (
              <option value="">
                {configuredProviders.length === 0 ? "No provider configured" : "Select provider"}
              </option>
            )}
            {configuredProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            className="border-input bg-background min-w-[200px] rounded-md border px-3 py-2 text-sm"
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            disabled={(chatProvider === "openrouter" || chatProvider === "ollama") && chatModelsLoading}
          >
            {(chatProvider === "openrouter" || chatProvider === "ollama") && chatModelsLoading ? (
              <option value={chatModel}>Loading models…</option>
            ) : (
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))
            )}
            {(chatProvider === "openrouter" || chatProvider === "ollama") && !chatModelsLoading && models.length === 0 && chatModel && (
              <option value={chatModel}>{chatModel}</option>
            )}
          </select>
        </div>
        <ScrollArea className="min-h-[240px] flex-1 rounded-md border p-3">
          <div className="space-y-3">
            {chatMessages.length === 0 &&
              (showSuggestionsBar ? (
                <AutomationSuggestionsBar
                  ideas={AUTOMATION_IDEAS}
                  connectedIds={availableIds}
                  onSelectIdea={handleSelectIdea}
                  onMissingIntegrations={handleMissingIntegrations}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Send a message to start. Provider and model can be changed above.
                </p>
              ))}
            {chatMessages.map((m, i) => (
              <ChatMessage
                key={i}
                message={m}
                isLast={i === chatMessages.length - 1}
                isStreaming={chatLoading && i === chatMessages.length - 1}
              />
            ))}
            {!chatLoading &&
              !pendingActionId &&
              chatMessages.length > 0 &&
              chatMessages[chatMessages.length - 1]?.role === "assistant" &&
              isJobCreationYesNoQuestion(chatMessages[chatMessages.length - 1]?.content) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground text-sm">Reply:</span>
                <Button size="sm" onClick={() => sendMessage("yes")}>
                  <Check className="size-3.5" />
                  Yes, create it
                </Button>
                <Button size="sm" variant="outline" onClick={() => sendMessage("no")}>
                  <X className="size-3.5" />
                  No, don&apos;t create
                </Button>
              </div>
            )}
            {pendingActionId && (
              <Card className="border-amber-500/50 bg-amber-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldAlert className="size-4 text-amber-600" />
                    Approve this action
                  </CardTitle>
                  <CardDescription>
                    The agent wants to run a tool that can change files or run commands. Approve to continue or reject to cancel.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {pendingActionLoading && !pendingActionDetails ? (
                    <div className="text-muted-foreground flex items-center gap-2 py-2">
                      <Loader2 className="size-4 animate-spin" />
                      Loading…
                    </div>
                  ) : (
                    <>
                      {pendingActionDetails && (
                        <>
                          <div className="font-mono text-sm font-medium">{pendingActionDetails.toolName}</div>
                          {Object.keys(pendingActionDetails.args).length > 0 && (
                            <pre className="bg-muted max-h-32 overflow-auto rounded p-2 text-xs">
                              {JSON.stringify(pendingActionDetails.args, null, 2)}
                            </pre>
                          )}
                        </>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleApprovePending}>
                          <Check className="size-4" />
                          Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleRejectPending}>
                          <X className="size-4" />
                          Reject
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
            {chatLoading && chatMessages.length > 0 && chatMessages[chatMessages.length - 1]?.role === "user" && (
              <div className="flex items-start gap-2">
                <div className="size-8 shrink-0 flex items-center justify-center overflow-hidden rounded-full bg-muted">
                  <img src="/icon.svg" alt="" className="size-5 dark:hidden" aria-hidden /><img src="/logo_white.svg" alt="" className="size-5 hidden dark:block" aria-hidden />
                </div>
                <div className="border-border bg-muted/30 flex items-center gap-2 rounded-lg rounded-tl-sm px-3 py-2 text-sm">
                  <TypingIndicator />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
       
        {chatAttachments.length > 0 && (
          <div className="border-border flex flex-wrap gap-2 rounded-md border p-2">
            {chatAttachments.map((file, i) => (
              <div key={`${file.name}-${i}`} className="relative">
                {file.type.startsWith("image/") ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="h-14 w-14 rounded object-cover"
                  />
                ) : (
                  <div className="border-input flex h-14 w-14 items-center justify-center rounded border text-xs">
                    {file.name.slice(0, 8)}
                  </div>
                )}
                <button
                  type="button"
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground text-muted hover:bg-foreground hover:text-background"
                  onClick={() => setChatAttachments((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end">
          <label className="cursor-pointer shrink-0 rounded-md border border-input px-2 py-2 text-muted-foreground hover:bg-muted/50">
            <input
              type="file"
              accept="image/*,video/*,.mp4,.webm,.mov,.m4v,.avi"
              className="sr-only"
              multiple
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                setChatAttachments((prev) => [...prev, ...files]);
                e.target.value = "";
              }}
            />
            <ImagePlus className="h-5 w-5" aria-hidden />
          </label>
          <textarea
            className="border-input bg-background field-sizing-content min-h-10 max-h-48 w-full min-w-0 flex-1 resize-none rounded-md border px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Type a message…"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleChatSend();
              }
            }}
            rows={1}
          />
          <Button
            onClick={handleChatSend}
            disabled={chatLoading || (!chatInput.trim() && chatAttachments.length === 0)}
          >
            {chatLoading ? "Sending…" : "Send"}
          </Button>
        </div>
        <MissingIntegrationsModal
          open={missingModalOpen || (missingIntegrationsFromServer != null && missingIntegrationsFromServer.length > 0)}
          onOpenChange={(open) => {
            if (!open) {
              setMissingModalOpen(false);
              onClearMissingIntegrationsFromServer?.();
            }
          }}
          requiredIntegrations={
            missingModalOpen ? missingModalRequired : missingIntegrationsFromServer ?? []
          }
          connectedIds={availableIds}
          ideaTitle={missingModalOpen ? missingModalIdeaTitle : ""}
          onConnect={handleModalConnect}
        />
      </CardContent>
    </Card>
  );
}
