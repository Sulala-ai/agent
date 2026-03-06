import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getAppMeta } from "@/features/integrations/apps";

export type MissingIntegrationsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required integration ids for the automation idea */
  requiredIntegrations: string[];
  /** Currently connected integration ids */
  connectedIds: string[];
  /** Idea title for context */
  ideaTitle?: string;
  /** Called when user clicks Connect for a provider (navigate or start OAuth) */
  onConnect: (provider: string) => void;
};

export function MissingIntegrationsModal({
  open,
  onOpenChange,
  requiredIntegrations,
  connectedIds,
  ideaTitle,
  onConnect,
}: MissingIntegrationsModalProps) {
  const lower = (s: string) => s.toLowerCase();
  const connected = requiredIntegrations.filter((id) =>
    connectedIds.some((c) => lower(c) === lower(id))
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {ideaTitle ? `Missing integrations: ${ideaTitle}` : "Missing integrations"}
          </DialogTitle>
          <DialogDescription>
            Connect the required apps below, then try again. Do not execute the workflow until all
            required integrations are connected.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm">
          {requiredIntegrations.map((id) => {
            const meta = getAppMeta(id);
            const name = meta?.name ?? id;
            const isConnected = connected.includes(id);
            return (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  {isConnected ? (
                    <span className="text-green-600 dark:text-green-400" aria-hidden>
                      ✓
                    </span>
                  ) : (
                    <span className="text-muted-foreground" aria-hidden>
                      ✗
                    </span>
                  )}
                  {name}
                </span>
                {!isConnected && (
                  <Button size="sm" variant="outline" onClick={() => onConnect(id)}>
                    Connect
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
