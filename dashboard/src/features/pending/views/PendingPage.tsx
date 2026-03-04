import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import type { PendingAction } from "@/lib/api";

export type PendingPageProps = {
  pendingActions: PendingAction[];
  loading: boolean;
  actingId: string | null;
  load: () => void;
  handleApprove: (id: string) => void;
  handleReject: (id: string) => void;
};

export function PendingPage({
  pendingActions,
  loading,
  actingId,
  load,
  handleApprove,
  handleReject,
}: PendingPageProps) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pending actions</h1>
          <p className="text-muted-foreground text-sm">
            High-risk tools (write_file, run_command) require approval when execution preview is on.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {loading && pendingActions.length === 0 ? (
        <div className="text-muted-foreground flex items-center gap-2 py-8">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      ) : pendingActions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4" />
              No pending actions
            </CardTitle>
            <CardDescription>
              When the agent tries to run a high-risk tool and execution preview is enabled, it will appear here for you to approve or reject.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3">
          {pendingActions.map((a) => (
            <Card key={a.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="font-mono">{a.toolName}</span>
                  <span className="text-muted-foreground text-xs font-normal">
                    Session {a.sessionId.slice(0, 12)}…
                  </span>
                </CardTitle>
                <CardDescription>
                  Tool call: <code className="text-xs">{a.toolCallId.slice(0, 8)}…</code>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(a.args).length > 0 && (
                  <pre className="bg-muted rounded-md p-2 text-xs overflow-x-auto">
                    {JSON.stringify(a.args, null, 2)}
                  </pre>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(a.id)}
                    disabled={actingId !== null}
                  >
                    {actingId === a.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    <span className="ml-1">Approve</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleReject(a.id)}
                    disabled={actingId !== null}
                  >
                    {actingId === a.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <X className="size-4" />
                    )}
                    <span className="ml-1">Reject</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
