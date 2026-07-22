import { useMemo } from "react";
import { CatalogSection } from "../components/CatalogSection";
import { Hero, type HeroStats } from "../components/Hero";
import { MethodSection } from "../components/MethodSection";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { useTheme } from "../hooks/useTheme";
import type { Catalog } from "../types";

export function CatalogPage({ catalog }: { catalog: Catalog }) {
  const [theme, setTheme] = useTheme();
  const stats = useMemo<HeroStats>(() => {
    const staleAfterMs = 36 * 60 * 60 * 1000;
    const healthRecords = [
      ...catalog.providers.map((provider) => provider.health),
      ...(catalog.inventories ?? []).map((inventory) => inventory.health),
      ...(catalog.calibration?.modelsDev.health
        ? [catalog.calibration.modelsDev.health]
        : []),
    ].map((health) =>
      health.status === "healthy" &&
      Date.now() - Date.parse(health.lastAttemptAt) > staleAfterMs
        ? { ...health, status: "stale" as const }
        : health,
    );
    const dates = healthRecords.map((health) => health.lastAttemptAt);
    const latest = dates.sort().at(-1);
    const failedSources = healthRecords.filter(
      (health) => health.status !== "healthy",
    ).length;
    const health = healthRecords.some((item) => item.status === "error")
      ? "error"
      : healthRecords.some((item) => item.status === "stale")
        ? "stale"
        : "healthy";
    return {
      providers: catalog.providers.length,
      models: catalog.providers.reduce(
        (total, provider) => total + provider.models.length,
        0,
      ),
      mismatches:
        catalog.calibration?.modelsDev.models.filter(
          (item) => item.status === "mismatch",
        ).length ?? 0,
      inventoryMatches:
        catalog.inventories?.filter(
          (inventory) => inventory.comparison.status === "match",
        ).length ?? 0,
      inventories: catalog.inventories?.length ?? 0,
      health,
      failedSources,
      ...(latest ? { latest } : {}),
    };
  }, [catalog]);

  return (
    <>
      <SiteHeader theme={theme} onThemeChange={setTheme} />
      <main id="top">
        <Hero stats={stats} />
        <CatalogSection catalog={catalog} />
        <MethodSection />
      </main>
      <SiteFooter />
    </>
  );
}
