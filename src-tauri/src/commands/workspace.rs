//! 工作区相关命令。

use std::path::PathBuf;

use tauri::State;

use crate::{
    AppState,
    domain::model::Environment,
    error::{Error, Result},
    storage::{Workspace, tree::TreeNode},
};

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub root: String,
    pub name: String,
    /// git 仓库根。与 `root` 不同时说明工作区位于仓库的子目录中。
    pub repo_root: String,
}

/// 打开一个已存在的工作区目录。
///
/// 要求目录处于 git 仓库内——「用 git 管理」不是可选项，
/// 若允许非 git 目录，后续所有版本化功能都要处处判空，得不偿失。
#[tauri::command]
pub async fn workspace_open(state: State<'_, AppState>, path: String) -> Result<WorkspaceInfo> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(Error::Invalid(format!("目录不存在：{path}")));
    }

    let repo_root = state.git.discover_repo(&root)?;
    let ws = Workspace::open(&root)?;

    let info = WorkspaceInfo {
        root: ws.root.display().to_string(),
        name: ws.config.name.clone(),
        repo_root: repo_root.display().to_string(),
    };

    state.set_workspace(ws)?;
    tracing::info!(path = %info.root, "已打开工作区");
    Ok(info)
}

/// 在指定目录初始化新工作区。
///
/// 目录若尚不在任何 git 仓库内，会就地 `git init`——「用 git 管理」是本应用的前提，
/// 让用户为此切到终端跑一条命令是没必要的摩擦。调用方必须已在 UI 上说明这一点。
#[tauri::command]
pub async fn workspace_init(
    state: State<'_, AppState>,
    path: String,
    name: String,
) -> Result<WorkspaceInfo> {
    let root = PathBuf::from(&path);
    std::fs::create_dir_all(&root)?;

    let repo_root = match state.git.discover_repo(&root) {
        Ok(existing) => existing,
        Err(_) => {
            tracing::info!(path = %root.display(), "目录不在 git 仓库内，就地初始化");
            state.git.init(&root)?;
            state.git.discover_repo(&root)?
        }
    };

    let ws = Workspace::init(&root, &name)?;

    let info = WorkspaceInfo {
        root: ws.root.display().to_string(),
        name: ws.config.name.clone(),
        repo_root: repo_root.display().to_string(),
    };

    state.set_workspace(ws)?;
    tracing::info!(path = %info.root, "已初始化工作区");
    Ok(info)
}

/// 重新扫描集合树。
///
/// 磁盘是唯一事实来源，所以刷新就是重扫，不存在需要维护的内存索引。
/// 外部编辑、`git pull`、分支切换之后前端都调用这个命令。
#[tauri::command]
pub async fn workspace_tree(state: State<'_, AppState>) -> Result<Vec<TreeNode>> {
    state.workspace()?.scan()
}

#[tauri::command]
pub async fn workspace_environments(state: State<'_, AppState>) -> Result<Vec<Environment>> {
    // 返回合并了本机密钥的完整环境，UI 才能显示与编辑 secret 变量的真实值
    state.workspace()?.list_environments_resolved()
}
