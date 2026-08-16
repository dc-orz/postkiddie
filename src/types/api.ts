/**
 * IPC 类型的前端入口。
 *
 * 类型本体由 specta 从 Rust 生成，见 `bindings.ts`（勿手改）。
 * 这里只做两件事：给生成的名字起个顺手的别名，以及补充纯前端的常量。
 *
 * ## 为什么名字带 `_Serialize` / `_Deserialize`
 *
 * 因为 `skip_serializing_if` 让同一个 Rust 结构在两个方向上形状不同：
 * 序列化出去时「保持默认的字段不发」，反序列化进来时「缺字段用默认值」。
 * 一个类型无法同时描述两者，specta 会拒绝把它们合并——这正是好事：
 * 项目里两次静默故障（超时设置被还原、环境弹框黑屏）都源于把两者当成一回事。
 *
 * 前端的视角是反的，别被名字绕进去：
 * - **收到**的东西是 Rust 序列化的产物 → `_Serialize`
 * - **发出**的东西要被 Rust 反序列化 → `_Deserialize`
 *
 * 日常用下面这些无后缀别名即可，它们一律指向 `_Serialize`。
 * 好在 `_Serialize` 的字段只会比 `_Deserialize` 更全（必填 ⊇ 可选），
 * 所以拿它当入参传回去也是类型安全的，无需两套写法。
 */

import type {
  BranchInfo_Serialize,
  CommitInfo,
  Cookie_Serialize,
  CookieGroup_Serialize,
  Environment_Serialize,
  EnvVariable_Serialize,
  GitStatus_Serialize,
  HistoryEntry_Serialize,
  HttpRequest_Serialize,
  HttpResponse_Serialize,
  KeyValue_Serialize,
  MultipartField_Serialize,
  RequestBody_Serialize,
  RequestSettings_Serialize,
  StatusEntry_Serialize,
  TreeNode,
} from "./bindings";

export type {
  ApiKeyPlacement,
  Auth,
  ErrorKind,
  FileState,
  HttpMethod,
  IpcError,
  ResponseBody,
  TreeNode,
  WorkspaceInfo,
} from "./bindings";

export type KeyValue = KeyValue_Serialize;
export type MultipartField = MultipartField_Serialize;
export type RequestBody = RequestBody_Serialize;
export type RequestSettings = RequestSettings_Serialize;
export type HttpRequest = HttpRequest_Serialize;
export type HttpResponse = HttpResponse_Serialize;
export type EnvVariable = EnvVariable_Serialize;
export type Environment = Environment_Serialize;
export type Cookie = Cookie_Serialize;
export type CookieGroup = CookieGroup_Serialize;
export type GitStatus = GitStatus_Serialize;
export type HistoryEntry = HistoryEntry_Serialize;
export type StatusEntry = StatusEntry_Serialize;
export type BranchInfo = BranchInfo_Serialize;
export type { CommitInfo };

/** 集合树里的请求节点。窄化出来供只关心请求的地方使用。 */
export type RequestNode = Extract<TreeNode, { kind: "request" }>;

// ---------------------------------------------------------------------------
// 纯前端常量
// ---------------------------------------------------------------------------

/**
 * 方法选择器的选项顺序。
 *
 * 不从 Rust 生成：`HttpMethod` 是联合类型，取不出运行时的值列表，
 * 而这里的**顺序**是 UI 决定的（按使用频率），不属于领域模型。
 * 类型标注会保证漏写或拼错时编译失败。
 */
export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const satisfies readonly import("./bindings").HttpMethod[];
