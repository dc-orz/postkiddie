/**
 * Tauri IPC 封装。
 *
 * 组件不直接调用 `invoke`，一律经过这里，以获得：
 * - 参数与返回值的静态类型
 * - 统一的错误规整（Rust 返回的是 `{ kind, message }`，不是 Error 实例）
 * - 一处可插入日志、重试、耗时统计的切面
 */

import { invoke } from "@tauri-apps/api/core";

import type {
  BranchInfo,
  CommitInfo,
  Environment,
  GitStatus,
  HttpMethod,
  HttpRequest,
  HttpResponse,
  IpcError,
  IpcErrorKind,
  TreeNode,
  WorkspaceInfo,
} from "@/types/api";

/**
 * IPC 调用失败时抛出的错误。
 *
 * 保留 `kind` 供调用方分支处理（如 `no-workspace` 引导用户选目录），
 * 避免靠匹配 message 文本做逻辑判断——那会在改文案时静默失效。
 */
export class IpcCallError extends Error {
  readonly kind: IpcErrorKind;

  constructor(kind: IpcErrorKind, message: string) {
    super(message);
    this.name = "IpcCallError";
    this.kind = kind;
  }
}

function isIpcError(value: unknown): value is IpcError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof (value as IpcError).message === "string"
  );
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (isIpcError(raw)) {
      throw new IpcCallError(raw.kind, raw.message);
    }
    // panic 或序列化失败等非预期情况：保留原文，避免掩盖真实原因
    throw new IpcCallError("invalid", String(raw));
  }
}

// ---------------------------------------------------------------------------
// 工作区
// ---------------------------------------------------------------------------

export const workspace = {
  open: (path: string) => call<WorkspaceInfo>("workspace_open", { path }),
  init: (path: string, name: string) => call<WorkspaceInfo>("workspace_init", { path, name }),
  tree: () => call<TreeNode[]>("workspace_tree"),
  environments: () => call<Environment[]>("workspace_environments"),
};

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

export const request = {
  read: (id: string) => call<HttpRequest>("request_read", { id }),
  save: (id: string, req: HttpRequest) => call<void>("request_save", { id, request: req }),
  /** 返回新请求的 id。路径拼装与重名消歧都在 Rust 侧完成。 */
  create: (parent: string | null, name: string, method?: HttpMethod) =>
    call<string>("request_create", { parent, name, method: method ?? null }),
  remove: (id: string) => call<void>("request_delete", { id }),
  send: (req: HttpRequest, environment?: string) =>
    call<HttpResponse>("request_send", {
      request: req,
      environment: environment ?? null,
    }),
  checkVariables: (req: HttpRequest, environment?: string) =>
    call<string[]>("request_check_variables", {
      request: req,
      environment: environment ?? null,
    }),
};

export const folder = {
  /** 返回新文件夹的 id */
  create: (parent: string | null, name: string) => call<string>("folder_create", { parent, name }),
};

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export const git = {
  status: () => call<GitStatus>("git_status"),
  stage: (paths: string[]) => call<void>("git_stage", { paths }),
  unstage: (paths: string[]) => call<void>("git_unstage", { paths }),
  discard: (paths: string[]) => call<void>("git_discard", { paths }),
  commit: (message: string) => call<string>("git_commit", { message }),
  diff: (path: string | null, staged: boolean) => call<string>("git_diff", { path, staged }),
  log: (limit?: number) => call<CommitInfo[]>("git_log", { limit: limit ?? null }),
  branches: () => call<BranchInfo[]>("git_branches"),
  checkout: (branch: string, create = false) => call<void>("git_checkout", { branch, create }),
  fetch: () => call<void>("git_fetch"),
  pull: (rebase = true) => call<void>("git_pull", { rebase }),
  push: (setUpstream = false) => call<void>("git_push", { setUpstream }),
  showFile: (rev: string, path: string) => call<string>("git_show_file", { rev, path }),
};
