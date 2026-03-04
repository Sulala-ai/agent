import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Cpu, FileText, FolderOpen, LayoutDashboard, Link2, ListTodo, MessageCircle, Settings2 } from "lucide-react";
import { OverviewPage } from "@/features/overview";
import { AIProvidersTab } from "./AIProvidersTab";
import { TasksPage } from "@/features/tasks";
import { LogsPage } from "@/features/logs";
import { FilesPage } from "@/features/files";
import { ConfigPage } from "@/features/config";
import { ChannelsPage } from "./ChannelsPage";
import { MemoryPage } from "./MemoryPage";
import { PortalSettingsCard } from "@/features/integrations/components/PortalSettingsCard";
import { fetchOAuthConnectUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { WsEvent } from "@/hooks/useWebSocket";
import type { Config, FileState, Log, Task } from "@/lib/api";

export type SettingsPageProps = {
  health: { status: string } | null;
  loading: boolean;
  connected: boolean;
  events: WsEvent[];
  tasks: Task[];
  load: () => void;
  enqueueType: string;
  setEnqueueType: (v: string) => void;
  enqueuePayload: string;
  setEnqueuePayload: (v: string) => void;
  enqueueing: boolean;
  actionTaskId: string | null;
  handleTaskCancel: (id: string) => void;
  handleTaskRetry: (id: string) => void;
  handleEnqueue: () => void;
  logs: Log[];
  fileStates: FileState[];
  config: Config | null;
  onError?: (msg: string) => void;
};

const SETTINGS_NAV = [
  { value: "overview", label: "Overview", icon: LayoutDashboard },
  { value: "tasks", label: "Tasks", icon: ListTodo },
  { value: "logs", label: "Logs", icon: FileText },
  { value: "files", label: "File states", icon: FolderOpen },
  { value: "ai-providers", label: "AI Providers", icon: Cpu },
  { value: "channels", label: "Channels", icon: MessageCircle },
  { value: "memory", label: "Memory", icon: Brain },
  { value: "portal", label: "Portal", icon: Link2 },
  { value: "config", label: "Watched folders", icon: Settings2 },
] as const;

export function SettingsPage(props: SettingsPageProps) {
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <Tabs defaultValue="overview" orientation="vertical" className="flex flex-1 flex-col min-h-0">
        <div className="flex flex-1 min-h-0">
          <TabsList
            variant="line"
            className="w-52 shrink-0 flex flex-col h-auto rounded-none p-2 gap-0.5"
          >
            {SETTINGS_NAV.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className={cn(
                  "w-full justify-start gap-2 rounded-md px-3 py-2 h-auto font-normal",
                  "data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:font-medium"
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex-1 min-w-0 overflow-auto p-4">
            <TabsContent value="overview" className="mt-0 flex-1 data-[state=inactive]:hidden">
              <OverviewPage
                health={props.health}
                loading={props.loading}
                connected={props.connected}
                events={props.events}
              />
            </TabsContent>
            <TabsContent value="tasks" className="mt-0 flex-1 data-[state=inactive]:hidden">
              <TasksPage
                tasks={props.tasks}
                loading={props.loading}
                load={props.load}
                enqueueType={props.enqueueType}
                setEnqueueType={props.setEnqueueType}
                enqueuePayload={props.enqueuePayload}
                setEnqueuePayload={props.setEnqueuePayload}
                enqueueing={props.enqueueing}
                actionTaskId={props.actionTaskId}
                handleTaskCancel={props.handleTaskCancel}
                handleTaskRetry={props.handleTaskRetry}
                handleEnqueue={props.handleEnqueue}
              />
            </TabsContent>
            <TabsContent value="logs" className="mt-0 flex-1 data-[state=inactive]:hidden">
              <LogsPage logs={props.logs} load={props.load} />
            </TabsContent>
            <TabsContent value="files" className="mt-0 flex-1 data-[state=inactive]:hidden">
              <FilesPage fileStates={props.fileStates} load={props.load} />
            </TabsContent>
            <TabsContent value="ai-providers" className="mt-0 flex-1 data-[state=inactive]:hidden">
              <AIProvidersTab />
            </TabsContent>
            <TabsContent value="channels" className="mt-0 flex-1 data-[state=inactive]:hidden">
              <ChannelsPage />
            </TabsContent>
            <TabsContent value="memory" className="mt-0 flex-1 data-[state=inactive]:hidden">
              <MemoryPage />
            </TabsContent>
            <TabsContent value="portal" className="mt-0 flex-1 data-[state=inactive]:hidden">
              <PortalTab config={props.config} onError={props.onError} />
            </TabsContent>
            <TabsContent value="config" className="mt-0 flex-1 data-[state=inactive]:hidden">
              <ConfigPage config={props.config} />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}

function PortalTab({ config, onError }: { config: Config | null; onError?: (msg: string) => void }) {
  const portalGatewayUrl = config?.portalGatewayUrl ?? null;
  const portalOAuthConnectAvailable = config?.portalOAuthConnectAvailable === true;

  const handleOAuthConnect = async () => {
    const { url } = await fetchOAuthConnectUrl();
    window.open(url, "_blank", "noopener,noreferrer");
    // In Electron the URL opens in system browser and window.open returns null; that's expected.
  };

  return (
    <div className="flex flex-col gap-4">
      <PortalSettingsCard
        portalGatewayUrl={portalGatewayUrl}
        onError={onError}
        portalOAuthConnectAvailable={portalOAuthConnectAvailable}
        onOAuthConnect={portalOAuthConnectAvailable ? handleOAuthConnect : undefined}
      />
    </div>
  );
}
