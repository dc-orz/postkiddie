import { useMemo } from "react";
import { create } from "zustand";

import { IpcCallError, git as ipc } from "@/lib/ipc";
import type { FileState, GitStatus } from "@/types/api";
import { useRequest } from "./request";
import { flattenRequests, useWorkspace } from "./workspace";

interface GitState {
  status: GitStatus | null;
  busy: boolean;
  error: IpcCallError | null;

  refresh: () => Promise<void>;
  /** 丢掉当前仓库的状态。换工作区时用——留着的话状态栏会挂着上一个仓库的分支。 */
  reset: () => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<void>;
  /** 切换分支。`create` 为 true 时从当前 HEAD 新建。 */
  checkout: (branch: string, create?: boolean) => Promise<void>;
  pull: () => Promise<void>;
  push: () => Promise<void>;
  fetch: () => Promise<void>;
  clearError: () => void;
}

function toIpcError(error: unknown): IpcCallError {
  return error instanceof IpcCallError ? error : new IpcCallError("invalid", String(error));
}

export const useGit = create<GitState>()((set, get) => {
  /**
   * 包装一个会改变仓库状态的操作：跑完刷新 git 状态，
   * 若操作可能改动工作树内容（pull、丢弃改动）则连集合树一起重扫。
   */
  async function mutate(action: () => Promise<void>, rescanTree = false) {
    set({ busy: true, error: null });
    try {
      await action();
      await get().refresh();
      if (rescanTree) await useWorkspace.getState().refresh();
    } catch (error) {
      set({ error: toIpcError(error) });
      throw error;
    } finally {
      set({ busy: false });
    }
  }

  return {
    status: null,
    busy: false,
    error: null,

    refresh: async () => {
      if (!useWorkspace.getState().info) return;
      try {
        set({ status: await ipc.status(), error: null });
      } catch (error) {
        // 状态查询失败不阻塞界面，保留上一次的结果
        console.error("获取 git 状态失败", error);
      }
    },

    reset: () => set({ status: null, error: null, busy: false }),

    stage: (paths) => mutate(() => ipc.stage(paths)),
    unstage: (paths) => mutate(() => ipc.unstage(paths)),
    discard: (paths) => mutate(() => ipc.discard(paths), true),
    commit: (message) => mutate(async () => void (await ipc.commit(message))),

    checkout: (branch, create = false) =>
      mutate(async () => {
        await ipc.checkout(branch, create);
        // 重扫要在下面的判断之前发生，所以这里直接调，不走 mutate 的 rescanTree
        await useWorkspace.getState().refresh();

        // 分支之间的文件集合是不同的：当前打开的请求很可能在新分支上根本不存在。
        // 不关掉的话，编辑区会挂着一个指向已消失文件的草稿，一按保存就把它
        // **重新创建**到新分支上——用户并没有想在这里加这个接口。
        const { id, close } = useRequest.getState();
        if (id && !flattenRequests(useWorkspace.getState().tree).some((n) => n.id === id)) {
          close();
        }
      }),

    pull: () => mutate(() => ipc.pull(true), true),
    push: () => mutate(() => ipc.push(false)),
    fetch: () => mutate(() => ipc.fetch()),

    clearError: () => set({ error: null }),
  };
});

/** 同一路径可能同时有暂存与工作区改动，树上只显示最紧要的那个 */
const SEVERITY: Record<FileState, number> = {
  conflicted: 6,
  deleted: 5,
  added: 4,
  renamed: 3,
  copied: 3,
  modified: 2,
  untracked: 1,
  ignored: 0,
};

/** 路径 → 文件状态，供集合树打标记 */
export function useGitFileStates(): Record<string, FileState> {
  const entries = useGit((s) => s.status?.entries);

  return useMemo(() => {
    const map: Record<string, FileState> = {};
    for (const entry of entries ?? []) {
      const current = map[entry.path];
      if (!current || SEVERITY[entry.state] > SEVERITY[current]) {
        map[entry.path] = entry.state;
      }
    }
    return map;
  }, [entries]);
}

/** 未提交的改动数（同一文件的暂存+工作区两条记录只算一次） */
export function useDirtyCount(): number {
  const entries = useGit((s) => s.status?.entries);
  return useMemo(() => new Set((entries ?? []).map((e) => e.path)).size, [entries]);
}
