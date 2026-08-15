import { Monitor, Moon, Sun, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { resolveScale, SCALE_STEPS, type UiScale, useSettings } from "@/stores/settings";
import { type ThemeMode, useTheme } from "@/stores/theme";

/**
 * 分段控件。
 *
 * 底下是真的 `<input type="radio">`，只是视觉上藏了起来：
 * 一组同名 radio 自带方向键切换、Tab 只停一次、读屏播报「3 个中的第 2 个」，
 * 这些用一排 button + role="radio" 都得自己补，还容易补漏。
 * 焦点环靠 `has-[:focus-visible]` 转印到外层 label 上，键盘操作才看得见落点。
 */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; icon?: typeof Sun }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();

  return (
    <fieldset className="flex items-center gap-0.5 rounded-md border border-line p-0.5">
      <legend className="pk-sr-only">{label}</legend>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <label
            key={String(option.value)}
            className={cn(
              "flex h-6 items-center justify-center gap-1 rounded-sm px-2 text-xs",
              "transition-colors duration-fast",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1",
              "has-[:focus-visible]:outline-(--pk-border-focus)",
              active
                ? "bg-accent-soft text-accent-fg"
                : "text-fg-muted hover:bg-hover hover:text-fg",
            )}
          >
            <input
              type="radio"
              name={name}
              checked={active}
              onChange={() => onChange(option.value)}
              className="pk-sr-only"
            />
            {option.icon ? <option.icon size={12} strokeWidth={2} /> : null}
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}

/** 一行设置项：左边标题与说明，右边控件 */
function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <div className="min-w-0">
        <div className="text-sm text-fg">{title}</div>
        {hint ? <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line-subtle px-4 py-2 last:border-b-0">
      <h3 className="pt-1 pb-0.5 text-xs font-medium tracking-wide text-fg-subtle uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

const THEMES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "亮色", icon: Sun },
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "dark", label: "暗色", icon: Moon },
];

const SCALE_OPTIONS: { value: UiScale; label: string }[] = [
  { value: "auto", label: "自动" },
  ...SCALE_STEPS.map((step) => ({ value: step as UiScale, label: `${Math.round(step * 100)}%` })),
];

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { mode, setMode } = useTheme();
  const { uiScale, setUiScale } = useSettings();

  // 原生 dialog 的开合只能靠命令式 API，用 effect 把它同步到受控的 open
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const effective = resolveScale(uiScale);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: onClick 只处理「点遮罩关闭」，键盘侧由原生 dialog 的 ESC 承担
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="pk-dialog w-[34rem] max-w-[90vw]"
    >
      <header className="flex h-toolbar shrink-0 items-center border-b border-line-subtle px-4">
        <h2 className="flex-1 text-md font-medium">设置</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </header>

      <Section title="外观">
        <Row title="主题" hint="切换由 CSS 完成，不会闪烁。">
          <Segmented label="主题" options={THEMES} value={mode} onChange={setMode} />
        </Row>
      </Section>

      <Section title="界面">
        <Row
          title="界面缩放"
          hint={
            uiScale === "auto"
              ? `按屏幕宽度 ${window.screen.width} 推断为 ${Math.round(effective * 100)}%。觉得不合适可以固定一档。`
              : "整个界面等比缩放，包括编辑器与列表行高。"
          }
        >
          <Segmented
            label="界面缩放"
            options={SCALE_OPTIONS}
            value={uiScale}
            onChange={setUiScale}
          />
        </Row>
      </Section>

      <footer className="flex h-11 shrink-0 items-center justify-end border-t border-line-subtle px-4">
        <Button variant="primary" onClick={onClose}>
          完成
        </Button>
      </footer>
    </dialog>
  );
}
