import { formatTs } from "@/lib/format";
import type { WsEvent } from "@/hooks/useWebSocket";

export function EventRow({ event }: { event: WsEvent }) {
  if (event.type === "connected" || event.type === "pong")
    return (
      <div className="text-muted-foreground text-sm">
        {event.type} @ {formatTs(event.ts)}
      </div>
    );
  if (event.type === "file_event")
    return (
      <div className="rounded border bg-muted/30 px-2 py-1 text-sm">
        <span className="font-medium">{event.payload.event}</span>{" "}
        <span className="text-muted-foreground break-all">{event.payload.path}</span>
      </div>
    );
  if (event.type === "task_done")
    return (
      <div className="text-sm">
        Task done: <span className="font-mono text-xs">{event.taskId}</span>
      </div>
    );
  return null;
}
