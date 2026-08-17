import { FolderGit2, FolderOpen, Loader2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { openWorkspace, pickAndOpenWorkspace, prettyPath } from "@/stores/session";
import { useWorkspace } from "@/stores/workspace";

export function WelcomeScreen() {
  const { recent, forgetRecent, status, error } = useWorkspace();
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const loading = status === "loading";

  /**
   * 打开逻辑（含「目录还不是工作区就引导初始化」）在 `stores/session` 里，
   * 与标题栏的切换器共用一份——两处各写一遍的话，规则迟早会漂移。
   */
  async function run(action: () => Promise<boolean>, path: string | null) {
    setBusyPath(path);
    try {
      await action();
    } finally {
      setBusyPath(null);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-canvas px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-xl bg-accent text-fg-on-accent">
          <FolderGit2 size={26} strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">PostKiddie</h1>
          <p className="mt-1 text-sm text-fg-muted">把 HTTP 请求存进 Git 仓库</p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button
          variant="primary"
          size="lg"
          onClick={() => void run(pickAndOpenWorkspace, null)}
          disabled={loading}
        >
          {loading ? (
            <Loader2 size={13} strokeWidth={2} className="animate-spin" />
          ) : (
            <FolderOpen size={13} strokeWidth={2} />
          )}
          选择工作区目录
        </Button>
        <p className="text-xs text-fg-subtle">目录不是工作区时会引导你初始化</p>
      </div>

      {/*
        store 里的 error 此前从不展示。启动时自动重开上次的工作区若失败，
        用户看到的就是一个干净的欢迎页——上次打开的那个去哪了、为什么没进去，
        一点线索都没有。这条提示是那种情况下唯一的交代。
      */}
      {error ? (
        <div className="max-w-md rounded-md border border-danger-line bg-danger-soft px-3 py-2">
          <p className="text-xs text-danger">
            上次的工作区没能打开：<span className="pk-selectable">{error.message}</span>
          </p>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <section className="w-full max-w-md">
          <h2 className="mb-1.5 px-2 text-xs font-medium tracking-wide text-fg-muted">最近打开</h2>
          <ul className="overflow-hidden rounded-md border border-line bg-surface">
            {recent.map((path) => (
              <li
                key={path}
                className="group/item flex items-center border-b border-line-subtle last:border-b-0"
              >
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void run(() => openWorkspace(path), path)}
                  title={path}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left",
                    "transition-colors duration-fast hover:bg-hover disabled:opacity-50",
                  )}
                >
                  {busyPath === path ? (
                    <Loader2 size={13} strokeWidth={2} className="animate-spin text-fg-muted" />
                  ) : (
                    <FolderGit2 size={13} strokeWidth={1.75} className="text-fg-muted" />
                  )}
                  <span className="pk-truncate flex-1 font-mono text-xs">{prettyPath(path)}</span>
                </button>

                <button
                  type="button"
                  aria-label={`从列表中移除 ${prettyPath(path)}`}
                  title="从列表中移除"
                  onClick={() => forgetRecent(path)}
                  className={cn(
                    "mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm",
                    "text-fg-subtle opacity-0 transition-opacity duration-fast",
                    "hover:bg-hover hover:text-fg group-hover/item:opacity-100 focus-visible:opacity-100",
                  )}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
