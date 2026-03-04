import { useCallback, useEffect, useState } from "react";
import {
  fetchPendingActions,
  approvePendingAction,
  rejectPendingAction,
  type PendingAction,
} from "@/lib/api";

export function usePending(
  activePage: string,
  onError: (msg: string) => void
) {
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { pendingActions: list } = await fetchPendingActions();
      setPendingActions(list);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (activePage === "pending") load();
  }, [activePage, load]);

  const handleApprove = useCallback(
    async (id: string) => {
      setActingId(id);
      try {
        await approvePendingAction(id);
        await load();
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setActingId(null);
      }
    },
    [load, onError]
  );

  const handleReject = useCallback(
    async (id: string) => {
      setActingId(id);
      try {
        await rejectPendingAction(id);
        await load();
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setActingId(null);
      }
    },
    [load, onError]
  );

  return {
    pendingActions,
    loading,
    actingId,
    load,
    handleApprove,
    handleReject,
  };
}
