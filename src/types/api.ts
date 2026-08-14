/**
 * Rust 侧数据模型的 TypeScript 镜像。
 *
 * ⚠️ 这些类型必须与 `src-tauri/src/domain/model.rs`、`src-tauri/src/git/mod.rs`
 * 手工保持一致。改动任一侧时请同步另一侧，并跑 `pnpm check`。
 *
 * 演进计划：请求种类稳定后引入 `tauri-specta`，从 Rust 自动生成本文件与
 * `ipc.ts` 的调用签名，彻底消除手工同步。一期刻意不引入，是为了让新贡献者
 * 只需读两个文件就能看懂整条数据链路。详见 docs/architecture.md。
 */

// ---------------------------------------------------------------------------
// 基础
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export interface KeyValue {
  name: string;
  value: string;
  /** 缺省视为 true —— Rust 侧只在为 false 时落盘 */
  enabled?: boolean;
  description?: string;
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

export type RequestBody =
  | { type: "none" }
  | { type: "json"; content: string }
  | { type: "text"; content: string; contentType?: string }
  | { type: "xml"; content: string }
  | { type: "form-urlencoded"; fields: KeyValue[] }
  | { type: "multipart"; fields: MultipartField[] }
  | { type: "binary"; file: string; contentType?: string }
  | {
      type: "graphql";
      query: string;
      variables?: string;
      operationName?: string;
    };

export interface MultipartField {
  name: string;
  value?: string;
  file?: string;
  contentType?: string;
  enabled?: boolean;
}

export type Auth =
  | { type: "inherit" }
  | { type: "none" }
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string }
  | {
      type: "api-key";
      key: string;
      value: string;
      placement: "header" | "query";
    };

export interface RequestSettings {
  timeoutMs: number;
  followRedirects: boolean;
  maxRedirects: number;
  verifyTls: boolean;
  decompress: boolean;
}

export interface HttpRequest {
  name: string;
  method: HttpMethod;
  url: string;
  description?: string;
  params?: KeyValue[];
  headers?: KeyValue[];
  body?: RequestBody;
  auth?: Auth;
  settings?: RequestSettings;
}

// ---------------------------------------------------------------------------
// 响应
// ---------------------------------------------------------------------------

export type ResponseBody =
  | { kind: "text"; content: string }
  | { kind: "binary"; base64: string }
  | { kind: "empty" };

export interface HttpResponse {
  status: number;
  statusText: string;
  finalUrl: string;
  headers: KeyValue[];
  body: ResponseBody;
  sizeBytes: number;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// 集合树
// ---------------------------------------------------------------------------

export type TreeNode =
  | { kind: "folder"; id: string; name: string; children: TreeNode[] }
  | {
      kind: "request";
      id: string;
      name: string;
      method: HttpMethod;
      url: string;
    }
  | { kind: "broken"; id: string; name: string; error: string };

// ---------------------------------------------------------------------------
// 环境
// ---------------------------------------------------------------------------

export interface EnvVariable {
  name: string;
  value: string;
  secret?: boolean;
  enabled?: boolean;
  description?: string;
}

export interface Environment {
  name: string;
  variables: EnvVariable[];
}

// ---------------------------------------------------------------------------
// 工作区
// ---------------------------------------------------------------------------

export interface WorkspaceInfo {
  root: string;
  name: string;
  repoRoot: string;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export type FileState =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "conflicted";

export interface StatusEntry {
  path: string;
  originalPath?: string;
  state: FileState;
  staged: boolean;
}

export interface GitStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: StatusEntry[];
  hasConflicts: boolean;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  /** RFC 3339 */
  timestamp: string;
  subject: string;
  body: string;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/** Rust `error::Error` 序列化后的形状 */
export interface IpcError {
  kind: IpcErrorKind;
  message: string;
}

export type IpcErrorKind =
  | "io"
  | "yaml"
  | "json"
  | "http"
  | "url"
  | "git"
  | "not-a-git-repo"
  | "no-workspace"
  | "path-escape"
  | "request-not-found"
  | "unresolved-variable"
  | "timeout"
  | "invalid";
