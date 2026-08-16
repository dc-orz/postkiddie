//! 领域核心：与框架、IO、UI 均无关的纯数据与规则。
//!
//! 这一层不允许 `use tauri::*` 或 `use reqwest::*`——保持它可被单元测试直接覆盖。

pub mod cookie;
pub mod model;
pub mod postman;
