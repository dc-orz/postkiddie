//! 请求历史的读取与清空。
//!
//! 写入不在这里——它是 `request_send` 的副产物，不该由前端另行调用一次，
//! 否则「发过但没记上」这种不一致就成了可能。

use tauri::State;

use crate::{AppState, error::Result, storage::history::HistoryEntry};

/// 按时间倒序返回历史，最新的在前。
///
/// 排序放在后端：文件里是追加顺序（旧的在前），而 UI 想要的永远是最近的几条，
/// 让每个调用方各自 reverse 一遍只会多出走样的机会。
#[tauri::command]
#[specta::specta]
pub async fn history_list(
    state: State<'_, AppState>,
    limit: Option<u32>,
) -> Result<Vec<HistoryEntry>> {
    let ws = state.workspace()?;
    let mut entries = ws.read_history()?;
    entries.reverse();

    if let Some(limit) = limit {
        entries.truncate(limit as usize);
    }
    Ok(entries)
}

#[tauri::command]
#[specta::specta]
pub async fn history_clear(state: State<'_, AppState>) -> Result<()> {
    let ws = state.workspace()?;
    ws.clear_history()?;
    tracing::info!("已清空请求历史");
    Ok(())
}
