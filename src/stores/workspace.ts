import { useMemo } from "react";
import { create } from "zustand";
import { persist, subscribeWithSelector } from "zustand/middleware";

import {
  environment as environmentIpc,
  folder as folderIpc,
  IpcCallError,
  workspace as ipc,
  request as requestIpc,
} from "@/lib/ipc";
import type { Environment, HttpMethod, TreeNode, WorkspaceInfo } from "@/types/api";

const MAX_RECENT = 8;

type Status = "empty" | "loading" | "ready" | "error";

interface WorkspaceState {
  info: WorkspaceInfo | null;
  tree: TreeNode[];
  environments: Environment[];
  activeEnvironment: string | null;
  status: Status;
  error: IpcCallError | null;
  /** 最近打开过的工作区路径，最新的在前 */
  recent: string[];

  open: (path: string) => Promise<void>;
  init: (path: string, name: string) => Promise<void>;
  /** 重新扫描磁盘。外部编辑、git pull、切分支之后都要调用。 */
  refresh: () => Promise<void>;
  /** 新建请求，返回其 id */
  createRequest: (parent: string | null, name: string, method?: HttpMethod) => Promise<string>;
  /** 新建文件夹，返回其 id */
  createFolder: (parent: string | null, name: string) => Promise<string>;
  /** 重命名请求，返回新的 id（文件名会跟着变） */
  renameRequest: (id: string, name: string) => Promise<string>;
  /** 移动请求到目标目录的指定位置，返回新的 id */
  moveRequest: (id: string, targetParent: string | null, index: number | null) => Promise<string>;
  deleteRequest: (id: string) => Promise<void>;

  saveEnvironment: (name: string, environment: Environment) => Promise<void>;
  createEnvironment: (name: string) => Promise<Environment>;
  deleteEnvironment: (name: string) => Promise<void>;

  setActiveEnvironment: (name: string | null) => void;
  forgetRecent: (path: string) => void;
  clearError: () => void;
}

/**
 * `subscribeWithSelector` 是为跨 store 的清理准备的（见 `stores/session.ts`）：
 * 换工作区时，请求编辑器与 git 面板里残留的上一个仓库的状态必须一起作废。
 * 让它们订阅 `info.root` 的变化，比在每个切换入口手动调一遍重置可靠——
 * 监听器在 `set` 的同一个同步栈里跑完，中间不存在「新树 + 旧请求」的渲染窗口。
 */
export const useWorkspace = create<WorkspaceState>()(
  subscribeWithSelector(
    persist(
      (set, get) => {
        /** 打开/初始化成功后统一装载集合树与环境 */
        async function load(info: WorkspaceInfo, path: string) {
          const [tree, environments] = await Promise.all([ipc.tree(), ipc.environments()]);

          const recent = [path, ...get().recent.filter((p) => p !== path)].slice(0, MAX_RECENT);
          const active = get().activeEnvironment;

          set({
            info,
            tree,
            environments,
            recent,
            status: "ready",
            error: null,
            // 之前选的环境在新工作区里可能不存在，此时退回第一个
            activeEnvironment:
              active && environments.some((e) => e.name === active)
                ? active
                : (environments[0]?.name ?? null),
          });
        }

        /** 统一的错误归置：记进 store 供 UI 展示，同时抛出让调用方能按 kind 分支 */
        function fail(error: unknown): never {
          const ipcError =
            error instanceof IpcCallError ? error : new IpcCallError("invalid", String(error));
          set({ status: "error", error: ipcError });
          throw ipcError;
        }

        return {
          info: null,
          tree: [],
          environments: [],
          activeEnvironment: null,
          status: "empty",
          error: null,
          recent: [],

          open: async (path) => {
            set({ status: "loading", error: null });
            try {
              await load(await ipc.open(path), path);
            } catch (error) {
              fail(error);
            }
          },

          init: async (path, name) => {
            set({ status: "loading", error: null });
            try {
              await load(await ipc.init(path, name), path);
            } catch (error) {
              fail(error);
            }
          },

          refresh: async () => {
            if (!get().info) return;
            try {
              const [tree, environments] = await Promise.all([ipc.tree(), ipc.environments()]);
              set({ tree, environments });
            } catch (error) {
              // 刷新失败不该把整个界面打回错误态——之前加载的树仍然可用
              console.error("刷新工作区失败", error);
            }
          },

          createRequest: async (parent, name, method) => {
            const id = await requestIpc.create(parent, name, method);
            await get().refresh();
            return id;
          },

          createFolder: async (parent, name) => {
            const id = await folderIpc.create(parent, name);
            await get().refresh();
            return id;
          },

          renameRequest: async (id, name) => {
            const newId = await requestIpc.rename(id, name);
            await get().refresh();
            return newId;
          },

          moveRequest: async (id, targetParent, index) => {
            const newId = await requestIpc.move(id, targetParent, index);
            await get().refresh();
            return newId;
          },

          deleteRequest: async (id) => {
            await requestIpc.remove(id);
            await get().refresh();
          },

          saveEnvironment: async (name, environment) => {
            await environmentIpc.save(name, environment);
            await get().refresh();
          },

          createEnvironment: async (name) => {
            const created = await environmentIpc.create(name);
            await get().refresh();
            // 刚建好就切过去，否则用户还得再去下拉框点一次
            set({ activeEnvironment: created.name });
            return created;
          },

          deleteEnvironment: async (name) => {
            await environmentIpc.remove(name);
            await get().refresh();

            // 删掉的正是当前选中的，退回到剩下的第一个
            if (get().activeEnvironment === name) {
              set({ activeEnvironment: get().environments[0]?.name ?? null });
            }
          },

          setActiveEnvironment: (activeEnvironment) => set({ activeEnvironment }),

          forgetRecent: (path) => set((s) => ({ recent: s.recent.filter((p) => p !== path) })),

          clearError: () => set((s) => ({ error: null, status: s.info ? "ready" : "empty" })),
        };
      },
      {
        name: "postkiddie.workspace",
        version: 1,
        // 只持久化「下次启动需要的线索」，树和环境每次都从磁盘重新扫描——
        // 磁盘是唯一事实来源，缓存它只会带来不一致
        partialize: (s) => ({
          recent: s.recent,
          activeEnvironment: s.activeEnvironment,
        }),
      },
    ),
  ),
);

/**
 * 当前环境里已定义的变量名。
 *
 * 返回稳定引用（useMemo）：CodeMirror 的变量高亮插件靠比较引用判断是否需要
 * 重算全部装饰，每次渲染都换新 Set 会导致整篇文档反复重绘。
 */
export function useKnownVariables(): ReadonlySet<string> {
  const environments = useWorkspace((s) => s.environments);
  const active = useWorkspace((s) => s.activeEnvironment);

  return useMemo(() => {
    const env = environments.find((e) => e.name === active);
    return new Set((env?.variables ?? []).filter((v) => v.enabled !== false).map((v) => v.name));
  }, [environments, active]);
}

/** 当前工作区的所有请求节点，按树的深度优先顺序展开 */
export function flattenRequests(nodes: TreeNode[]): Extract<TreeNode, { kind: "request" }>[] {
  return nodes.flatMap((node) => {
    if (node.kind === "request") return [node];
    if (node.kind === "folder") return flattenRequests(node.children);
    return [];
  });
}
