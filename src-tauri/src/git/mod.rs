//! Git 集成层。
//!
//! 一期通过调用**系统 git CLI** 实现（见 [`cli::GitCli`]）。这个选择是有意的：
//! 目标用户是后端工程师，机器上必然已配好 SSH key、credential helper、GPG 签名、
//! 企业代理和 `insteadOf` 重写规则。复用这些配置意味着「推送认证」——
//! 这个自研 git 客户端最容易翻车的环节——直接消失。
//!
//! 代价是要解析命令行输出。为把它限制在一处，所有 git 访问都收敛到 [`GitBackend`]
//! 这个 trait 后面；将来若要换 gitoxide 或 libgit2，只需新增一个实现。
//!
//! trait 方法是**同步**的：git 子进程调用本身就是阻塞 IO，
//! 由调用方用 `tokio::task::spawn_blocking` 移出异步运行时即可，
//! 这比让 trait 变成 async（从而失去 dyn 兼容性）划算。

pub mod cli;

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;

/// 工作区相对某次提交的文件状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum FileState {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Ignored,
    /// 合并冲突。UI 必须把它与普通修改区分开——用户需要先解决冲突才能提交。
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    /// 相对仓库根的路径，始终使用 `/` 分隔符
    pub path: String,
    /// 重命名/复制时的原路径
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    pub state: FileState,
    /// 变更是否已进入暂存区
    pub staged: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// 分离 HEAD 时为 None
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<StatusEntry>,
    /// 存在冲突文件，UI 应禁用提交按钮
    pub has_conflicts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    pub author_email: String,
    /// RFC 3339 时间戳
    pub timestamp: String,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
}

/// 所有 git 能力的抽象边界。实现必须保证：
/// - 绝不触发交互式提示（凭证、编辑器、pager），GUI 进程没有 tty，一旦提示就是永久挂起
/// - 路径一律用 `/` 分隔并相对仓库根，便于跨平台与前端直接比对
pub trait GitBackend: Send + Sync {
    /// 校验路径是一个 git 工作树，返回仓库根的绝对路径
    fn discover_repo(&self, path: &Path) -> Result<std::path::PathBuf>;

    /// 在指定目录初始化 git 仓库。
    ///
    /// 仅在新建工作区且该目录尚不在任何仓库内时调用，且必须由 UI 明确告知用户后再执行——
    /// 在别人的目录里凭空创建 .git 是有副作用的操作，不能悄悄做。
    fn init(&self, path: &Path) -> Result<()>;

    fn status(&self, repo: &Path) -> Result<GitStatus>;

    /// `git mv`：让 git 把它记成一次重命名，而不是「删一个、加一个」。
    /// 文件未被跟踪时会失败，调用方应退回普通文件移动。
    fn move_path(&self, repo: &Path, from: &str, to: &str) -> Result<()>;

    fn stage(&self, repo: &Path, paths: &[String]) -> Result<()>;

    fn unstage(&self, repo: &Path, paths: &[String]) -> Result<()>;

    /// 丢弃工作区改动，恢复到 HEAD。破坏性操作，UI 必须二次确认。
    fn discard(&self, repo: &Path, paths: &[String]) -> Result<()>;

    /// 返回新提交的完整 hash
    fn commit(&self, repo: &Path, message: &str) -> Result<String>;

    /// `path` 为 None 时返回全仓库 diff。`staged` 决定看暂存区还是工作区。
    fn diff(&self, repo: &Path, path: Option<&str>, staged: bool) -> Result<String>;

    fn log(&self, repo: &Path, limit: usize) -> Result<Vec<CommitInfo>>;

    fn branches(&self, repo: &Path) -> Result<Vec<BranchInfo>>;

    fn checkout(&self, repo: &Path, branch: &str, create: bool) -> Result<()>;

    /// 只更新远程引用，不改工作区。用于后台轮询「有无新提交」。
    fn fetch(&self, repo: &Path) -> Result<()>;

    fn pull(&self, repo: &Path, rebase: bool) -> Result<()>;

    fn push(&self, repo: &Path, set_upstream: bool) -> Result<()>;

    /// 读取任意提交下某个文件的内容，用于「与某版本对比」和历史回看
    fn show_file(&self, repo: &Path, rev: &str, path: &str) -> Result<String>;
}
