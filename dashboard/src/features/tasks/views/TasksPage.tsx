import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatTs } from "@/lib/format";
import type { Task } from "@/lib/api";

export type TasksPageProps = {
  tasks: Task[];
  loading: boolean;
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
};

export function TasksPage(props: TasksPageProps) {
  const {
    tasks,
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
  } = props;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enqueue task</CardTitle>
          <CardDescription>Add a task to the queue</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <label className="text-muted-foreground block text-sm">Type</label>
            <input
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              value={enqueueType}
              onChange={(e) => setEnqueueType(e.target.value)}
              placeholder="e.g. heartbeat"
            />
          </div>
          <div className="min-w-[200px] space-y-2">
            <label className="text-muted-foreground block text-sm">Payload (JSON)</label>
            <input
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              value={enqueuePayload}
              onChange={(e) => setEnqueuePayload(e.target.value)}
              placeholder='{"key": "value"}'
            />
          </div>
          <Button onClick={handleEnqueue} disabled={enqueueing}>
            {enqueueing ? "Enqueueing…" : "Enqueue"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Tasks</CardTitle>
            <CardDescription>Recent tasks (from gateway)</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.id.slice(0, 20)}…</TableCell>
                    <TableCell>{t.type}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.status === "done"
                            ? "default"
                            : t.status === "failed"
                              ? "destructive"
                              : t.status === "cancelled"
                                ? "outline"
                                : "secondary"
                        }
                      >
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatTs(t.created_at)}
                    </TableCell>
                    <TableCell>
                      {(t.status === "pending" || t.status === "running") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-destructive hover:text-destructive"
                          disabled={actionTaskId === t.id}
                          onClick={() => handleTaskCancel(t.id)}
                        >
                          Cancel
                        </Button>
                      )}
                      {t.status === "failed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          disabled={actionTaskId === t.id}
                          onClick={() => handleTaskRetry(t.id)}
                        >
                          Retry
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
