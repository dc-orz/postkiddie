import { FolderGit2, FolderOpen, Loader2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { confirmAction, pickDirectory, showError } from "@/lib/dialog";
import { IpcCallError } from "@/lib/ipc";
import { useWorkspace } from "@/stores/workspace";

/** 取路径最后一段作为默认工作区名 */
function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? "workspace";
}

/** 家目录前缀折叠成 ~，长路径在列表里才不会挤成一团 */
function prettyPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}

export function WelcomeScreen() {
  const { open, init, recent, forgetRecent, status, error } = useWorkspace();
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const loading = status === "loading";

  /** 征得同意后初始化。在别人的目录里创建 .git 是有副作用的，必须先说清楚要做什么。 */
  async function promptInit(path: string, needsGitInit: boolean) {
    const structure = "工作区结构（postkiddie.yaml、collections/、environments/）";
    const text = needsGitInit
      ? `${prettyPath(path)}\n\n该目录不在任何 git 仓库内。继续将在此初始化 git 仓库，并创建${structure}。`
      : `${prettyPath(path)}\n\n该目录还不是 PostKiddie 工作区。继续将在此创建${structure}。`;

    if (!(await confirmAction(text, { title: "初始化工作区", okLabel: "初始化" }))) return;

    try {
      await init(path, basename(path));
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "初始化失败");
    }
  }

  /** 打开失败时分流：能靠初始化解决的就引导，其余直接报错 */
  async function handleOpenError(path: string, error: unknown) {
    if (!(error instanceof IpcCallError)) throw error;

    const needsGitInit = error.kind === "not-a-git-repo";
    const needsWorkspaceInit = error.kind === "invalid";

    if (needsGitInit || needsWorkspaceInit) {
      await promptInit(path, needsGitInit);
    } else {
      await showError(error.message, "打开工作区失败");
    }
  }

  /**
   * 打开一个目录，并在它还不是工作区时引导初始化。
   *
   * 只暴露「选目录」一个入口，把「打开已有」和「新建」合并成同一条路径——
   * 用户往往并不确定某个目录是否已经是工作区，让他先做这个判断是多余的。
   */
  async function openPath(path: string) {
    setBusyPath(path);
    try {
      await open(path);
    } catch (error) {
      await handleOpenError(path, error);
    } finally {
      setBusyPath(null);
    }
  }

  async function handlePick() {
    try {
      const path = await pickDirectory("选择工作区目录");
      if (path) await openPath(path);
    } catch {
      // 浏览器里跑 `pnpm dev` 时没有 Tauri 运行时，拿不到系统文件选择器
      await showError("需要在桌面应用中打开目录，请运行 pnpm app:dev").catch(() => {});
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
        <Button variant="primary" size="lg" onClick={handlePick} disabled={loading}>
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
                  onClick={() => void openPath(path)}
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
