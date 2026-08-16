/**
 * Tauri IPC 封装。
 *
 * 命令签名与类型全部由 specta 从 Rust 生成（`types/bindings.ts`），
 * 这一层只负责把生成的 Result 形态转成前端惯用的「成功返回值 / 失败抛异常」，
 * 并保留 `IpcCallError` 以便按 `kind` 分支。
 *
 * 为什么不让组件直接用 `commands`：生成的接口返回
 * `{ status: "ok" } | { status: "error" }`，每个调用点都要展开一次；
 * 而错误在这里几乎总是要么向上抛、要么弹窗，判别式联合只是噪声。
 */

import type { Environment, ErrorKind, HttpMethod, HttpRequest, IpcError } from "@/types/api";
import { commands } from "@/types/bindings";

/**
 * IPC 调用失败时抛出的错误。
 *
 * 保留 `kind` 供调用方分支处理（如 `no-workspace` 引导用户选目录），
 * 避免靠匹配 message 文本做逻辑判断——那会在改文案时静默失效。
 * `kind` 的取值由 Rust 的 `ErrorKind` 枚举生成，写错分支名编译不过。
 */
export class IpcCallError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "IpcCallError";
    this.kind = kind;
  }
}

type IpcResult<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

/** 把生成的 Result 摊平：成功取值，失败抛 `IpcCallError` */
async function unwrap<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call;
  if (result.status === "error") {
    throw new IpcCallError(result.error.kind, result.error.message);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// 工作区
// ---------------------------------------------------------------------------

export const workspace = {
  open: (path: string) => unwrap(commands.workspaceOpen(path)),
  init: (path: string, name: string) => unwrap(commands.workspaceInit(path, name)),
  tree: () => unwrap(commands.workspaceTree()),
  environments: () => unwrap(commands.workspaceEnvironments()),
};

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

export const request = {
  read: (id: string) => unwrap(commands.requestRead(id)),
  save: (id: string, req: HttpRequest) => unwrapVoid(commands.requestSave(id, req)),
  /** 返回新请求的 id。路径拼装与重名消歧都在 Rust 侧完成。 */
  create: (parent: string | null, name: string, method?: HttpMethod) =>
    unwrap(commands.requestCreate(parent, name, method ?? null)),
  /** 同时改文件名与 YAML 里的 name，返回新的 id */
  rename: (id: string, name: string) => unwrap(commands.requestRename(id, name)),
  /**
   * 移动到目标目录的指定位置，返回新的 id。
   * index 为 null 表示追加到末尾；targetParent 为 null 表示集合根。
   */
  move: (id: string, targetParent: string | null, index: number | null) =>
    unwrap(commands.requestMove(id, targetParent, index)),
  remove: (id: string) => unwrapVoid(commands.requestDelete(id)),
  send: (req: HttpRequest, environment?: string) =>
    unwrap(commands.requestSend(req, environment ?? null)),
  checkVariables: (req: HttpRequest, environment?: string) =>
    unwrap(commands.requestCheckVariables(req, environment ?? null)),
};

export const folder = {
  /** 返回新文件夹的 id */
  create: (parent: string | null, name: string) => unwrap(commands.folderCreate(parent, name)),
  /** 重排某目录下的显示顺序；order 是文件名（含扩展名）数组 */
  reorder: (folderId: string | null, order: string[]) =>
    unwrapVoid(commands.folderReorder(folderId, order)),
};

// ---------------------------------------------------------------------------
// 环境
// ---------------------------------------------------------------------------

export const environment = {
  /**
   * 保存环境。传入的对象里可以带 secret 变量的真实值——
   * Rust 侧会把它们抽到本机密钥库，不会写进 git 跟踪的文件。
   */
  save: (name: string, env: Environment) => unwrapVoid(commands.environmentSave(name, env)),
  create: (name: string) => unwrap(commands.environmentCreate(name)),
  remove: (name: string) => unwrapVoid(commands.environmentDelete(name)),
};

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

export const cookie = {
  list: () => unwrap(commands.cookieList()),
  remove: (name: string, domain: string, path: string) =>
    unwrapVoid(commands.cookieDelete(name, domain, path)),
  /** 清掉某个域及其子域的全部 cookie，相当于退出登录 */
  clearDomain: (domain: string) => unwrapVoid(commands.cookieClearDomain(domain)),
  /** raw 可以是 Cookie 头的值，也可以是整条 curl 命令。返回导入条数。 */
  import: (url: string, raw: string) => unwrap(commands.cookieImport(url, raw)),
  /** 打开内置登录窗口 */
  loginOpen: (url: string) => unwrapVoid(commands.cookieLoginOpen(url)),
  /** 从登录窗口收取 cookie，返回条数 */
  capture: (url: string, closeWindow = true) => unwrap(commands.cookieCapture(url, closeWindow)),
};

// ---------------------------------------------------------------------------
// 文件
// ---------------------------------------------------------------------------

export const file = {
  /** 把 base64 内容写到指定路径。路径应来自系统保存对话框。 */
  saveBase64: (path: string, base64: string) => unwrapVoid(commands.fileSaveBase64(path, base64)),
};

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/** Rust 的 `()` 会生成为 `null`；无返回值的命令摊平成 void，免得调用方到处接一个没用的 null */
async function unwrapVoid(call: Promise<IpcResult<null>>): Promise<void> {
  await unwrap(call);
}

export const git = {
  status: () => unwrap(commands.gitStatus()),
  stage: (paths: string[]) => unwrapVoid(commands.gitStage(paths)),
  unstage: (paths: string[]) => unwrapVoid(commands.gitUnstage(paths)),
  discard: (paths: string[]) => unwrapVoid(commands.gitDiscard(paths)),
  commit: (message: string) => unwrap(commands.gitCommit(message)),
  diff: (path: string | null, staged: boolean) => unwrap(commands.gitDiff(path, staged)),
  log: (limit?: number) => unwrap(commands.gitLog(limit ?? null)),
  branches: () => unwrap(commands.gitBranches()),
  checkout: (branch: string, create = false) => unwrapVoid(commands.gitCheckout(branch, create)),
  fetch: () => unwrapVoid(commands.gitFetch()),
  pull: (rebase = true) => unwrapVoid(commands.gitPull(rebase)),
  push: (setUpstream = false) => unwrapVoid(commands.gitPush(setUpstream)),
  showFile: (rev: string, path: string) => unwrap(commands.gitShowFile(rev, path)),
};
