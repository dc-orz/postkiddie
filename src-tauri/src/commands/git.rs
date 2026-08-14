//! Git 命令。
//!
//! 所有 git 调用都是阻塞的子进程操作，统一用 `spawn_blocking` 移出 tokio 的
//! 异步工作线程——否则一次网络较慢的 `push` 会占住 runtime 线程，
//! 让整个界面失去响应。这正是我们要避免的那种「卡」。

use tauri::State;

use crate::{
    AppState,
    error::{Error, Result},
    git::{BranchInfo, CommitInfo, GitStatus},
};

/// 把阻塞的 git 调用包进 blocking 线程池。
macro_rules! blocking {
    ($state:expr, |$git:ident, $root:ident| $body:expr) => {{
        let ws = $state.workspace()?;
        let $git = $state.git.clone();
        let $root = ws.root.clone();

        tokio::task::spawn_blocking(move || $body)
            .await
            .map_err(|e| Error::Invalid(format!("git 任务执行失败：{e}")))?
    }};
}

#[tauri::command]
pub async fn git_status(state: State<'_, AppState>) -> Result<GitStatus> {
    blocking!(state, |git, root| git.status(&root))
}

#[tauri::command]
pub async fn git_stage(state: State<'_, AppState>, paths: Vec<String>) -> Result<()> {
    blocking!(state, |git, root| git.stage(&root, &paths))
}

#[tauri::command]
pub async fn git_unstage(state: State<'_, AppState>, paths: Vec<String>) -> Result<()> {
    blocking!(state, |git, root| git.unstage(&root, &paths))
}

/// 丢弃改动。破坏性且不可撤销，前端必须先弹确认框。
#[tauri::command]
pub async fn git_discard(state: State<'_, AppState>, paths: Vec<String>) -> Result<()> {
    blocking!(state, |git, root| git.discard(&root, &paths))
}

#[tauri::command]
pub async fn git_commit(state: State<'_, AppState>, message: String) -> Result<String> {
    if message.trim().is_empty() {
        return Err(Error::Invalid("提交信息不能为空".to_owned()));
    }
    blocking!(state, |git, root| git.commit(&root, &message))
}

#[tauri::command]
pub async fn git_diff(
    state: State<'_, AppState>,
    path: Option<String>,
    staged: bool,
) -> Result<String> {
    blocking!(state, |git, root| git.diff(&root, path.as_deref(), staged))
}

#[tauri::command]
pub async fn git_log(state: State<'_, AppState>, limit: Option<usize>) -> Result<Vec<CommitInfo>> {
    let limit = limit.unwrap_or(50).min(500);
    blocking!(state, |git, root| git.log(&root, limit))
}

#[tauri::command]
pub async fn git_branches(state: State<'_, AppState>) -> Result<Vec<BranchInfo>> {
    blocking!(state, |git, root| git.branches(&root))
}

#[tauri::command]
pub async fn git_checkout(state: State<'_, AppState>, branch: String, create: bool) -> Result<()> {
    blocking!(state, |git, root| git.checkout(&root, &branch, create))
}

/// 只更新远程引用，不动工作区。供后台定时轮询「远端有无新提交」。
#[tauri::command]
pub async fn git_fetch(state: State<'_, AppState>) -> Result<()> {
    blocking!(state, |git, root| git.fetch(&root))
}

#[tauri::command]
pub async fn git_pull(state: State<'_, AppState>, rebase: bool) -> Result<()> {
    blocking!(state, |git, root| git.pull(&root, rebase))
}

#[tauri::command]
pub async fn git_push(state: State<'_, AppState>, set_upstream: bool) -> Result<()> {
    blocking!(state, |git, root| git.push(&root, set_upstream))
}

/// 读取某个历史版本下的文件内容，用于「与历史版本对比」。
#[tauri::command]
pub async fn git_show_file(
    state: State<'_, AppState>,
    rev: String,
    path: String,
) -> Result<String> {
    blocking!(state, |git, root| git.show_file(&root, &rev, &path))
}
