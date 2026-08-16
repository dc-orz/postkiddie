//! 文件落盘。
//!
//! 目前只服务于「把二进制响应体另存为」。路径由前端经系统保存对话框取得——
//! WebView 拿不到真实路径，也不该让它拼；这里只负责写。

use base64::Engine as _;

use crate::error::{Error, Result};

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
