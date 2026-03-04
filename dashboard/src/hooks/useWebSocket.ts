import { useEffect, useRef, useState } from "react";
import { wsUrl } from "@/lib/api";

export type WsEvent =
  | { type: "connected"; ts: number }
  | { type: "pong"; ts: number }
  | { type: "file_event"; payload: { event: string; path: string; ts: number } }
  | { type: "task_done"; taskId: string }
  | { type: "skills_changed"; ts: number };

const MAX_EVENTS = 100;

export function useWebSocket(opts?: { onSkillsChanged?: () => void }) {
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onSkillsChangedRef = useRef(opts?.onSkillsChanged);
  onSkillsChangedRef.current = opts?.onSkillsChanged;

  useEffect(() => {
    const url = wsUrl();
    const ws = new WebSocket(url);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as WsEvent;
        setEvents((prev) => {
          const next = [data, ...prev].slice(0, MAX_EVENTS);
          return next;
        });
        if (data.type === "skills_changed" && onSkillsChangedRef.current) onSkillsChangedRef.current();
      } catch (_) {
        // ignore
      }
    };
    ws.onerror = () => {};

    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, []);

  return { events, connected };
}
