import { ArrowDown, ArrowUp, GitBranch, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import type { GitStatus } from "@/types/api";

/**
 * 底部状态栏 —— git 状态的常驻显示位。
 *
 * 把分支、领先/落后提交数放在这里而不是藏进面板，是这个应用相对 Postman 的
 * 核心体验差异：请求集合的版本状态应当像 IDE 里的分支一样时刻可见。
 */
export function StatusBar({ status, dirtyCount }: { status: GitStatus; dirtyCount: number }) {
  return (
    <footer
      className={cn(
        "flex h-statusbar shrink-0 items-center gap-3 px-2.5",
        "border-t border-line-subtle bg-surface text-xs text-fg-muted",
      )}
    >
      <button
        type="button"
        className="flex items-center gap-1 rounded-sm px-1 hover:bg-hover hover:text-fg"
      >
        <GitBranch size={11} strokeWidth={2} />
        <span className="font-medium text-fg-secondary">{status.branch ?? "分离 HEAD"}</span>
      </button>

      {status.upstream ? (
        <span className="pk-tnum flex items-center gap-1.5 font-mono">
          <span className={cn("flex items-center gap-0.5", status.ahead > 0 && "text-git-ahead")}>
            <ArrowUp size={10} strokeWidth={2.5} />
            {status.ahead}
          </span>
          <span className={cn("flex items-center gap-0.5", status.behind > 0 && "text-git-behind")}>
            <ArrowDown size={10} strokeWidth={2.5} />
            {status.behind}
          </span>
        </span>
      ) : (
        <span className="text-fg-subtle">未关联远程分支</span>
      )}

      <div className="flex-1" />

      {status.hasConflicts ? (
        <span className="flex items-center gap-1 text-git-conflicted">
          <TriangleAlert size={11} strokeWidth={2} />
          存在冲突
        </span>
      ) : null}

      {dirtyCount > 0 ? (
        <span className="pk-tnum">
          <span className="text-git-modified">{dirtyCount}</span> 项未提交
        </span>
      ) : (
        <span className="text-fg-subtle">工作区干净</span>
      )}
    </footer>
  );
}
