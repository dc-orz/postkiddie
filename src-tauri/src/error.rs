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
    Timeout(u64),

    #[error("{0}")]
    Invalid(String),
}

impl Error {
    /// 稳定的机器可读标识，前端据此分支。新增变体时必须同步维护。
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Io(_) => "io",
            Self::Yaml(_) => "yaml",
            Self::Json(_) => "json",
            Self::Http(_) => "http",
            Self::Url(_) => "url",
            Self::Git { .. } => "git",
            Self::NotAGitRepo(_) => "not-a-git-repo",
            Self::NoWorkspace => "no-workspace",
            Self::PathEscape(_) => "path-escape",
            Self::RequestNotFound(_) => "request-not-found",
            Self::UnresolvedVariable(_) => "unresolved-variable",
            Self::Timeout(_) => "timeout",
            Self::Invalid(_) => "invalid",
        }
    }
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    kind: &'a str,
    message: String,
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        ErrorPayload {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
