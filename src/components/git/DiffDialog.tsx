import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { type DiffLine, type FileDiff, parseUnifiedDiff } from "@/lib/diff";
import { git as ipc } from "@/lib/ipc";

/**
 * 单行渲染成本很低，但一个几万行的 diff 会让 DOM 节点数直接压垮渲染。
 *
 * 不上虚拟滚动是有意的：请求集合是一堆小 YAML，正常改动几十行封顶；
 * 真出现超大 diff 时，那多半是误提交了构建产物或数据文件——
 * 那种情况下用户需要的是「知道这文件不对劲」，而不是流畅地翻两万行。
 */
const MAX_LINES = 4000;

type Side = "worktree" | "staged";

export interface DiffTarget {
  /** 相对仓库根的路径 */
  path: string;
  /** 从哪一侧打开。点「已暂存」区的文件就看暂存区。 */
  side: Side;
  /** 未跟踪文件 git diff 给不出内容，要单独交代 */
  untracked: boolean;
}

interface DiffDialogProps {
  target: DiffTarget | null;
  onClose: () => void;
}

export function DiffDialog({ target, onClose }: DiffDialogProps) {
  const [side, setSide] = useState<Side>("worktree");
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 换文件时回到它自己那一侧；不重置的话，从「已暂存」区点开一个文件、
  // 关掉、再从「更改」区点开另一个，看到的会是上一次选的那一侧
  useEffect(() => {
    if (target) setSide(target.side);
  }, [target]);

  useEffect(() => {
    if (!target || target.untracked) {
      setDiff(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void ipc
      .diff(target.path, side === "staged")
      .then((raw) => {
        if (!cancelled) setDiff(parseUnifiedDiff(raw));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target, side]);

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      label="文件差异"
      className="w-[min(56rem,92vw)]"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-2">
        <span className="pk-truncate flex-1 font-mono text-xs" title={target?.path}>
          {target?.path}
        </span>

        {diff && !diff.binary ? (
          <span className="pk-tnum shrink-0 font-mono text-2xs">
            <span className="text-git-added">+{diff.added}</span>{" "}
            <span className="text-git-deleted">−{diff.removed}</span>
          </span>
        ) : null}

        {/* 同一个文件可能两侧都有改动（改了、暂存了一部分、又接着改）。
            这个切换是唯一能把两者分开看的地方。 */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-line p-0.5">
          <SideButton current={side} value="worktree" onSelect={setSide}>
            工作区
          </SideButton>
          <SideButton current={side} value="staged" onSelect={setSide}>
            已暂存
          </SideButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <DiffBody
          untracked={target?.untracked ?? false}
          loading={loading}
          error={error}
          diff={diff}
          side={side}
        />
      </div>
    </Dialog>
  );
}

/** 差异主体的五个状态。抽出来是为了让上面的组件只管布局与取数。 */
function DiffBody({
  untracked,
  loading,
  error,
  diff,
  side,
}: {
  untracked: boolean;
  loading: boolean;
  error: string | null;
  diff: FileDiff | null;
  side: Side;
}) {
  if (untracked) {
    return (
      <Placeholder>
        这是一个未跟踪的新文件，git 还没有它的历史版本可供比较。
        <br />
        暂存之后就能看到完整内容作为新增。
      </Placeholder>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-fg-muted">
        <Loader2 size={13} strokeWidth={2} className="animate-spin" />
        正在读取差异…
      </div>
    );
  }

  if (error) return <Placeholder tone="danger">{error}</Placeholder>;
  if (diff?.binary) return <Placeholder>二进制文件，没有可逐行比较的内容。</Placeholder>;

  if (!diff || diff.lines.length === 0) {
    return (
      <Placeholder>
        {side === "staged" ? "暂存区里没有这个文件的改动。" : "工作区里没有未暂存的改动。"}
      </Placeholder>
    );
  }

  const truncated = diff.lines.length > MAX_LINES;
  const visible = truncated ? diff.lines.slice(0, MAX_LINES) : diff.lines;

  return (
    <>
      <table className="w-full border-collapse font-mono text-2xs">
        <tbody>
          {visible.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff 行由位置定义，内容完全可能重复（连续的空行、相同的缩进），没有比下标更稳定的 key
            <DiffRow key={index} line={line} />
          ))}
        </tbody>
      </table>

      {truncated ? (
        <p className="border-t border-line-subtle px-3 py-2 text-xs text-fg-muted">
          差异过长，只显示前 {MAX_LINES} 行（共 {diff.lines.length} 行）。完整内容请在内置终端里{" "}
          <code className="pk-selectable">git diff</code> 查看。
        </p>
      ) : null}
    </>
  );
}

/** 每种行的背景、行号槽与符号列 */
const ROW_STYLE: Record<DiffLine["kind"], { row: string; gutter: string; sign: string }> = {
  add: { row: "bg-diff-add", gutter: "bg-diff-add-gutter", sign: "text-git-added" },
  del: { row: "bg-diff-del", gutter: "bg-diff-del-gutter", sign: "text-git-deleted" },
  context: { row: "", gutter: "", sign: "text-fg-subtle" },
  hunk: { row: "bg-inset", gutter: "bg-inset", sign: "" },
  note: { row: "bg-inset", gutter: "bg-inset", sign: "" },
};

const SIGN: Record<DiffLine["kind"], string> = {
  add: "+",
  del: "−",
  context: " ",
  hunk: "",
  note: "",
};

function DiffRow({ line }: { line: DiffLine }) {
  const style = ROW_STYLE[line.kind];
  const oldNo = line.kind === "context" || line.kind === "del" ? line.oldNo : null;
  const newNo = line.kind === "context" || line.kind === "add" ? line.newNo : null;

  // hunk 头与旁注不属于任何一行，横跨整行显示
  if (line.kind === "hunk" || line.kind === "note") {
    return (
      <tr className={style.row}>
        <td colSpan={3} className="px-2 py-0.5 text-fg-muted select-text">
          {line.text}
        </td>
      </tr>
    );
  }

  return (
    <tr className={style.row}>
      <td
        className={cn(
          "pk-tnum w-10 border-r border-line-subtle px-1.5 text-right align-top",
          "text-fg-subtle select-none",
          style.gutter,
        )}
      >
        {oldNo ?? ""}
      </td>
      <td
        className={cn(
          "pk-tnum w-10 border-r border-line-subtle px-1.5 text-right align-top",
          "text-fg-subtle select-none",
          style.gutter,
        )}
      >
        {newNo ?? ""}
      </td>
      <td className="w-full px-2 align-top">
        <span className={cn("mr-1 select-none", style.sign)}>{SIGN[line.kind]}</span>
        {/* 保留空白：缩进是 YAML 的语法，压掉它 diff 就没法读了。
            长行不换行而是整体横向滚动，与终端里的 git diff 一致。 */}
        <span className="whitespace-pre select-text">{line.text}</span>
      </td>
    </tr>
  );
}

function SideButton({
  current,
  value,
  onSelect,
  children,
}: {
  current: Side;
  value: Side;
  onSelect: (side: Side) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={current === value}
      onClick={() => onSelect(value)}
      className={cn(
        "h-control-sm rounded-sm px-2 text-xs transition-colors duration-fast",
        current === value
          ? "bg-accent-soft font-medium text-accent-fg"
          : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function Placeholder({ children, tone }: { children: React.ReactNode; tone?: "danger" }) {
  return (
    <p
      className={cn(
        "px-6 py-12 text-center text-xs",
        tone === "danger" ? "text-danger" : "text-fg-muted",
      )}
    >
      {children}
    </p>
  );
}
