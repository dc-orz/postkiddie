//! 文件相关的杂项命令。
//!
//! 路径一律由前端经系统对话框取得——WebView 拿不到真实路径，也不该让它拼；
//! 这里只负责写盘与路径换算。

use std::path::PathBuf;

use base64::Engine as _;
use tauri::State;

use crate::{
    AppState,
    error::{Error, Result},
    storage::paths::to_relative_slash,
};

/// 把 base64 内容写入指定路径。
///
/// 不校验路径是否在工作区内，这点与其他命令不同：另存为的目标本来就是
/// 工作区之外（下载目录、桌面……），而路径又只可能来自系统保存对话框，
/// 用户已经在那里亲自选定了位置。
#[tauri::command]
#[specta::specta]
pub async fn file_save_base64(path: String, base64: String) -> Result<()> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64)
        .map_err(|e| Error::Invalid(format!("响应内容不是合法的 base64：{e}")))?;

    tokio::fs::write(&path, bytes).await?;
    Ok(())
}

/// 把系统文件选择器给出的绝对路径，换算成相对工作区根的路径。
///
/// 请求文件里存相对路径，是因为集合要跟着仓库走：同一份请求在同事的机器上、
/// 在 CI 里都得能用，而 `/Users/某人/...` 只在一台机器上成立。
/// 代价是被引用的文件必须待在工作区内——这也正是下面那条错误消息要讲清楚的事。
#[tauri::command]
#[specta::specta]
pub async fn file_workspace_relative(state: State<'_, AppState>, path: String) -> Result<String> {
    let ws = state.workspace()?;

    // 两边都先规范化再比。macOS 的 /tmp 是指向 /private/tmp 的软链，用户也可能
    // 通过自建软链进入工作区；不规范化就会把「明明在工作区里的文件」判成越界。
    // canonicalize 失败（文件刚被删、权限不足）时退回原值，让后面的比较照常进行。
    let root = ws.root.canonicalize().unwrap_or_else(|_| ws.root.clone());
    let target = PathBuf::from(&path);
    let target = target.canonicalize().unwrap_or(target);

    to_relative_slash(&root, &target).map_err(|_| {
        Error::Invalid(format!(
            "文件需要放在工作区目录内，请先把它复制到 {} 下再选择。\n当前选择的是：{path}",
            ws.root.display()
        ))
    })
}
