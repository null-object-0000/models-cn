import type { ThemePreference } from "../types";

const options: Array<[ThemePreference, string]> = [
  ["system", "自动"],
  ["light", "浅色"],
  ["dark", "深色"],
];

export function ThemeSwitch({
  preference,
  onChange,
}: {
  preference: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  return (
    <button
      className="theme-switch"
      type="button"
      aria-label={`颜色主题：${options.find(([value]) => value === preference)?.[1]}`}
      title="切换颜色主题"
      onClick={() => {
        const index = options.findIndex(([value]) => value === preference);
        onChange(options[(index + 1) % options.length]![0]);
      }}
    >
      主题：{options.find(([value]) => value === preference)?.[1]}
    </button>
  );
}
