import { useEffect, useState } from "react";
import { CatalogPage } from "./pages/CatalogPage";
import type { Catalog } from "./types";

export function App() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    fetch("./api.json", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<Catalog>;
      })
      .then(setCatalog)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(String(reason));
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <main className="error-shell">
        <p>DATA UNAVAILABLE</p>
        <h1>暂时无法载入模型数据</h1>
        <span>{error}</span>
      </main>
    );
  }
  if (!catalog) {
    return (
      <main className="loading-shell" aria-live="polite">
        <span className="loading-dot" />
        正在载入模型数据…
      </main>
    );
  }
  return <CatalogPage catalog={catalog} />;
}
