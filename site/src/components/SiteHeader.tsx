import type { ThemePreference } from "../types";
import { ThemeSwitch } from "./ThemeSwitch";

export function SiteHeader({
  theme,
  onThemeChange,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="models-cn 首页">
        <span className="brand-mark" />
        models-cn
      </a>
      <div className="header-actions">
        <nav aria-label="主导航">
          <a href="#models">模型</a>
          <a href="#method">数据说明</a>
          <a
            href="https://github.com/null-object-0000/models-cn"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
        <ThemeSwitch preference={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}
