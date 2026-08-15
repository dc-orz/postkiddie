//! HTTP 执行层：变量插值 + 请求发送。

pub mod executor;
pub mod interpolate;

pub use executor::{ClientPool, ExecuteOutcome, HttpResponse, ResponseBody, execute};
pub use interpolate::VariableScope;
