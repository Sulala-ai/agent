import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchConfig,
  fetchIntegrations,
  fetchPortalConnections,
  startIntegrationsConnect,
  startPortalConnect,
  deleteIntegrationsConnection,
  deletePortalConnection,
  fetchOAuthConnectUrl,
  type IntegrationItem,
} from "@/lib/api";
import { getAllIntegrationApps } from "@/features/integrations/apps";

export function useIntegrations(activePage: string, onError: (msg: string) => void) {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  /** When true, agent uses Portal for connections; dashboard shows "Manage in Portal" instead of local list. */
  const [integrationsManagedByPortal, setIntegrationsManagedByPortal] = useState(false);
  const [portalGatewayUrl, setPortalGatewayUrl] = useState<string | null>(null);
  /** Base URL for integrations API (from agent config when direct mode). Used for connect/disconnect. */
  const [integrationsBaseUrl, setIntegrationsBaseUrl] = useState<string | undefined>(undefined);
  /** Portal gateway URL is set in .env but PORTAL_API_KEY is empty; show "create API key" instead of generic error. */
  const [portalUrlSetButKeyMissing, setPortalUrlSetButKeyMissing] = useState(false);
  /** When true, agent has OAuth client id set; show "Connect with Sulala (OAuth)" button. */
  const [portalOAuthConnectAvailable, setPortalOAuthConnectAvailable] = useState(false);

  const INTEGRATIONS_LOAD_TIMEOUT_MS = 15_000;

  const load = useCallback(async () => {
    setLoading(true);
    setIntegrationsManagedByPortal(false);
    setPortalGatewayUrl(null);
    setIntegrationsBaseUrl(undefined);
    setPortalUrlSetButKeyMissing(false);
    setPortalOAuthConnectAvailable(false);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Request timed out. Check that the agent and integrations service are running.")), INTEGRATIONS_LOAD_TIMEOUT_MS);
    });
    try {
      const config = await Promise.race([fetchConfig(), timeoutPromise]);
      const needsPortalKey = !!(config.portalGatewayUrl?.trim() && config.integrationsMode !== "portal");
      setPortalUrlSetButKeyMissing(needsPortalKey);
      setPortalOAuthConnectAvailable(config.portalOAuthConnectAvailable === true);
      if (config.integrationsMode === "portal") {
        setIntegrationsManagedByPortal(true);
        setPortalGatewayUrl(config.portalGatewayUrl ?? null);
        const baseUrl = config.integrationsUrl?.trim() || undefined;
        try {
          // Prefer provider list from integrations API (single source of truth); fall back to hardcoded apps if unreachable.
          let items: IntegrationItem[];
          try {
            const { integrations: apiList } = await Promise.race([fetchIntegrations(baseUrl), timeoutPromise]);
            items = apiList.map((i) => ({ ...i, connections: [] }));
          } catch {
            const allApps = getAllIntegrationApps();
            items = allApps.map((app) => ({
              id: app.id,
              name: app.name,
              iconUrl: app.logoUrl ?? "",
              description: app.description,
              connections: [],
            }));
          }
          const byProvider = new Map<string, IntegrationItem>(items.map((i) => [i.id, i]));
          const { connections } = await Promise.race([fetchPortalConnections(), timeoutPromise]);
          for (const c of connections) {
            const p = c.provider || "other";
            let item = byProvider.get(p);
            if (!item) {
              const name = p.charAt(0).toUpperCase() + p.slice(1);
              item = { id: p, name, iconUrl: "", description: "Connected via Portal", connections: [] };
              byProvider.set(p, item);
              items.push(item);
            }
            item.connections.push(c);
          }
          setIntegrations(items);
        } catch {
          setIntegrations(getAllIntegrationApps().map((app) => ({
            id: app.id,
            name: app.name,
            iconUrl: app.logoUrl ?? "",
            description: app.description,
            connections: [],
            tokenOnly: app.tokenOnly,
          })));
        }
        setLoading(false);
        return;
      }
      const baseUrl = config.integrationsUrl ?? undefined;
      setIntegrationsBaseUrl(baseUrl);
      const { integrations: list } = await Promise.race([fetchIntegrations(baseUrl), timeoutPromise]);
      setIntegrations(list);
    } catch (e) {
      onError((e as Error).message);
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (activePage === "integrations" || activePage === "chat") loadRef.current();
  }, [activePage]);

  const handleConnect = useCallback(
    async (provider: string) => {
      setConnectingProvider(provider);
      try {
        const redirectSuccess =
          typeof window !== "undefined"
            ? `${window.location.origin}${window.location.pathname}?page=integrations`
            : "";
        if (integrationsManagedByPortal) {
          const { authUrl } = await startPortalConnect(provider, redirectSuccess);
          window.location.href = authUrl;
        } else {
          const { authUrl } = await startIntegrationsConnect(provider, redirectSuccess, integrationsBaseUrl);
          window.location.href = authUrl;
        }
      } catch (e) {
        onError((e as Error).message);
        setConnectingProvider(null);
      }
    },
    [integrationsManagedByPortal, integrationsBaseUrl, onError]
  );

  const handleDisconnect = useCallback(
    async (id: string) => {
      try {
        if (integrationsManagedByPortal) {
          await deletePortalConnection(id);
        } else {
          await deleteIntegrationsConnection(id, integrationsBaseUrl);
        }
        await load();
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [integrationsManagedByPortal, integrationsBaseUrl, load, onError]
  );

  /** Start "Connect with Sulala" OAuth flow: open Portal in external browser; app stays open. Pass return_to (e.g. onboarding_step_3) to land back on a specific view after callback. */
  const startOAuthConnect = useCallback(async (return_to?: string) => {
    try {
      const { url } = await fetchOAuthConnectUrl(return_to);
      window.open(url, "_blank", "noopener,noreferrer");
      // In Electron/some environments the URL opens externally and window.open returns null; don't treat that as an error.
    } catch (e) {
      onError((e as Error).message);
    }
  }, [onError]);

  return {
    integrations,
    loading,
    connectingProvider,
    integrationsManagedByPortal,
    portalGatewayUrl,
    portalUrlSetButKeyMissing,
    portalOAuthConnectAvailable,
    load,
    handleConnect,
    handleDisconnect,
    startOAuthConnect,
  };
}
