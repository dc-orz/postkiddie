//! 统一错误类型。
//!
//! 约定：
//! - 内部各层一律返回 [`Result<T>`]，用 `?` 向上传播，不在中间层 `unwrap`。
//! - 跨 IPC 边界时 [`Error`] 会序列化成 `{ kind, message }`，前端按 `kind` 做分支
//!   （如 `unresolved-variable` 弹变量面板、`no-workspace` 引导选目录），
//!   `message` 只用于展示，不参与逻辑判断。

use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("文件读写失败：{0}")]
    Io(#[from] std::io::Error),

    #[error("YAML 解析失败：{0}")]
    Yaml(#[from] serde_norway::Error),

    #[error("JSON 解析失败：{0}")]
    Json(#[from] serde_json::Error),

    #[error("请求发送失败：{0}")]
    Http(#[from] reqwest::Error),

    #[error("URL 格式无效：{0}")]
    Url(#[from] url::ParseError),

    /// git 子进程返回非 0，携带 stderr 原文——git 的报错本身就足够清楚，不要二次包装
    #[error("git {command} 执行失败：{stderr}")]
    Git { command: String, stderr: String },

    #[error("当前目录不是 git 仓库：{0}")]
    NotAGitRepo(String),

    #[error("尚未打开工作区")]
    NoWorkspace,

    /// 拒绝任何逃逸出工作区根的路径，防止恶意集合文件读写任意位置
    #[error("路径越出工作区范围：{0}")]
    PathEscape(String),

    #[error("找不到请求：{0}")]
    RequestNotFound(String),

    #[error("变量未定义：{{{{{0}}}}}")]
    UnresolvedVariable(String),

    #[error("请求超时（{0} ms）")]
    Timeout(u32),

    #[error("{0}")]
    Invalid(String),
}

/// 稳定的机器可读标识，前端据此分支。
///
/// 做成 enum 而非 `&'static str`：match 的穷尽性检查会强制新增变体时补上映射，
/// 而字符串版只能靠注释叮嘱「记得同步维护」。它同时决定了导出的 TS 类型——
/// enum 生成字面量联合，前端写错分支名会编译不过；字符串只会生成 `string`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorKind {
    Io,
    Yaml,
    Json,
    Http,
    Url,
    Git,
    NotAGitRepo,
    NoWorkspace,
    PathEscape,
    RequestNotFound,
    UnresolvedVariable,
    Timeout,
    Invalid,
}

impl Error {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Io(_) => ErrorKind::Io,
            Self::Yaml(_) => ErrorKind::Yaml,
            Self::Json(_) => ErrorKind::Json,
            Self::Http(_) => ErrorKind::Http,
            Self::Url(_) => ErrorKind::Url,
            Self::Git { .. } => ErrorKind::Git,
            Self::NotAGitRepo(_) => ErrorKind::NotAGitRepo,
            Self::NoWorkspace => ErrorKind::NoWorkspace,
            Self::PathEscape(_) => ErrorKind::PathEscape,
            Self::RequestNotFound(_) => ErrorKind::RequestNotFound,
            Self::UnresolvedVariable(_) => ErrorKind::UnresolvedVariable,
            Self::Timeout(_) => ErrorKind::Timeout,
            Self::Invalid(_) => ErrorKind::Invalid,
        }
    }
}

/// 跨 IPC 边界时 [`Error`] 实际呈现的形状
#[derive(Serialize, specta::Type)]
pub struct IpcError {
    pub kind: ErrorKind,
    pub message: String,
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        IpcError {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

/// `Error` 手写了 `Serialize`，没法 derive `Type`，这里把它委托给真正上线的形状。
/// 漏掉这层，导出的错误类型就会和实际传输的 JSON 对不上。
impl specta::Type for Error {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        IpcError::definition(types)
    }
}
