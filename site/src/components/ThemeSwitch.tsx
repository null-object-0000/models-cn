import type { ThemePreference } from "../types";

const options: Array<[ThemePreference, string, string]> = [
  ["system", "自动", "跟随系统"],
  ["light", "浅色", "浅色模式"],
  ["dark", "深色", "深色模式"],
];

export function ThemeSwitch({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  return (
    <div className="theme-switch" aria-label="颜色主题">
      {options.map(([value, label, title]) => (
        <button
          key={value}
          aria-pressed={preference === value}
          title={title}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
