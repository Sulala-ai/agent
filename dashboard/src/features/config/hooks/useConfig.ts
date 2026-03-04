import { useEffect, useState } from "react";
import { fetchConfig, type Config } from "@/lib/api";

export function useConfig(page: string) {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    if (page === "config" || page === "settings") {
      fetchConfig()
        .then(setConfig)
        .catch(() => setConfig(null));
    }
  }, [page]);

  return config;
}
