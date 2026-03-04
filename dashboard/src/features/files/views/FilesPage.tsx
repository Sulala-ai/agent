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
import type { FileState } from "@/lib/api";

export type FilesPageProps = {
  fileStates: FileState[];
  load: () => void;
};

export function FilesPage({ fileStates, load }: FilesPageProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">File states</CardTitle>
          <CardDescription>
            Files seen by the watcher (last modified time, size)
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fileStates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground text-center">
                    No file states. Add watched folders and trigger file events.
                  </TableCell>
                </TableRow>
              ) : (
                fileStates.map((f) => (
                  <TableRow key={f.path}>
                    <TableCell className="max-w-[400px] truncate font-mono text-xs">
                      {f.path}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {f.size != null ? `${f.size} B` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatTs(f.last_seen)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
