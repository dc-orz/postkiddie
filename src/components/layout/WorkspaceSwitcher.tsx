import { Check, ChevronDown, FolderGit2, FolderOpen, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { openWorkspace, pickAndOpenWorkspace, prettyPath } from "@/stores/session";
import { useWorkspace } from "@/stores/workspace";

/**
 * 标题栏的工作区切换器。
 *
 * 在此之前，换工作区的唯一入口在欢迎页——而欢迎页只在**还没打开任何工作区**时出现，
 * 于是打开之后就再也换不了，只能重启应用。后端从一开始就支持随时换
 * （`workspace_open` 直接覆盖当前工作区），缺的只是这个入口。
 *
 * 用自绘浮层而不是原生 `<select>`：菜单里除了「选哪个」还有「打开其他目录」
 * 和「从列表移除」两类动作，`<option>` 表达不了。代价是焦点与键盘要自己处理，
 * 都在下面。
 */
export function WorkspaceSwitcher() {
  const info = useWorkspace((s) => s.info);
  const recent = useWorkspace((s) => s.recent);
  const forgetRecent = useWorkspace((s) => s.forgetRecent);
  const loading = useWorkspace((s) => s.status === "loading");

  const [open, setOpen] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // 点外面或按 Esc 关掉。浮层不是 <dialog>，这两件事没有免费的实现。
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // 焦点必须回到触发按钮，否则键盘用户会被丢回文档开头
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function run(action: () => Promise<boolean>, path: string | null) {
    setPendingPath(path);
    try {
      // 切成功就收起菜单；失败（用户取消确认、目录没了）时留着，
      // 免得用户还得重新点开才能再试一个
      if (await action()) setOpen(false);
    } finally {
      setPendingPath(null);
    }
  }

  // 当前工作区排在最前，其余按最近使用顺序跟在后面
  const others = recent.filter((path) => path !== info?.root);

  return (
    <div ref={containerRef} className="pk-no-drag relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        title={info ? `${info.name}\n${info.root}` : "工作区"}
        className={cn(
          "flex h-control-sm max-w-56 items-center gap-1.5 rounded-md px-1.5",
          "text-sm font-semibold tracking-tight transition-colors duration-fast",
          "hover:bg-hover",
          open && "bg-hover",
        )}
      >
        {loading ? (
          <Loader2 size={12} strokeWidth={2} className="shrink-0 animate-spin text-fg-muted" />
        ) : (
          <FolderGit2 size={12} strokeWidth={2} className="shrink-0 text-fg-muted" />
        )}
        <span className="pk-truncate">{info?.name ?? "PostKiddie"}</span>
        <ChevronDown size={11} strokeWidth={2} className="shrink-0 text-fg-muted" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className={cn(
            "absolute top-full left-0 z-(--pk-z-popover) mt-1 w-80 overflow-hidden",
            "rounded-md border border-line bg-raised shadow-md",
          )}
        >
          {info ? (
            <MenuRow
              icon={<Check size={12} strokeWidth={2.5} className="text-accent-fg" />}
              label={info.name}
              hint={prettyPath(info.root)}
              current
              onSelect={() => setOpen(false)}
            />
          ) : null}

          {others.length > 0 ? (
            <>
              <div className="border-t border-line-subtle px-2.5 pt-1.5 pb-1">
                <span className="text-2xs font-medium tracking-wide text-fg-muted">最近打开</span>
              </div>
              {others.map((path) => (
                <MenuRow
                  key={path}
                  icon={
                    pendingPath === path ? (
                      <Loader2 size={12} strokeWidth={2} className="animate-spin text-fg-muted" />
                    ) : (
                      <FolderGit2 size={12} strokeWidth={1.75} className="text-fg-muted" />
                    )
                  }
                  label={prettyPath(path)}
                  mono
                  disabled={pendingPath !== null}
                  onSelect={() => void run(() => openWorkspace(path), path)}
                  onForget={() => forgetRecent(path)}
                />
              ))}
            </>
          ) : null}

          <div className="border-t border-line-subtle">
            <MenuRow
              icon={<FolderOpen size={12} strokeWidth={1.75} className="text-fg-muted" />}
              label="打开其他目录…"
              disabled={pendingPath !== null}
              onSelect={() => void run(pickAndOpenWorkspace, null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuRow({
  icon,
  label,
  hint,
  mono,
  current,
  disabled,
  onSelect,
  onForget,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  mono?: boolean;
  current?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** 传了就在行尾显示「从列表移除」 */
  onForget?: () => void;
}) {
  return (
    <div className="group/row flex items-center">
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={onSelect}
        title={hint ?? label}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left",
          "transition-colors duration-fast hover:bg-hover disabled:opacity-50",
          current && "bg-accent-soft",
        )}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("pk-truncate block text-xs", mono && "font-mono")}>{label}</span>
          {hint ? (
            <span className="pk-truncate block font-mono text-2xs text-fg-subtle">{hint}</span>
          ) : null}
        </span>
      </button>

      {onForget ? (
        <button
          type="button"
          aria-label={`从列表中移除 ${label}`}
          title="从列表中移除"
          onClick={onForget}
          className={cn(
            "mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm",
            "text-fg-subtle opacity-0 transition-opacity duration-fast",
            "hover:bg-hover hover:text-fg group-hover/row:opacity-100 focus-visible:opacity-100",
          )}
        >
          <X size={11} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
