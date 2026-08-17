import { ArrowDown, ArrowUp, SquareTerminal, TriangleAlert } from "lucide-react";

import { BranchSwitcher } from "@/components/git/BranchSwitcher";
import { cn } from "@/lib/cn";
import { shortcut } from "@/lib/platform";
import { useDirtyCount, useGit } from "@/stores/git";
import { useLayout } from "@/stores/layout";

/**
 * 底部状态栏 —— git 状态的常驻显示位。
 *
 * 把分支、领先/落后提交数放在这里而不是藏进面板，是这个应用相对 Postman 的
 * 核心体验差异：请求集合的版本状态应当像 IDE 里的分支一样时刻可见。
 */
export function StatusBar() {
  const status = useGit((s) => s.status);
  const dirtyCount = useDirtyCount();
  const toggleGitPanel = useLayout((s) => s.toggleGitPanel);
  const gitPanelOpen = useLayout((s) => s.gitPanelOpen);
  const toggleTerminal = useLayout((s) => s.toggleTerminal);
  const terminalOpen = useLayout((s) => s.terminalOpen);

  return (
    <footer
      className={cn(
        "flex h-statusbar shrink-0 items-center gap-3 px-2.5",
        "border-t border-line-subtle bg-surface text-xs text-fg-muted",
      )}
    >
      <BranchSwitcher />

      {status?.upstream ? (
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
      ) : status ? (
        <span className="text-fg-subtle">未关联远程分支</span>
      ) : null}

      <div className="flex-1" />

      {status?.hasConflicts ? (
        <span className="flex items-center gap-1 text-git-conflicted">
          <TriangleAlert size={11} strokeWidth={2} />
          存在冲突
        </span>
      ) : null}

      {/* Git 面板的开关。挂在改动数上而不是分支名上——点「3 项未提交」看那 3 项，
          这条对应关系不需要解释；分支名让给了切换分支（见 BranchSwitcher）。 */}
      {status ? (
        <button
          type="button"
          onClick={toggleGitPanel}
          aria-pressed={gitPanelOpen}
          title="源代码管理"
          className={cn(
            "rounded-sm px-1 hover:bg-hover hover:text-fg",
            gitPanelOpen && "bg-accent-soft text-accent-fg",
          )}
        >
          {dirtyCount > 0 ? (
            <span className="pk-tnum">
              <span className="text-git-modified">{dirtyCount}</span> 项未提交
            </span>
          ) : (
            <span className="text-fg-subtle">工作区干净</span>
          )}
        </button>
      ) : null}

      <button
        type="button"
        onClick={toggleTerminal}
        aria-pressed={terminalOpen}
        title={`终端 (${shortcut("`")})`}
        className={cn(
          "flex items-center gap-1 rounded-sm px-1 hover:bg-hover hover:text-fg",
          terminalOpen && "bg-accent-soft text-accent-fg",
        )}
      >
        <SquareTerminal size={11} strokeWidth={2} />
        <span className="font-medium">终端</span>
      </button>
    </footer>
  );
}
