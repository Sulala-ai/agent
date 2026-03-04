import type { IntegrationItem } from "@/lib/api";

/**
 * Returns integration ids that have at least one connection.
 * Use for automation-ideas validation (required_integrations).
 */
export function getConnectedIntegrations(integrations: IntegrationItem[]): string[] {
  return integrations
    .filter((i) => i.connections.length > 0)
    .map((i) => i.id);
}
