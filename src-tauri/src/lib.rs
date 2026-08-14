//! PostKiddie —— 基于本地 Git 目录管理与共享 HTTP 请求的桌面客户端。
//!
//! 分层（依赖自上而下，禁止反向引用）：
//!
//! ```text
//!   commands/   Tauri IPC 边界：解参数、转错误，不含业务规则
//!       ↓
//!   http/  git/  storage/     副作用层：网络、子进程、文件系统
//!       ↓
//!   domain/     纯数据与规则，可脱离 Tauri 单元测试
//! ```

pub mod commands;
pub mod domain;
pub mod error;
pub mod git;
pub mod http;
pub mod storage;

use std::sync::{Arc, RwLock};

use crate::{
    error::{Error, Result},
    git::{GitBackend, cli::GitCli},
    http::ClientPool,
    storage::Workspace,
};

/// 全局应用状态，由 Tauri 以 `State<AppState>` 注入各命令。
pub struct AppState {
    /// 当前打开的工作区。同一时刻只有一个——多工作区对应多开窗口，
    /// 这样每个窗口的 git 分支上下文彼此独立，不会互相干扰。
    workspace: RwLock<Option<Workspace>>,

    /// git 实现。以 trait object 持有，便于将来替换为 gitoxide 或在测试中替身。
    pub git: Arc<dyn GitBackend>,

    /// 复用连接池的 HTTP 客户端集合
    pub http: ClientPool,
}

impl AppState {
    fn new() -> Self {
        Self {
            workspace: RwLock::new(None),
            git: Arc::new(GitCli::new()),
            http: ClientPool::new(),
        }
    }

    /// 取当前工作区的快照。
    ///
    /// 返回克隆而非引用，是为了让调用方拿到值后锁立刻释放——
    /// 命令大多是 async，持锁跨越 `.await` 会造成难以排查的阻塞。
    /// `Workspace` 只含一个 PathBuf 和配置结构，克隆成本可忽略。
    pub fn workspace(&self) -> Result<Workspace> {
        self.workspace
            .read()
            .map_err(|_| Error::Invalid("工作区状态锁已损坏".to_owned()))?
            .clone()
            .ok_or(Error::NoWorkspace)
    }

    pub fn set_workspace(&self, workspace: Workspace) -> Result<()> {
        *self
            .workspace
            .write()
            .map_err(|_| Error::Invalid("工作区状态锁已损坏".to_owned()))? = Some(workspace);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::workspace::workspace_open,
            commands::workspace::workspace_init,
            commands::workspace::workspace_tree,
            commands::workspace::workspace_environments,
            commands::request::request_read,
            commands::request::request_save,
            commands::request::request_delete,
            commands::request::request_send,
            commands::request::request_check_variables,
            commands::git::git_status,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_discard,
            commands::git::git_commit,
            commands::git::git_diff,
            commands::git::git_log,
            commands::git::git_branches,
            commands::git::git_checkout,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::git_show_file,
        ])
        .run(tauri::generate_context!())
        .expect("PostKiddie 启动失败");
}

fn init_tracing() {
    use tracing_subscriber::{EnvFilter, fmt};

    // 默认只放行本 crate 的 info 及以上；调试时用 RUST_LOG=postkiddie_lib=debug 覆盖
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("postkiddie_lib=info,warn"));

    fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_ansi(cfg!(debug_assertions))
        .init();
}
