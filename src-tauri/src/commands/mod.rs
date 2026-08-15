//! Tauri 命令层：前端与 Rust 之间唯一的通信面。
//!
//! 这一层只做三件事：解构参数、调用下层、把错误转成可序列化形式。
//! 业务规则一律下沉到 `domain` / `storage` / `http` / `git`，
//! 以便它们能脱离 Tauri 运行时被单元测试直接覆盖。
//!
//! 命名约定：`<领域>_<动作>`，与前端 `src/lib/ipc.ts` 中的封装一一对应。

pub mod cookie;
pub mod environment;
pub mod git;
pub mod request;
pub mod workspace;
