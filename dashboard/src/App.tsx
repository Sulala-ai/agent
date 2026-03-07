import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/layouts";
import type { NavPage } from "@/components/app-sidebar";
import { useOverview } from "@/features/overview";
import { useSkills, SkillsPage } from "@/features/skills";
import { useChat, ChatPage } from "@/features/chat";
import { JobsPage } from "@/features/jobs";
import { useConfig } from "@/features/config";
import { SettingsPage } from "@/features/settings";
import { useWebSocket } from "@/hooks/useWebSocket";
import { OnboardingFlow } from "@/features/onboarding/views/OnboardingFlow";
import { fetchOnboardStatus } from "@/lib/api";

export default function App() {
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [page, setPage] = useState<NavPage>(() => {
    if (typeof window === "undefined") return "chat";
    const p = new URLSearchParams(window.location.search).get("page");
    const valid: NavPage[] = ["chat", "skills", "jobs", "settings", "overview", "tasks", "logs", "files", "config"];
    return valid.includes(p as NavPage) ? (p as NavPage) : "chat";
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('fetching onboarding status');
    fetchOnboardStatus()
      .then(({ complete }) => {
        console.log('onboarding status', complete);
        setOnboardingComplete(complete);
      })
      .catch((e) => {
        console.error('error fetching onboarding status', e);
        // If rate-limited or network error, assume complete so user isn't stuck on onboarding
        const msg = (e as Error).message || String(e);
        setOnboardingComplete(msg.includes('429') || msg.includes('fetch') ? true : false);
      });
  }, []);

  const [missingIntegrationsFromChat, setMissingIntegrationsFromChat] = useState<string[] | null>(null);

  const overview = useOverview((msg) => setError(msg));
  const skillsState = useSkills((msg) => setError(msg));
  const chatState = useChat(page, (msg) => setError(msg), {
    onMissingIntegrations: (missing) => setMissingIntegrationsFromChat(missing),
  });
  const config = useConfig(page);

  useEffect(() => {
    if (page === "settings" || page === "jobs") overview.load();
  }, [page]);

  const loadSkillsRef = useRef<() => void>(() => {});
  loadSkillsRef.current = skillsState.loadSkills;

  const { events, connected } = useWebSocket({
    onSkillsChanged: () => loadSkillsRef.current?.(),
  });

  useEffect(() => {
    if (page === "skills") skillsState.loadSkillsData();
  }, [page]);

  if (onboardingComplete === null) {
    return (
      <div className="bg-background flex min-h-screen flex-col items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (!onboardingComplete) {
    return (
      <OnboardingFlowWrapper
        onComplete={() => {
          window.location.reload();
        }}
      />
    );
  }

  const onNavigate = (p: NavPage) => {
    setPage(p);
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.set("page", p);
      window.history.replaceState({}, "", u.toString());
    }
  };

  return (
    <AppLayout activePage={page} onNavigate={onNavigate} error={error}>
      {page === "chat" && (
        <ChatPage
          {...chatState}
          integrations={[]}
          onNavigateToIntegrations={() => onNavigate("skills")}
          missingIntegrationsFromServer={missingIntegrationsFromChat}
          onClearMissingIntegrationsFromServer={() => setMissingIntegrationsFromChat(null)}
        />
      )}

      {page === "skills" && <SkillsPage {...skillsState} />}

      {page === "jobs" && (
        <JobsPage
          schedules={overview.schedules}
          loading={overview.loading}
          load={overview.load}
          onCreateSchedule={overview.handleCreateSchedule}
          onUpdateSchedule={overview.handleUpdateSchedule}
          onDeleteSchedule={overview.handleDeleteSchedule}
          onRunSchedule={overview.handleRunSchedule}
          onFetchScheduleRuns={overview.handleFetchScheduleRuns}
          onNavigateToSettings={() => onNavigate("settings")}
        />
      )}

      {page === "settings" && (
        <SettingsPage
          health={overview.health}
          loading={overview.loading}
          connected={connected}
          events={events}
          tasks={overview.tasks}
          load={overview.load}
          enqueueType={overview.enqueueType}
          setEnqueueType={overview.setEnqueueType}
          enqueuePayload={overview.enqueuePayload}
          setEnqueuePayload={overview.setEnqueuePayload}
          enqueueing={overview.enqueueing}
          actionTaskId={overview.actionTaskId}
          handleTaskCancel={overview.handleTaskCancel}
          handleTaskRetry={overview.handleTaskRetry}
          handleEnqueue={overview.handleEnqueue}
          logs={overview.logs}
          fileStates={overview.fileStates}
          config={config}
          onError={(msg) => setError(msg)}
        />
      )}
    </AppLayout>
  );
}

function OnboardingFlowWrapper({ onComplete }: { onComplete: () => void }) {
  return <OnboardingFlow onComplete={onComplete} />;
}
