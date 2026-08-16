import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Loader2,
  Minus,
  Plus,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { DiffDialog, type DiffTarget } from "@/components/git/DiffDialog";
import { cn } from "@/lib/cn";
import { confirmAction, showError } from "@/lib/dialog";
import { shortcut } from "@/lib/platform";
import { useGit } from "@/stores/git";
import { useLayout } from "@/stores/layout";
import type { FileState, StatusEntry } from "@/types/api";

const STATE_MARK: Record<FileState, { char: string; className: string; label: string }> = {
  added: { char: "A", className: "text-git-added", label: "新增" },
  modified: { char: "M", className: "text-git-modified", label: "已修改" },
  deleted: { char: "D", className: "text-git-deleted", label: "已删除" },
  renamed: { char: "R", className: "text-git-renamed", label: "已重命名" },
  copied: { char: "C", className: "text-git-renamed", label: "已复制" },
  untracked: { char: "U", className: "text-git-untracked", label: "未跟踪" },
  ignored: { char: "·", className: "text-fg-subtle", label: "已忽略" },
  conflicted: { char: "!", className: "text-git-conflicted", label: "冲突" },
};

/** 路径拆成「目录 + 文件名」，文件名加重、目录压暗，长路径也能一眼扫到重点 */
function splitPath(path: string): { dir: string; base: string } {
  const slash = path.lastIndexOf("/");
  return slash < 0
    ? { dir: "", base: path }
    : { dir: path.slice(0, slash + 1), base: path.slice(slash + 1) };
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle",
        "transition-colors duration-fast disabled:pointer-events-none disabled:opacity-40",
        danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function FileRow({
  entry,
  actions,
  onOpenDiff,
}: {
  entry: StatusEntry;
  actions: React.ReactNode;
  onOpenDiff: () => void;
}) {
  const mark = STATE_MARK[entry.state];
  const { dir, base } = splitPath(entry.path);

  return (
    <li className="group/row flex h-row items-center gap-1.5 px-2 hover:bg-hover">
      <span
        role="img"
        aria-label={mark.label}
        title={mark.label}
        className={cn("w-2.5 shrink-0 text-center font-mono text-2xs font-bold", mark.className)}
      >
        {mark.char}
      </span>

      {/* 点文件名看差异——这是这个列表上最自然的默认动作，
          用户在别的 git 客户端里也是这么点的 */}
      <button
        type="button"
        onClick={onOpenDiff}
        title={`${entry.path}\n点击查看差异`}
        className="pk-truncate flex-1 text-left text-xs"
      >
        {dir ? <span className="text-fg-subtle">{dir}</span> : null}
        <span className="text-fg-secondary">{base}</span>
      </button>

      <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
        {actions}
      </span>
    </li>
  );
}

export function GitPanel() {
  const status = useGit((s) => s.status);
  const busy = useGit((s) => s.busy);
  const { stage, unstage, discard, commit, pull, push } = useGit();
  const closePanel = useLayout((s) => s.toggleGitPanel);

  const [message, setMessage] = useState("");
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);

  const { staged, unstaged } = useMemo(() => {
    const entries = status?.entries ?? [];
    return {
      staged: entries.filter((e) => e.staged),
      unstaged: entries.filter((e) => !e.staged),
    };
  }, [status]);

  const hasConflicts = status?.hasConflicts ?? false;
  const canCommit = staged.length > 0 && message.trim().length > 0 && !hasConflicts && !busy;

  async function run(action: () => Promise<void>, title: string) {
    try {
      await action();
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), title);
    }
  }

  async function handleCommit() {
    if (!canCommit) return;
    await run(async () => {
      await commit(message);
      setMessage("");
    }, "提交失败");
  }

  async function handleDiscard(paths: string[]) {
    const text =
      paths.length === 1
        ? `将丢弃 ${paths[0]} 的全部改动，无法撤销。`
        : `将丢弃 ${paths.length} 个文件的全部改动，无法撤销。`;

    if (await confirmAction(text, { title: "丢弃改动", okLabel: "丢弃" })) {
      await run(() => discard(paths), "丢弃改动失败");
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-toolbar shrink-0 items-center gap-0.5 border-b border-line-subtle px-2 pl-3">
        <span className="flex-1 text-xs font-medium tracking-wide text-fg-muted">源代码管理</span>

        <IconButton label="拉取" onClick={() => void run(pull, "拉取失败")} disabled={busy}>
          <ArrowDownToLine size={13} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="推送" onClick={() => void run(push, "推送失败")} disabled={busy}>
          <ArrowUpFromLine size={13} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="关闭面板" onClick={closePanel}>
          <X size={13} strokeWidth={2} />
        </IconButton>
      </div>

      {hasConflicts ? (
        <div className="flex shrink-0 items-start gap-1.5 border-b border-line-subtle bg-danger-soft px-3 py-2">
          <TriangleAlert size={12} strokeWidth={2} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-xs text-danger">存在合并冲突。请在编辑器中解决冲突并暂存后再提交。</p>
        </div>
      ) : null}

      {/* 提交框放在顶部：这是这个面板最主要的动作 */}
      <div className="shrink-0 border-b border-line-subtle p-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter 提交，与 IDE 的习惯一致
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleCommit();
            }
          }}
          rows={2}
          placeholder="提交信息（feat: …）"
          aria-label="提交信息"
          className={cn(
            "w-full resize-none rounded-md border border-line bg-sunken px-2 py-1.5",
            "text-xs outline-none transition-colors duration-fast focus:border-line-focus",
            "placeholder:text-fg-subtle",
          )}
        />

        <button
          type="button"
          onClick={() => void handleCommit()}
          disabled={!canCommit}
          title={`提交 (${shortcut("↩")})`}
          className={cn(
            "mt-1.5 flex h-control-md w-full items-center justify-center gap-1.5 rounded-md",
            "bg-accent text-xs font-medium text-fg-on-accent transition-colors duration-fast",
            "hover:bg-accent-hover active:bg-accent-active",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {busy ? (
            <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          ) : (
            <Check size={12} strokeWidth={2} />
          )}
          提交 {staged.length > 0 ? `(${staged.length})` : ""}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {staged.length === 0 && unstaged.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-subtle">
            工作区干净，没有待提交的改动
          </p>
        ) : null}

        {staged.length > 0 ? (
          <>
            <SectionHeader
              title="已暂存"
              count={staged.length}
              action={
                <IconButton
                  label="全部取消暂存"
                  disabled={busy}
                  onClick={() => void run(() => unstage(staged.map((e) => e.path)), "取消暂存失败")}
                >
                  <Minus size={12} strokeWidth={2} />
                </IconButton>
              }
            />
            <ul>
              {staged.map((entry) => (
                <FileRow
                  key={`staged:${entry.path}`}
                  entry={entry}
                  onOpenDiff={() =>
                    setDiffTarget({ path: entry.path, side: "staged", untracked: false })
                  }
                  actions={
                    <IconButton
                      label="取消暂存"
                      disabled={busy}
                      onClick={() => void run(() => unstage([entry.path]), "取消暂存失败")}
                    >
                      <Minus size={12} strokeWidth={2} />
                    </IconButton>
                  }
                />
              ))}
            </ul>
          </>
        ) : null}

        {unstaged.length > 0 ? (
          <>
            <SectionHeader
              title="更改"
              count={unstaged.length}
              action={
                <IconButton
                  label="全部暂存"
                  disabled={busy}
                  onClick={() => void run(() => stage(unstaged.map((e) => e.path)), "暂存失败")}
                >
                  <Plus size={12} strokeWidth={2} />
                </IconButton>
              }
            />
            <ul>
              {unstaged.map((entry) => (
                <FileRow
                  key={`unstaged:${entry.path}`}
                  entry={entry}
                  onOpenDiff={() =>
                    setDiffTarget({
                      path: entry.path,
                      side: "worktree",
                      untracked: entry.state === "untracked",
                    })
                  }
                  actions={
                    <>
                      <IconButton
                        label="丢弃改动"
                        danger
                        disabled={busy}
                        onClick={() => void handleDiscard([entry.path])}
                      >
                        <Undo2 size={12} strokeWidth={2} />
                      </IconButton>
                      <IconButton
                        label="暂存"
                        disabled={busy}
                        onClick={() => void run(() => stage([entry.path]), "暂存失败")}
                      >
                        <Plus size={12} strokeWidth={2} />
                      </IconButton>
                    </>
                  }
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {/*
        弹框放在 <section> 里没问题——这里不像标题栏那样有 `-webkit-app-region: drag`
        会渗到后代身上。
      */}
      <DiffDialog target={diffTarget} onClose={() => setDiffTarget(null)} />
    </section>
  );
}

function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count: number;
  action: React.ReactNode;
}) {
  return (
    <div className="group/section sticky top-0 z-(--pk-z-sticky) flex h-row items-center gap-1 bg-surface px-2">
      <span className="text-2xs font-medium tracking-wide text-fg-muted">{title}</span>
      <span className="pk-tnum text-2xs text-fg-subtle">{count}</span>
      <div className="flex-1" />
      <span className="opacity-0 transition-opacity duration-fast group-hover/section:opacity-100 focus-within:opacity-100">
        {action}
      </span>
    </div>
  );
}
