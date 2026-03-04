import { useEffect, useState } from "react";
import {
  fetchConfig,
  fetchAgentModels,
  fetchAgentSessions,
  fetchAgentSessionCreate,
  fetchAgentSession,
  fetchAgentSendMessage,
  fetchAgentSendMessageStream,
  fetchUploadFile,
  fetchPendingActions,
  approvePendingAction,
  rejectPendingAction,
  fetchOllamaStatus,
  fetchOllamaPullStatus,
  type Config,
  type CompleteMessage,
  type AgentModel,
  type AgentMessage,
  type OllamaPullState,
  type PendingAction,
} from "@/lib/api";
import { STATIC_MODELS } from "../types/constants";
import type { AutomationIdea } from "../types/automationIdeas";

const STORAGE_KEY_PROVIDER = "sulala_chat_provider";
const STORAGE_KEY_MODEL = "sulala_chat_model";

function loadStored(key: string): string {
  try {
    const s = localStorage.getItem(key);
    if (typeof s === "string") return s;
  } catch {}
  return "";
}

export type ChatSession = { id: string; session_key: string; updated_at: number };

export type UseChatOptions = {
  onMissingIntegrations?: (missing: string[]) => void;
};

export function useChat(
  page: string,
  onError: (msg: string | null) => void,
  options?: UseChatOptions
) {
  const [config, setConfig] = useState<Config | null>(null);
  const [chatMessages, setChatMessages] = useState<AgentMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatProvider, setChatProviderState] = useState(() => loadStored(STORAGE_KEY_PROVIDER));
  const [chatModel, setChatModelState] = useState(() => loadStored(STORAGE_KEY_MODEL));
  const [chatModels, setChatModels] = useState<AgentModel[]>([]);
  const [chatModelsLoading, setChatModelsLoading] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [chatSessionsLoading, setChatSessionsLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatAgentSessionId, setChatAgentSessionId] = useState<string | null>(null);
  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);
  const [ollamaStatusLoading, setOllamaStatusLoading] = useState(false);
  const [ollamaPullState, setOllamaPullState] = useState<OllamaPullState | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [pendingActionDetails, setPendingActionDetails] = useState<PendingAction | null>(null);
  const [pendingActionLoading, setPendingActionLoading] = useState(false);
  const [lastAppliedIdea, setLastAppliedIdea] = useState<AutomationIdea | null>(null);
  const [chatAttachments, setChatAttachments] = useState<File[]>([]);

  const checkOllama = () => {
    setOllamaStatusLoading(true);
    fetchOllamaStatus()
      .then((s) => setOllamaRunning(s.running))
      .catch(() => setOllamaRunning(false))
      .finally(() => setOllamaStatusLoading(false));
  };

  useEffect(() => {
    if (page !== "chat" || chatProvider !== "ollama") {
      setOllamaRunning(null);
      setOllamaPullState(null);
      return;
    }
    setOllamaStatusLoading(true);
    fetchOllamaStatus()
      .then((s) => setOllamaRunning(s.running))
      .catch(() => setOllamaRunning(false))
      .finally(() => setOllamaStatusLoading(false));
  }, [page, chatProvider]);

  useEffect(() => {
    if (page !== "chat" || chatProvider !== "ollama") return;
    const tick = () => {
      fetchOllamaPullStatus()
        .then(setOllamaPullState)
        .catch(() => setOllamaPullState(null));
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [page, chatProvider]);

  useEffect(() => {
    if (page === "chat") {
      fetchConfig()
        .then((c) => {
          setConfig(c);
          if (c?.aiProviders?.length && !loadStored(STORAGE_KEY_PROVIDER)) {
            const first = c.aiProviders[0];
            if (first) {
              setChatProviderState(first.id);
              setChatModelState(first.defaultModel || "");
              try {
                localStorage.setItem(STORAGE_KEY_PROVIDER, first.id);
                localStorage.setItem(STORAGE_KEY_MODEL, first.defaultModel || "");
              } catch {}
            }
          }
        })
        .catch(() => setConfig(null));
    }
  }, [page]);

  useEffect(() => {
    if (page !== "chat" || (chatProvider !== "openrouter" && chatProvider !== "ollama")) {
      setChatModels([]);
      return;
    }
    setChatModelsLoading(true);
    fetchAgentModels(chatProvider)
      .then((r) => setChatModels(r.models || []))
      .catch(() => setChatModels([]))
      .finally(() => setChatModelsLoading(false));
  }, [page, chatProvider]);

  useEffect(() => {
    if (page !== "chat") return;
    setChatSessionsLoading(true);
    fetchAgentSessions(50)
      .then((r) => setChatSessions(r.sessions || []))
      .catch(() => setChatSessions([]))
      .finally(() => setChatSessionsLoading(false));
  }, [page, chatAgentSessionId]);

  useEffect(() => {
    if (!pendingActionId || !chatAgentSessionId) {
      if (!pendingActionId) setPendingActionDetails(null);
      return;
    }
    setPendingActionLoading(true);
    fetchPendingActions(chatAgentSessionId)
      .then((r) => {
        const found = (r.pendingActions || []).find((a) => a.id === pendingActionId);
        setPendingActionDetails(found ?? null);
      })
      .catch(() => setPendingActionDetails(null))
      .finally(() => setPendingActionLoading(false));
  }, [pendingActionId, chatAgentSessionId]);

  const handleSelectSession = async (sessionId: string) => {
    if (!sessionId) {
      handleNewChat();
      return;
    }
    setPendingActionId(null);
    setPendingActionDetails(null);
    setChatLoading(true);
    try {
      const session = await fetchAgentSession(sessionId);
      setChatAgentSessionId(session.id);
      setChatMessages((session.messages || []) as AgentMessage[]);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load session");
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatSend = async () => {
    const text = chatInput.trim();
    if ((!text && chatAttachments.length === 0) || chatLoading) return;
    const userMessage: CompleteMessage = { role: "user", content: text || "(with attachments)" };
    setChatMessages((prev) => [...prev, userMessage]);
    const filesToUpload = [...chatAttachments];
    setChatInput("");
    setChatAttachments([]);
    setChatLoading(true);
    onError(null);
    try {
      let sessionId = chatAgentSessionId;
      if (!sessionId) {
        const session = await fetchAgentSessionCreate({
          session_key: `chat_${Date.now()}`,
        });
        sessionId = session.id;
        setChatAgentSessionId(sessionId);
        const list = await fetchAgentSessions(50).catch(() => ({ sessions: [] }));
        setChatSessions(list.sessions || []);
      }
      const attachmentUrls: string[] = [];
      for (const file of filesToUpload) {
        const { url } = await fetchUploadFile(file);
        attachmentUrls.push(url);
      }
      const providerModel = config?.aiProviders.find((p) => p.id === chatProvider);
      const model =
        chatModel ||
        providerModel?.defaultModel ||
        (models.length > 0 ? models[0].id : "");
      const body: {
        message: string;
        provider?: string;
        model?: string;
        max_tokens?: number;
        required_integrations?: string[];
        attachment_urls?: string[];
      } = {
        message: text || "Post the attached image(s) as requested.",
        provider: chatProvider,
        model: model || undefined,
        max_tokens: 1024,
      };
      if (attachmentUrls.length > 0) body.attachment_urls = attachmentUrls;
      if (
        lastAppliedIdea &&
        text === lastAppliedIdea.base_prompt.trim() &&
        lastAppliedIdea.required_integrations.length > 0
      ) {
        body.required_integrations = lastAppliedIdea.required_integrations;
      }

      if (chatProvider === "openai" || chatProvider === "openrouter" || chatProvider === "ollama") {
        setChatMessages((prev) => [...prev, { role: "assistant", content: "", thinking: "" }]);
        await fetchAgentSendMessageStream(sessionId, body, {
          onDelta: (delta) => {
            setChatMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: (last.content ?? "") + delta };
              return next;
            });
          },
          onThinking: (delta) => {
            setChatMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, thinking: (last.thinking ?? "") + delta };
              return next;
            });
          },
          onDone: async (finalContent) => {
            setChatMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") next[next.length - 1] = { ...last, content: finalContent };
              return next;
            });
            if (sessionId && chatProvider !== "ollama") {
              try {
                const session = await fetchAgentSession(sessionId);
                setChatMessages((session.messages || []) as AgentMessage[]);
              } catch {
                // keep current messages on refetch error
              }
            }
          },
          onPendingApproval: (id) => {
            setChatLoading(false);
            setPendingActionId(id);
          },
          onError: onError,
          onMissingIntegrations: options?.onMissingIntegrations,
        });
      } else {
        const result = await fetchAgentSendMessage(sessionId, body);
        if (result.pendingActionId) {
          setPendingActionId(result.pendingActionId);
        }
        const session = await fetchAgentSession(sessionId);
        setChatMessages((session.messages || []) as AgentMessage[]);
      }
    } catch (e) {
      const err = e as Error & { missing?: string[] };
      if (Array.isArray(err.missing) && err.missing.length > 0) {
        options?.onMissingIntegrations?.(err.missing);
      }
      onError(err instanceof Error ? err.message : "Completion failed");
    } finally {
      setChatLoading(false);
    }
  };

  const handleNewChat = () => {
    setChatAgentSessionId(null);
    setChatMessages([]);
    setPendingActionId(null);
    setPendingActionDetails(null);
    onError(null);
  };

  const handleApprovePending = async () => {
    if (!pendingActionId || !chatAgentSessionId) return;
    const sessionId = chatAgentSessionId;
    try {
      await approvePendingAction(pendingActionId);
      setPendingActionId(null);
      setPendingActionDetails(null);
      const session = await fetchAgentSession(sessionId);
      setChatMessages((session.messages || []) as AgentMessage[]);

      const providerModel = config?.aiProviders.find((p) => p.id === chatProvider);
      const model =
        chatModel ||
        providerModel?.defaultModel ||
        (models.length > 0 ? models[0].id : "");
      const useStream = ["openai", "openrouter", "ollama"].includes(chatProvider);

      if (useStream) {
        setChatLoading(true);
        setChatMessages((prev) => [...prev, { role: "assistant", content: "", thinking: "" }]);
        await fetchAgentSendMessageStream(
          sessionId,
          { continue: true, provider: chatProvider, model: model || undefined, max_tokens: 1024 },
          {
            onDelta: (delta) => {
              setChatMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") next[next.length - 1] = { ...last, content: (last.content ?? "") + delta };
                return next;
              });
            },
            onThinking: (delta) => {
              setChatMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") next[next.length - 1] = { ...last, thinking: (last.thinking ?? "") + delta };
                return next;
              });
            },
            onDone: async () => {
              try {
                const s = await fetchAgentSession(sessionId);
                setChatMessages((s.messages || []) as AgentMessage[]);
              } catch {
                // keep current
              }
              setChatLoading(false);
            },
            onPendingApproval: (id) => {
              setPendingActionId(id);
              setChatLoading(false);
            },
            onError: (msg) => {
              setChatLoading(false);
              onError(msg);
            },
          }
        );
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setChatLoading(false);
    }
  };

  const handleRejectPending = async () => {
    if (!pendingActionId) return;
    try {
      await rejectPendingAction(pendingActionId);
      setPendingActionId(null);
      setPendingActionDetails(null);
      if (chatAgentSessionId) {
        const session = await fetchAgentSession(chatAgentSessionId);
        setChatMessages((session.messages || []) as AgentMessage[]);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to reject");
    }
  };

  const models =
    chatProvider === "ollama"
      ? (() => {
          const installedIds = new Set(chatModels.map((m) => m.id));
          const extra = (STATIC_MODELS.ollama || []).filter((m) => !installedIds.has(m.id));
          return [...chatModels, ...extra];
        })()
      : chatProvider === "openrouter" && chatModels.length > 0
        ? chatModels
        : STATIC_MODELS[chatProvider] || [];

  const setChatProvider = (v: string) => {
    setChatProviderState(v);
    try {
      localStorage.setItem(STORAGE_KEY_PROVIDER, v);
    } catch {}
  };

  const setChatModel = (v: string) => {
    setChatModelState(v);
    try {
      localStorage.setItem(STORAGE_KEY_MODEL, v);
    } catch {}
  };

  return {
    config,
    chatMessages,
    chatInput,
    setChatInput,
    chatProvider,
    setChatProvider,
    chatModel,
    setChatModel,
    chatModels,
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
    handleNewChat,
    pendingActionId,
    pendingActionDetails,
    pendingActionLoading,
    handleApprovePending,
    handleRejectPending,
    setLastAppliedIdea,
    chatAttachments,
    setChatAttachments,
  };
}
