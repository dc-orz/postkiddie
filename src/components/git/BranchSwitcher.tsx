import { Check, Cloud, GitBranch, Loader2, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { showError } from "@/lib/dialog";
import { git as ipc } from "@/lib/ipc";
import { useGit } from "@/stores/git";
import type { BranchInfo } from "@/types/api";

/**
 * 状态栏上的分支切换器。
 *
 * 点分支名切分支，是所有 git 客户端的共同约定，用户不需要学。
 * （Git 面板的开关挪到了状态栏右侧的「N 项未提交」上——点改动数看改动列表，
 * 同样不需要解释。）
 *
 * 切换本身交给 `git switch` 判断：带着未提交改动切分支，能切的 git 会让它过，
 * 不能切的会给出足够清楚的理由。前端再叠一层预判只会和 git 的真实行为不一致。
 */
export function BranchSwitcher() {
  const status = useGit((s) => s.status);
  const busy = useGit((s) => s.busy);
  const checkout = useGit((s) => s.checkout);

  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // 打开时才拉分支列表：它要跑一次 git 子进程，而绝大多数时候用户只是在看分支名
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setBranches(null);
    void ipc
      .branches()
      .then((list) => {
        if (!cancelled) setBranches(list);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // 点外面或按 Esc 关掉
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // 每次重新打开都回到干净状态，免得上次输了一半的分支名还留在那
  useEffect(() => {
    if (!open) {
      setFilter("");
      setCreating(false);
      setNewName("");
    }
  }, [open]);

  async function run(branch: string, create: boolean) {
    setPending(branch);
    try {
      await checkout(branch, create);
      setOpen(false);
    } catch (error) {
      // git 的报错本身就足够清楚（「本地改动会被覆盖」会连文件名一起列出来），
      // 原样转给用户，不要二次包装成「切换失败」了事
      await showError(error instanceof Error ? error.message : String(error), "切换分支失败");
    } finally {
      setPending(null);
    }
  }

  const keyword = filter.trim().toLowerCase();
  const label = status?.branch ?? (status ? "分离 HEAD" : "—");

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        title="切换分支"
        className={cn(
          "flex items-center gap-1 rounded-sm px-1 hover:bg-hover hover:text-fg",
          open && "bg-accent-soft text-accent-fg",
        )}
      >
        {busy ? (
          <Loader2 size={11} strokeWidth={2} className="animate-spin" />
        ) : (
          <GitBranch size={11} strokeWidth={2} />
        )}
        <span className="font-medium text-fg-secondary">{label}</span>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          className={cn(
            // 状态栏在最底部，浮层必须向上展开
            "absolute bottom-full left-0 z-(--pk-z-popover) mb-1 flex w-72 flex-col",
            "overflow-hidden rounded-md border border-line bg-raised shadow-md",
          )}
        >
          <div className="shrink-0 border-b border-line-subtle p-1.5">
            <input
              // biome-ignore lint/a11y/noAutofocus: 打开分支列表的下一个动作必然是找分支，不自动聚焦等于每次都要多点一下
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="筛选分支"
              aria-label="筛选分支"
              className={cn(
                "h-control-sm w-full rounded-sm bg-sunken px-2 text-xs outline-none",
                "placeholder:text-fg-subtle",
              )}
            />
          </div>

          <div className="max-h-72 min-h-0 flex-1 overflow-auto">
            <BranchList
              branches={branches}
              keyword={keyword}
              pending={pending}
              onSelect={(branch) => void run(branch, false)}
            />
          </div>

          <div className="shrink-0 border-t border-line-subtle">
            <CreateBranch
              active={creating}
              name={newName}
              busy={pending !== null}
              onNameChange={setNewName}
              onStart={() => {
                setCreating(true);
                // 输了一半的筛选词多半就是想建的分支名，直接带过去
                setNewName(filter.trim());
              }}
              onSubmit={(name) => void run(name, true)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BranchList({
  branches,
  keyword,
  pending,
  onSelect,
}: {
  /** null = 还在读 */
  branches: BranchInfo[] | null;
  keyword: string;
  pending: string | null;
  /** 传出的已经是可直接交给 `git switch` 的名字 */
  onSelect: (branch: string) => void;
}) {
  if (branches === null) {
    return <p className="px-3 py-4 text-center text-xs text-fg-muted">正在读取分支…</p>;
  }

  const matched = branches.filter((b) => b.name.toLowerCase().includes(keyword));
  if (matched.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-xs text-fg-muted">
        {keyword ? "没有匹配的分支" : "还没有任何分支"}
      </p>
    );
  }

  const local = matched.filter((b) => !b.isRemote);
  const remote = matched.filter((b) => b.isRemote);

  return (
    <>
      {local.map((branch) => (
        <BranchRow
          key={branch.name}
          branch={branch}
          pending={pending === branch.name}
          disabled={pending !== null}
          onSelect={() => onSelect(branch.name)}
        />
      ))}

      {remote.length > 0 ? (
        <div className="border-t border-line-subtle px-2.5 pt-1.5 pb-1">
          <span className="text-2xs font-medium tracking-wide text-fg-muted">远程分支</span>
        </div>
      ) : null}

      {remote.map((branch) => (
        <BranchRow
          key={branch.name}
          branch={branch}
          pending={pending === branch.name}
          disabled={pending !== null}
          // 对 `origin/foo` 执行 `git switch foo` 会自动建一个跟踪它的本地分支，
          // 所以这里把 remote 前缀剥掉，让 git 走它自己的 DWIM 规则
          onSelect={() => onSelect(stripRemote(branch.name))}
        />
      ))}
    </>
  );
}

function CreateBranch({
  active,
  name,
  busy,
  onNameChange,
  onStart,
  onSubmit,
}: {
  active: boolean;
  name: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onStart: () => void;
  onSubmit: (name: string) => void;
}) {
  if (!active) {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={onStart}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-hover"
      >
        <Plus size={12} strokeWidth={2} className="shrink-0 text-fg-muted" />
        <span className="text-xs">从当前分支新建…</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed) onSubmit(trimmed);
      }}
      className="flex items-center gap-1 p-1.5"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: 点了「新建分支」之后唯一要做的事就是输入名字
        autoFocus
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="新分支名"
        aria-label="新分支名"
        className={cn(
          "h-control-sm min-w-0 flex-1 rounded-sm bg-sunken px-2 text-xs outline-none",
          "placeholder:text-fg-subtle",
        )}
      />
      <button
        type="submit"
        disabled={name.trim().length === 0 || busy}
        className={cn(
          "h-control-sm shrink-0 rounded-sm bg-accent px-2 text-xs text-fg-on-accent",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        创建
      </button>
    </form>
  );
}

/** `origin/feature/x` → `feature/x` */
function stripRemote(name: string): string {
  const slash = name.indexOf("/");
  return slash < 0 ? name : name.slice(slash + 1);
}

function BranchRow({
  branch,
  pending,
  disabled,
  onSelect,
}: {
  branch: BranchInfo;
  pending: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled || branch.isCurrent}
      onClick={onSelect}
      title={branch.upstream ? `跟踪 ${branch.upstream}` : branch.name}
      className={cn(
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
        "transition-colors duration-fast hover:bg-hover",
        // 当前分支不可点，但不该压暗——它是列表里最该看清的一行
        branch.isCurrent ? "bg-accent-soft" : "disabled:opacity-50",
      )}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {pending ? (
          <Loader2 size={12} strokeWidth={2} className="animate-spin text-fg-muted" />
        ) : branch.isCurrent ? (
          <Check size={12} strokeWidth={2.5} className="text-accent-fg" />
        ) : branch.isRemote ? (
          <Cloud size={12} strokeWidth={1.75} className="text-fg-muted" />
        ) : (
          <GitBranch size={12} strokeWidth={1.75} className="text-fg-muted" />
        )}
      </span>

      <span className="pk-truncate flex-1 font-mono text-xs">{branch.name}</span>

      {branch.upstream && !branch.isRemote ? (
        <span className="pk-truncate max-w-24 shrink-0 font-mono text-2xs text-fg-subtle">
          {branch.upstream}
        </span>
      ) : null}
    </button>
  );
}
