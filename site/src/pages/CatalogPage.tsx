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
    const dates = catalog.providers.flatMap((provider) =>
      provider.sources.map((source) => source.retrievedAt),
    );
    const latest = dates.sort().at(-1);
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
