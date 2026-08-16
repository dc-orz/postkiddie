import { create } from "zustand";

import { IpcCallError, request as ipc } from "@/lib/ipc";
import type { HttpRequest, HttpResponse } from "@/types/api";
import { useWorkspace } from "./workspace";

interface RequestState {
  /** 当前请求相对工作区根的路径，同时也是它的身份 */
  id: string | null;
  /** 编辑中的副本 */
  draft: HttpRequest | null;
  /** 磁盘上的版本，仅用于脏检测 */
  saved: HttpRequest | null;
  loading: boolean;
  loadError: IpcCallError | null;

  response: HttpResponse | null;
  sending: boolean;
  sendError: IpcCallError | null;
  /** 发送前检出的未定义变量 */
  missingVariables: string[];

  select: (id: string) => Promise<void>;
  update: (patch: Partial<HttpRequest>) => void;
  save: () => Promise<void>;
  send: () => Promise<void>;
  revert: () => void;
  close: () => void;
}

/**
 * 判断是否有未保存改动。
 *
 * 用序列化比较而非逐字段 diff：请求结构里有嵌套的 body/auth 联合类型，
 * 手写深比较容易漏字段，而这个对象最多几十个键，序列化的开销可以忽略。
 * 注意它依赖键序稳定——draft 始终由 saved 浅拷贝派生，故成立。
 */
function isDirty(draft: HttpRequest | null, saved: HttpRequest | null): boolean {
  if (!draft || !saved) return false;
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

function toIpcError(error: unknown): IpcCallError {
  return error instanceof IpcCallError ? error : new IpcCallError("invalid", String(error));
}

export const useRequest = create<RequestState>()((set, get) => ({
  id: null,
  draft: null,
  saved: null,
  loading: false,
  loadError: null,
  response: null,
  sending: false,
  sendError: null,
  missingVariables: [],

  select: async (id) => {
    if (get().id === id) return;

    set({
      id,
      loading: true,
      loadError: null,
      // 切换请求时清掉上一个的响应，否则会让人误以为是新请求的结果
      response: null,
      sendError: null,
      missingVariables: [],
    });

    try {
      const loaded = await ipc.read(id);
      // 期间用户可能已经点了别的请求，迟到的结果不能覆盖
      if (get().id !== id) return;
      set({ draft: loaded, saved: loaded, loading: false });
    } catch (error) {
      if (get().id !== id) return;
      set({ loading: false, loadError: toIpcError(error), draft: null, saved: null });
    }
  },

  update: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : s)),

  save: async () => {
    const { id, draft } = get();
    if (!id || !draft) return;

    await ipc.save(id, draft);
    set({ saved: draft });
    // 名称或方法可能变了，树上的展示需要跟着更新
    await useWorkspace.getState().refresh();
  },

  send: async () => {
    const { draft, id } = get();
    if (!draft) return;

    const environment = useWorkspace.getState().activeEnvironment ?? undefined;
    set({ sending: true, sendError: null, missingVariables: [] });

    try {
      const response = await ipc.send(draft, environment, id);
      set({ response, sending: false });
    } catch (error) {
      const ipcError = toIpcError(error);
      // 变量没定义时额外查出**所有**缺失项，一次性告诉用户，
      // 而不是让他修一个、发一次、再发现下一个
      const missingVariables =
        ipcError.kind === "unresolved-variable"
          ? await ipc.checkVariables(draft, environment).catch(() => [])
          : [];
      set({ sending: false, sendError: ipcError, missingVariables });
    }
  },

  revert: () => set((s) => ({ draft: s.saved })),

  close: () =>
    set({
      id: null,
      draft: null,
      saved: null,
      response: null,
      loadError: null,
      sendError: null,
      missingVariables: [],
    }),
}));

/** 当前请求是否有未保存改动 */
export function useIsDirty(): boolean {
  return useRequest((s) => isDirty(s.draft, s.saved));
}

/**
 * 同上，但不是 hook。
 *
 * 供组件之外的编排逻辑使用——比如切换工作区前要先问一句「改动还没保存，确定要走？」，
 * 那段代码跑在事件处理里，用不了 hook。
 */
export function hasUnsavedChanges(): boolean {
  const { draft, saved } = useRequest.getState();
  return isDirty(draft, saved);
}
