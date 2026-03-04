import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Config } from "@/lib/api";

export type ConfigPageProps = {
  config: Config | null;
};

export function ConfigPage({ config }: ConfigPageProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Watched folders</CardTitle>
        <CardDescription>
          Paths monitored by the file watcher (from env and config/watched.json). Read-only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {config?.watchFolders && config.watchFolders.length > 0 ? (
          <ul className="space-y-2 font-mono text-sm">
            {config.watchFolders.map((path) => (
              <li key={path} className="rounded border bg-muted/30 px-3 py-2">
                {path}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            No watched folders configured. Set WATCH_FOLDERS in .env or add paths to
            config/watched.json.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
