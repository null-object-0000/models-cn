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
      <div className="shell header-inner">
        <a className="brand" href="#top" aria-label="DevTrends 模型价格首页">
          <span className="brand-mark" />
          DevTrends · 模型价格
        </a>
        <div className="header-actions">
          <nav aria-label="主导航">
            <a href="https://devtrends.site/">返回主站</a>
            <a className="active" href="#models">
              模型
            </a>
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
      </div>
    </header>
  );
}
