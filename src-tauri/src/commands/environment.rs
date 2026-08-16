//! 环境的读写。
//!
//! 这一层的全部要点在于**密钥的分离与合并**：
//!
//! - 落盘时：`secret: true` 的变量，其值抽出来写进本机的 `.postkiddie/secrets.yaml`，
//!   git 跟踪的环境文件里只留一个空值占位。团队共享的是「有哪些密钥要填」的契约。
//! - 读取时（`workspace_environments`）：把本机的值合并回去，UI 才能显示和编辑真实值。
//!
//! 这个不对称是有意的：让 UI 始终面对一个「完整」的环境对象，
//! 而分离逻辑只存在于 `storage::Workspace::save_environment` 一处。

use tauri::State;

use crate::{
    AppState,
    domain::model::Environment,
    error::{Error, Result},
};

/// 保存环境。密钥值会被抽走存到本机，不会进入 git。
#[tauri::command]
#[specta::specta]
pub async fn environment_save(
    state: State<'_, AppState>,
    name: String,
    environment: Environment,
) -> Result<()> {
    state.workspace()?.save_environment(&name, environment)?;
    tracing::info!(name = %name, "已保存环境");
    Ok(())
}

/// 新建空环境。重名直接报错而不是静默覆盖——已有环境里可能存着填好的密钥。
#[tauri::command]
#[specta::specta]
pub async fn environment_create(state: State<'_, AppState>, name: String) -> Result<Environment> {
    let ws = state.workspace()?;

    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::Invalid("环境名不能为空".to_owned()));
    }
    if ws.environment_path(trimmed).exists() {
        return Err(Error::Invalid(format!("环境「{trimmed}」已存在")));
    }

    let environment = Environment {
        name: trimmed.to_owned(),
        variables: Vec::new(),
    };
    ws.write_environment_raw(trimmed, &environment)?;

    tracing::info!(name = %trimmed, "已新建环境");
    Ok(environment)
}

#[tauri::command]
#[specta::specta]
pub async fn environment_delete(state: State<'_, AppState>, name: String) -> Result<()> {
    state.workspace()?.delete_environment(&name)?;
    tracing::info!(name = %name, "已删除环境");
    Ok(())
}
