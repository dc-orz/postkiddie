/**
 * 工作区会话的编排层。
 *
 * ## 为什么单独一个文件
 *
 * `request` 与 `git` 两个 store 都已经 import 了 `workspace`（读当前工作区、
 * 换完请求后重扫集合树）。要让 `workspace` 反过来通知它们，就会形成循环 import。
 * 这一层的依赖方向是单向的 `session → {workspace, request, git}`，由 UI 调用。
 *
 * ## 它解决的问题
 *
 * 换工作区不只是「换一棵树」。请求的身份是**相对工作区根的路径**，git 状态属于
 * **某一个仓库**——两者跨工作区都不成立。上一个工作区留下的 `id` 在新工作区里
 * 要么指向另一个完全不同的接口，要么指向一个不存在的文件。
 */

import { confirmAction, pickDirectory, showError } from "@/lib/dialog";
import { IpcCallError } from "@/lib/ipc";
import { useGit } from "./git";
import { hasUnsavedChanges, useRequest } from "./request";
import { useWorkspace } from "./workspace";

/** 取路径最后一段作为默认工作区名 */
function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? "workspace";
}

/** 家目录前缀折叠成 `~`，长路径在提示里才不会顶到屏幕外 */
export function prettyPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}

/**
 * 挂上跨 store 的联动。在 `main.tsx` 里调用一次。
 *
 * 做成显式调用而不是模块顶层的副作用：副作用式的注册在打包器眼里是可以摇掉的，
 * 而且「什么时候生效」得靠读 import 图才能确定。
 */
export function initSession(): void {
  useWorkspace.subscribe(
    (s) => s.info?.root,
    (_root, previous) => {
      // 首次打开时本来就是空的，没什么可清理
      if (!previous) return;

      // 监听器在 `set` 的同一个同步栈里跑完，因此不存在「新集合树配着旧请求」
      // 这一帧。若改成在每个切换入口手动重置，那一帧就会真实存在。
      useRequest.getState().close();
      useGit.getState().reset();
    },
  );
}

/**
 * 征得同意后初始化工作区。
 *
 * 在别人的目录里创建 `.git` 或写入文件是有副作用的，必须先说清楚要做什么。
 */
async function promptInit(path: string, needsGitInit: boolean): Promise<boolean> {
  const structure = "工作区结构（postkiddie.yaml、collections/、environments/）";
  const text = needsGitInit
    ? `${prettyPath(path)}\n\n该目录不在任何 git 仓库内。继续将在此初始化 git 仓库，并创建${structure}。`
    : `${prettyPath(path)}\n\n该目录还不是 PostKiddie 工作区。继续将在此创建${structure}。`;

  if (!(await confirmAction(text, { title: "初始化工作区", okLabel: "初始化" }))) return false;

  try {
    await useWorkspace.getState().init(path, basename(path));
    return true;
  } catch (error) {
    await showError(error instanceof Error ? error.message : String(error), "初始化失败");
    return false;
  }
}

/**
 * 打开一个目录作为工作区，返回是否真的打开了。
 *
 * 所有入口（欢迎页、最近列表、标题栏的切换器）都走这里，因为「目录还不是工作区
 * 就引导初始化」「有未保存改动先问一声」这两条规则在每个入口都成立，
 * 而复制三份的下场是它们迟早各自漂移。
 */
export async function openWorkspace(path: string): Promise<boolean> {
  const { info, open, clearError } = useWorkspace.getState();

  // 已经是当前这个了，什么都不用做——重开一次会把用户正在编辑的东西白白清掉
  if (info?.root === path) return true;

  if (info && hasUnsavedChanges()) {
    const confirmed = await confirmAction("当前请求有未保存的改动，切换工作区会丢弃它们。", {
      title: "切换工作区",
      okLabel: "放弃改动并切换",
    });
    if (!confirmed) return false;
  }

  try {
    await open(path);
    return true;
  } catch (error) {
    if (!(error instanceof IpcCallError)) throw error;

    // 切换失败时旧工作区仍然完好（`open` 只在成功后才改 info），
    // 但 status 已经被打成 error 了，要放回去，否则界面会一直显示着错误态
    if (info) clearError();

    const needsGitInit = error.kind === "not-a-git-repo";
    const needsWorkspaceInit = error.kind === "invalid";

    if (needsGitInit || needsWorkspaceInit) {
      return promptInit(path, needsGitInit);
    }

    await showError(error.message, "打开工作区失败");
    return false;
  }
}

/**
 * 弹系统目录选择器，再打开选中的目录。用户取消时返回 false。
 *
 * 只暴露「选目录」一个入口，把「打开已有」和「新建」合并成同一条路径——
 * 用户往往并不确定某个目录是否已经是工作区，让他先做这个判断是多余的。
 */
export async function pickAndOpenWorkspace(): Promise<boolean> {
  let path: string | null;
  try {
    path = await pickDirectory("选择工作区目录");
  } catch {
    // 浏览器里跑 `pnpm dev` 时没有 Tauri 运行时，拿不到系统文件选择器
    await showError("需要在桌面应用中打开目录，请运行 pnpm app:dev").catch(() => {});
    return false;
  }

  return path ? openWorkspace(path) : false;
}
