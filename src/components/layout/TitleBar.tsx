import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/cn";
import { type ThemeMode, useTheme } from "@/stores/theme";

const MODES: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
  { mode: "light", icon: Sun, label: "亮色" },
  { mode: "system", icon: Monitor, label: "跟随系统" },
  { mode: "dark", icon: Moon, label: "暗色" },
];

/**
 * 自定义标题栏。
 *
 * macOS 下窗口配置为 `titleBarStyle: "Overlay"`，原生红绿灯按钮悬浮在内容之上，
 * 因此左侧留出 `pl-20` 的空位避让；其余区域标记为可拖拽窗口。
 */
export function TitleBar({ environment }: { environment: string }) {
  const { mode, setMode } = useTheme();

  return (
    <header
      className={cn(
        "pk-drag-region flex h-titlebar shrink-0 items-center gap-3",
        "border-b border-line-subtle bg-surface pr-2 pl-20",
      )}
    >
      <span className="text-sm font-semibold tracking-tight">PostKiddie</span>

      <div className="flex-1" />

      <span className="pk-no-drag rounded-md border border-line px-2 py-0.5 text-xs text-fg-secondary">
        {environment}
      </span>

      <div className="pk-no-drag flex items-center rounded-md border border-line p-0.5">
        {MODES.map(({ mode: m, icon: Icon, label }) => (
          <button
            key={m}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "flex size-5 items-center justify-center rounded-sm transition-colors duration-[120ms]",
              mode === m ? "bg-accent-soft text-accent-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            <Icon size={12} strokeWidth={2} />
          </button>
        ))}
      </div>
    </header>
  );
}
