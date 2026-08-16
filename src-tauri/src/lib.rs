//! PostKiddie —— 基于本地 Git 目录管理与共享 HTTP 请求的桌面客户端。
//!
//! 分层（依赖自上而下，禁止反向引用）：
//!
//! ```text
//!   commands/   Tauri IPC 边界：解参数、转错误，不含业务规则
//!       ↓
//!   http/  git/  storage/  terminal/    副作用层：网络、子进程、文件系统
//!       ↓
//!   domain/     纯数据与规则，可脱离 Tauri 单元测试
//! ```

pub mod commands;
pub mod domain;
pub mod error;
pub mod git;
pub mod http;
pub mod storage;
pub mod terminal;

use std::sync::{Arc, RwLock};

use tauri::Manager as _;

use crate::{
    error::{Error, Result},
    git::{GitBackend, cli::GitCli},
    http::ClientPool,
    storage::Workspace,
    terminal::TerminalManager,
};

/// 全局应用状态，由 Tauri 以 `State<AppState>` 注入各命令。
pub struct AppState {
    /// 当前打开的工作区。同一时刻只有一个，但可以随时换（见 [`AppState::set_workspace`]）。
    ///
    /// 不做「同窗口内多工作区并存」：git 分支、环境变量、cookie 都是**每个工作区一份**的
    /// 上下文，并存就意味着每条命令都要额外带一个工作区参数，且用户随时可能在
    /// A 的分支上下文里对着 B 的请求点发送。要真正同时开两个，多开一个窗口即可。
    workspace: RwLock<Option<Workspace>>,

    /// git 实现。以 trait object 持有，便于将来替换为 gitoxide 或在测试中替身。
    pub git: Arc<dyn GitBackend>,

    /// 复用连接池的 HTTP 客户端集合
    pub http: ClientPool,

    /// 内置终端的 PTY 会话
    pub terminal: TerminalManager,
}

impl AppState {
    fn new() -> Self {
        Self {
            workspace: RwLock::new(None),
            git: Arc::new(GitCli::new()),
            http: ClientPool::new(),
            terminal: TerminalManager::new(),
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
        // 先收掉旧工作区的终端。那些 shell 的工作目录还指向上一个仓库，
        // 留着就等于给用户递一个「看着是新工作区、敲下去作用在旧仓库」的陷阱。
        // 放在这里而不是靠前端调一次关闭命令：换工作区的唯一入口就是这个函数，
        // 内聚在此才不会有哪条路径漏掉。
        self.terminal.close_all()?;

        *self
            .workspace
            .write()
            .map_err(|_| Error::Invalid("工作区状态锁已损坏".to_owned()))? = Some(workspace);
        Ok(())
    }
}

/// IPC 命令表与事件表。
///
/// 单独抽出来是因为它有两个消费者：运行时的 `invoke_handler`，
/// 以及构建期导出 TypeScript 绑定的那一步。两处必须是同一份清单——
/// 分开写就等于把「命令注册」也变成一处双写，正是引入 specta 要消灭的东西。
/// 事件同理：漏登记的事件在运行时能发出去，但前端拿不到类型化的监听器。
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .events(tauri_specta::collect_events![
            commands::terminal::TerminalOutput,
            commands::terminal::TerminalExit,
        ])
        .commands(tauri_specta::collect_commands![
            commands::workspace::workspace_open,
            commands::workspace::workspace_init,
            commands::workspace::workspace_tree,
            commands::workspace::workspace_environments,
            commands::request::request_read,
            commands::request::request_save,
            commands::request::request_create,
            commands::request::request_delete,
            commands::request::request_rename,
            commands::request::request_move,
            commands::request::folder_create,
            commands::request::folder_reorder,
            commands::request::request_send,
            commands::request::request_check_variables,
            commands::cookie::cookie_list,
            commands::cookie::cookie_delete,
            commands::cookie::cookie_clear_domain,
            commands::cookie::cookie_import,
            commands::cookie::cookie_login_open,
            commands::cookie::cookie_capture,
            commands::environment::environment_save,
            commands::environment::environment_create,
            commands::environment::environment_delete,
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
            commands::postman::postman_import,
            commands::history::history_list,
            commands::history::history_clear,
            commands::file::file_save_base64,
            commands::terminal::terminal_open,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    let builder = specta_builder();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(builder.invoke_handler())
        // 事件必须挂载，否则 emit 时会 panic「EventRegistry not found」。
        // 这一步和 invoke_handler 是一对，加了事件就必须补上。
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("PostKiddie 启动失败")
        .run(|app, event| {
            // 退出前显式收掉终端。
            //
            // 不这么做通常也不会漏进程：进程退出时内核关掉 PTY 主端，从端的 shell
            // 收到 SIGHUP 就自己退了。但那条链子上每一环都不由我们掌握——
            // shell 可能 `disown` 过子进程，也可能配置了忽略 SIGHUP。
            // 显式 kill 一次的成本是几行代码，赌错的成本是用户机器上留一堆孤儿进程。
            if matches!(event, tauri::RunEvent::Exit)
                && let Some(state) = app.try_state::<AppState>()
                && let Err(e) = state.terminal.close_all()
            {
                tracing::warn!(error = %e, "退出时关闭终端会话失败");
            }
        });
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

/// 导出 TypeScript 绑定。
///
/// 做成 `#[test]` 而不是 build.rs：build.rs 里生成会让每次编译都写一遍文件，
/// 打断 cargo 的增量判断；而放在测试里，`cargo test` 与 CI 都会执行到，
/// 绑定过期就表现为工作区出现未提交改动，`git diff --exit-code` 一眼看得出来。
#[cfg(test)]
mod bindings {
    #[test]
    fn export_typescript_bindings() {
        use specta_typescript::Typescript;

        super::specta_builder()
            // 不必显式传 format：tauri-specta 默认就开着 serde phases。
            // 这一点很要紧——`skip_serializing_if` 让同一个结构在序列化与反序列化
            // 两个方向上形状不同，统一模式无法表达，specta 会直接拒绝导出。
            // 分相导出正是我们要的：「Rust 只发偏离默认的字段」必须落到类型里。
            .export(
                Typescript::default().header(
                    "// 此文件由 specta 生成，请勿手工编辑。\n// 改 Rust 侧模型后跑 `cargo test` 重新生成。",
                ),
                "../src/types/bindings.ts",
            )
            .expect("导出 TypeScript 绑定失败");
    }
}
