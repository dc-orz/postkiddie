//! 内置终端命令。
//!
//! 会话本身由 [`crate::terminal::TerminalManager`] 管理，这一层只做三件事：
//! 生成会话 id、把 PTY 的字节流转成前端事件、把前端的按键转回去。
//!
//! 输出走**事件**而不是命令返回值：PTY 是持续产出的流，没有「一次调用对应一次结果」
//! 的边界，用轮询去接会同时输掉延迟和 CPU。

use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_specta::Event as _;

use crate::{AppState, error::Result, terminal::TerminalSink};

/// 一批终端输出。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub id: String,
    /// base64 编码的原始字节。
    ///
    /// 不传字符串：PTY 里流动的是字节，一批的末尾很可能正卡在某个多字节字符中间，
    /// 强行按 UTF-8 解码会把它变成替换字符（�）且再也拼不回来。
    /// base64 让字节原样抵达前端，由 xterm.js 的解码器跨批次拼接。
    pub data: String,
}

/// 终端子进程已退出。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub id: String,
    pub code: u32,
}

/// 会话 id 的来源。
///
/// 用递增序号而非 uuid：id 只需要在本进程内区分几个会话，
/// 序号足够，而且出现在日志里时比一串十六进制好认得多。
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// 把 PTY 的输出转成 Tauri 事件。
struct EventSink {
    app: AppHandle,
}

impl TerminalSink for EventSink {
    fn output(&self, id: &str, bytes: &[u8]) {
        let event = TerminalOutput {
            id: id.to_owned(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        };
        // 发送失败只可能是窗口已经没了，此时会话马上也会被关掉，记一笔即可
        if let Err(e) = event.emit(&self.app) {
            tracing::warn!(id = %id, error = %e, "推送终端输出失败");
        }
    }

    fn exit(&self, id: &str, code: u32) {
        let event = TerminalExit {
            id: id.to_owned(),
            code,
        };
        if let Err(e) = event.emit(&self.app) {
            tracing::warn!(id = %id, error = %e, "推送终端退出事件失败");
        }
    }
}

/// 在当前工作区根目录起一个终端会话，返回它的 id。
///
/// 工作目录取工作区根而非 git 仓库根：用户在这里敲的多半是针对请求集合的命令，
/// 而 git 在仓库的任何子目录下都能正常工作。
#[tauri::command]
#[specta::specta]
pub async fn terminal_open(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    cols: u16,
    rows: u16,
) -> Result<String> {
    let ws = state.workspace()?;
    let id = format!("term-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));

    state
        .terminal
        .spawn(&id, &ws.root, cols, rows, EventSink { app })?;

    Ok(id)
}

/// 写入用户的按键。
///
/// 这里收字符串而非 base64：来源是 xterm 的 `onData`，它给出的已经是
/// 合法的 UTF-8 文本（普通字符、粘贴内容，或形如 `\x1b[A` 的转义序列）。
#[tauri::command]
#[specta::specta]
pub async fn terminal_write(
    state: tauri::State<'_, AppState>,
    id: String,
    data: String,
) -> Result<()> {
    state.terminal.write(&id, &data)
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_resize(
    state: tauri::State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<()> {
    state.terminal.resize(&id, cols, rows)
}

#[tauri::command]
#[specta::specta]
pub async fn terminal_close(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    state.terminal.close(&id)
}
