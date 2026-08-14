import { ChevronDown, Layers, Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/cn";
import { type ThemeMode, useTheme } from "@/stores/theme";
import { useWorkspace } from "@/stores/workspace";

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
export function TitleBar() {
  const { mode, setMode } = useTheme();
  const workspaceName = useWorkspace((s) => s.info?.name);
  const environments = useWorkspace((s) => s.environments);
  const activeEnvironment = useWorkspace((s) => s.activeEnvironment);
  const setActiveEnvironment = useWorkspace((s) => s.setActiveEnvironment);

  return (
    <header
      className={cn(
        "pk-drag-region flex h-titlebar shrink-0 items-center gap-3",
        "border-b border-line-subtle bg-surface pr-2 pl-20",
      )}
    >
      <span className="pk-truncate text-sm font-semibold tracking-tight">
        {workspaceName ?? "PostKiddie"}
      </span>

      <div className="flex-1" />

      {/* 环境选择器：用原生 select，键盘操作与系统观感都是免费的 */}
      <div
        className={cn(
          "pk-no-drag relative flex h-control-sm items-center rounded-md border border-line",
          "text-xs text-fg-secondary transition-colors duration-fast hover:border-line-strong",
          environments.length === 0 && "opacity-50",
        )}
      >
        <Layers size={11} strokeWidth={2} className="ml-2 shrink-0 text-fg-muted" />
        <select
          aria-label="选择环境"
          value={activeEnvironment ?? ""}
          disabled={environments.length === 0}
          onChange={(e) => setActiveEnvironment(e.target.value || null)}
          className="h-full cursor-default appearance-none bg-transparent pr-5 pl-1.5 outline-none"
        >
          {environments.length === 0 ? (
            <option value="">无环境</option>
          ) : (
            <>
              <option value="">不使用环境</option>
              {environments.map((env) => (
                <option key={env.name} value={env.name}>
                  {env.name}
                </option>
              ))}
            </>
          )}
        </select>
        <ChevronDown
          size={11}
          strokeWidth={2}
          className="pointer-events-none absolute right-1.5 text-fg-muted"
        />
      </div>

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
              "flex size-5 items-center justify-center rounded-sm transition-colors duration-fast",
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
