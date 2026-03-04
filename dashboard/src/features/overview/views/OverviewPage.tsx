import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EventRow } from "../components/EventRow";
import type { WsEvent } from "@/hooks/useWebSocket";

type OverviewPageProps = {
  health: { status: string } | null;
  loading: boolean;
  connected: boolean;
  events: WsEvent[];
};

export function OverviewPage({ health, loading, connected, events }: OverviewPageProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gateway</CardTitle>
            <CardDescription>API server status</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            {loading ? (
              <span className="text-muted-foreground text-sm">Checking…</span>
            ) : health ? (
              <Badge variant="default">{health.status}</Badge>
            ) : (
              <Badge variant="destructive">Unreachable</Badge>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">WebSocket</CardTitle>
            <CardDescription>Live event stream</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Badge variant={connected ? "default" : "secondary"}>
              {connected ? "Connected" : "Disconnected"}
            </Badge>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live events</CardTitle>
          <CardDescription>File and task events from the gateway</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[280px] rounded-md border p-3">
            <div className="space-y-2">
              {events.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No events yet. Change a file in a watched folder or run a task.
                </p>
              ) : (
                events.map((ev, i) => <EventRow key={i} event={ev} />)
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
