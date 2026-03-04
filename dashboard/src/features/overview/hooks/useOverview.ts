import { useEffect, useRef, useState } from "react";
import {
  fetchHealth,
  fetchTasks,
  fetchLogs,
  fetchFileStates,
  fetchSchedules,
  enqueueTask,
  taskCancel,
  taskRetry,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleJob,
  fetchScheduleRuns,
} from "@/lib/api";
import type { Task, Log, FileState, Schedule } from "@/lib/api";

export function useOverview(onError: (msg: string) => void) {
  const [health, setHealth] = useState<{ status: string } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [fileStates, setFileStates] = useState<FileState[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [enqueueType, setEnqueueType] = useState("heartbeat");
  const [enqueuePayload, setEnqueuePayload] = useState("{}");
  const [enqueueing, setEnqueueing] = useState(false);
  const [actionTaskId, setActionTaskId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [h, t, l, fs, s] = await Promise.all([
        fetchHealth(),
        fetchTasks(),
        fetchLogs(),
        fetchFileStates(),
        fetchSchedules(),
      ]);
      setHealth(h);
      setTasks(t.tasks);
      setLogs(l.logs);
      setFileStates(fs.fileStates);
      setSchedules(s.schedules);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load");
      setHealth(null);
      setTasks([]);
      setLogs([]);
      setFileStates([]);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => loadRef.current(), 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleTaskCancel = async (id: string) => {
    setActionTaskId(id);
    try {
      await taskCancel(id);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setActionTaskId(null);
    }
  };

  const handleTaskRetry = async (id: string) => {
    setActionTaskId(id);
    try {
      await taskRetry(id);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setActionTaskId(null);
    }
  };

  const handleEnqueue = async () => {
    setEnqueueing(true);
    try {
      let payload: unknown = null;
      try {
        payload = enqueuePayload.trim() ? JSON.parse(enqueuePayload) : null;
      } catch {
        onError("Payload must be valid JSON");
        return;
      }
      await enqueueTask({ type: enqueueType, payload });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Enqueue failed");
    } finally {
      setEnqueueing(false);
    }
  };

  const handleCreateSchedule = async (body: {
    name?: string;
    description?: string;
    cron_expression: string;
    task_type?: string;
    payload?: unknown;
    prompt?: string;
    delivery?: { channel: string; target?: string }[];
    provider?: string | null;
    model?: string | null;
  }) => {
    try {
      await createSchedule(body);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Create schedule failed");
    }
  };

  const handleUpdateSchedule = async (
    id: string,
    body: {
      name?: string;
      description?: string;
      cron_expression?: string;
      task_type?: string;
      payload?: unknown;
      prompt?: string | null;
      delivery?: { channel: string; target?: string }[] | null;
      provider?: string | null;
      model?: string | null;
      enabled?: boolean;
    }
  ) => {
    try {
      await updateSchedule(id, body);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Update schedule failed");
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    try {
      await deleteSchedule(id);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Delete schedule failed");
    }
  };

  const handleRunSchedule = async (id: string) => {
    return runScheduleJob(id);
  };

  const handleFetchScheduleRuns = async (id: string) => {
    return fetchScheduleRuns(id);
  };

  return {
    health,
    tasks,
    logs,
    fileStates,
    schedules,
    loading,
    load,
    enqueueType,
    setEnqueueType,
    enqueuePayload,
    setEnqueuePayload,
    enqueueing,
    actionTaskId,
    handleTaskCancel,
    handleTaskRetry,
    handleEnqueue,
    handleCreateSchedule,
    handleUpdateSchedule,
    handleDeleteSchedule,
    handleRunSchedule,
    handleFetchScheduleRuns,
  };
}
