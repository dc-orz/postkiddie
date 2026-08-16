//! 内置终端：真 PTY 会话。
//!
//! ## 为什么是真 PTY，而不是「收一行命令、跑一次 git、把输出回显」
//!
//! 后者看起来更省事，也更符合本应用其余地方「绝不碰交互式提示」的取向
//! （见 [`crate::git::cli`]），但它做不成终端：
//!
//! - `git log`、`git diff` 要分页，`git add -p` 要逐块问，`git rebase -i` 要开编辑器。
//!   没有 tty 时这些要么直接失败，要么永久等待输入——正是要避免的那种「卡死」。
//! - 颜色、进度条、`\r` 回退重画都依赖终端能力探测。管道里的 git 会关掉它们，
//!   于是 `git push` 的进度、`git status` 的配色全部消失。
//! - shell 本身的补全、历史、别名（很多人的 `git` 其实是 `g` 或 `gst`）都需要一个真 shell。
//!
//! 有了 tty，这些统统变回「和你平时在终端里一样」。代价是要自己管进程与字节流，
//! 也就是这个模块。
//!
//! ## 顺带解决的一个老问题
//!
//! macOS 上从 Finder / Dock 启动的 GUI 应用继承的是 launchd 的精简 PATH，
//! 拿不到 Homebrew 路径——[`crate::git::cli`] 为此专门写了一段可执行文件查找。
//! 这里不需要：PTY 里跑的是 **login shell**（`-l`），它会加载用户的 profile，
//! PATH 与终端里完全一致。
//!
//! ## 分层
//!
//! 本模块不依赖 tauri。输出与退出通过 [`TerminalSink`] 交给调用方，
//! 命令层把它实现成「emit 事件到前端」，测试里则实现成「收进 Vec」。

use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{
        Mutex,
        mpsc::{self, RecvTimeoutError},
    },
    thread,
    time::{Duration, Instant},
};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::error::{Error, Result};

/// 单条输出事件携带的最大字节数。
///
/// 切片按**字节**而非字符边界，多字节字符会被从中间劈开——这是安全的：
/// 前端 xterm.js 的 `write(Uint8Array)` 内部维护跨调用的 UTF-8 解码状态，
/// 半个字符会留到下一批拼上。若改成传字符串，这里就必须自己处理残缺序列。
const MAX_CHUNK: usize = 32 * 1024;

/// 输出合并窗口，约合一帧。
///
/// PTY 的 read 常常一次只回来几十个字节（比如逐字回显），一字节一次 IPC
/// 会把前端打爆。攒够 [`MAX_CHUNK`] 或过了这个窗口才发一次，
/// 既压掉了消息数量，又不会让人感觉到输入延迟。
const FLUSH_INTERVAL: Duration = Duration::from_millis(16);

/// 读线程一次 read 的缓冲大小
const READ_BUF: usize = 8 * 1024;

/// 终端输出与退出的接收方。
///
/// 做成 trait 而不是直接 `emit`，是为了让本模块不依赖 tauri——
/// 与 `git/`、`storage/` 一样能脱离运行时单元测试。
pub trait TerminalSink: Send + Sync + 'static {
    /// 一批原始字节。可能从多字节字符中间截断，接收方需按字节流处理。
    fn output(&self, id: &str, bytes: &[u8]);
    /// 子进程已退出。此后不会再有该会话的 `output`。
    fn exit(&self, id: &str, code: u32);
}

/// 一个活着的 PTY 会话。
struct Session {
    /// 用于 resize。持有它同时也维持着 PTY 主端不被关闭。
    master: Box<dyn MasterPty + Send>,
    /// PTY 的写端。`take_writer` 只能调用一次，因此在创建时取好存下来。
    writer: Box<dyn Write + Send>,
    /// 与 `wait` 分离的杀进程句柄——等待线程正阻塞在 `wait()` 上，拿不到 child。
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// 所有 PTY 会话的持有者，放在 `AppState` 里。
#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, Session>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 在 `cwd` 下起一个 login shell，把输出接到 `sink`。
    ///
    /// `id` 由调用方给定而不是这里生成：读线程在本函数返回之前就可能开始推输出了，
    /// 得让调用方先拿到 id 才对得上号。
    pub fn spawn(
        &self,
        id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
        sink: impl TerminalSink,
    ) -> Result<()> {
        let size = pty_size(cols, rows);

        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| Error::Invalid(format!("无法创建伪终端：{e}")))?;

        let mut child = pair
            .slave
            .spawn_command(shell_command(cwd))
            .map_err(|e| Error::Invalid(format!("无法启动 shell：{e}")))?;

        // slave 必须在这里丢掉。它是 PTY 从端的一份句柄，只要还握着，
        // 内核就认为「仍有人可能往里写」，子进程退出后读端也读不到 EOF，
        // 读线程会永远阻塞，退出事件永远不发出来。
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| Error::Invalid(format!("无法读取终端输出：{e}")))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| Error::Invalid(format!("无法写入终端：{e}")))?;
        let killer = child.clone_killer();

        let (tx, rx) = mpsc::channel::<Vec<u8>>();

        // 读线程：只负责把字节搬进 channel，不做任何加工。
        // read 是阻塞的，所以合并与定时 flush 必须放在另一个线程里。
        thread::Builder::new()
            .name(format!("pty-read-{id}"))
            .spawn(move || pump_reader(reader, &tx))
            .map_err(Error::Io)?;

        // 汇聚线程：攒批发给 sink，channel 断开（= 读到 EOF）后收尸并发退出事件。
        let session_id = id.to_owned();
        thread::Builder::new()
            .name(format!("pty-pump-{id}"))
            .spawn(move || {
                pump_output(&session_id, &rx, &sink);

                let code = match child.wait() {
                    Ok(status) => status.exit_code(),
                    Err(e) => {
                        tracing::warn!(id = %session_id, error = %e, "等待终端子进程失败");
                        u32::MAX
                    }
                };
                sink.exit(&session_id, code);
            })
            .map_err(Error::Io)?;

        self.lock()?.insert(
            id.to_owned(),
            Session {
                master: pair.master,
                writer,
                killer,
            },
        );

        tracing::info!(id = %id, cwd = %cwd.display(), "已启动终端会话");
        Ok(())
    }

    /// 把用户的按键写进 PTY。
    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let mut sessions = self.lock()?;
        let session = sessions.get_mut(id).ok_or_else(|| missing(id))?;
        session.writer.write_all(data.as_bytes())?;
        session.writer.flush()?;
        Ok(())
    }

    /// 窗口尺寸变了要告诉内核，否则子进程按旧的列数换行，输出会错位。
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let sessions = self.lock()?;
        let session = sessions.get(id).ok_or_else(|| missing(id))?;
        session
            .master
            .resize(pty_size(cols, rows))
            .map_err(|e| Error::Invalid(format!("调整终端尺寸失败：{e}")))
    }

    /// 结束会话。幂等：会话已经自己退出时也返回 Ok。
    pub fn close(&self, id: &str) -> Result<()> {
        let Some(mut session) = self.lock()?.remove(id) else {
            return Ok(());
        };

        // 先杀进程再丢句柄。反过来的话 shell 会先收到 EOF，
        // 交互式 shell 对 stdin EOF 的反应各不相同（zsh 可能挂着等确认）。
        if let Err(e) = session.killer.kill() {
            tracing::warn!(id = %id, error = %e, "终止终端子进程失败");
        }
        tracing::info!(id = %id, "已关闭终端会话");
        Ok(())
    }

    /// 关闭全部会话。工作区切换与应用退出时调用——留着的话，
    /// 那些 shell 的工作目录还指向旧仓库，用户在里面敲 git 会作用到错误的仓库上。
    pub fn close_all(&self) -> Result<()> {
        let ids: Vec<String> = self.lock()?.keys().cloned().collect();
        for id in ids {
            self.close(&id)?;
        }
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Session>>> {
        self.sessions
            .lock()
            .map_err(|_| Error::Invalid("终端状态锁已损坏".to_owned()))
    }
}

fn missing(id: &str) -> Error {
    Error::Invalid(format!("终端会话不存在或已退出：{id}"))
}

/// 列数与行数都不接受 0：某些实现会把 0 当作「保持不变」，
/// 另一些会真的按 0 列排版并输出乱码，这里统一兜底到一个可用的最小值。
fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// 组装要跑的 shell。
fn shell_command(cwd: &Path) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(shell_program());

    // `-l`（login shell）会加载 profile。这不只是为了别名和提示符：
    // GUI 应用继承的 PATH 是精简过的，不走 profile 就找不到 Homebrew 里的 git。
    #[cfg(unix)]
    cmd.arg("-l");

    cmd.cwd(cwd);

    // 声明终端能力。缺了 TERM，git 会认为对面不是终端而关掉颜色与进度显示，
    // 那就退回成了「把输出打印出来」，白搭了一个 PTY。
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    cmd
}

/// 挑一个 shell。
///
/// Unix：`$SHELL` → passwd 数据库 → `/bin/sh`，由 portable-pty 按这个顺序解析，
/// 与用户在系统里设定的登录 shell 保持一致。
#[cfg(unix)]
fn shell_program() -> String {
    CommandBuilder::new_default_prog().get_shell()
}

/// Windows：优先 PowerShell，退回 `%ComSpec%`（通常是 cmd.exe）。
///
/// 不直接用 ComSpec 是因为 cmd.exe 没有命令历史搜索、没有 ANSI 默认开启，
/// 拿来敲 git 体验差得多；而 `powershell.exe` 自 Windows 7 起随系统提供，
/// 探测失败的概率极低。`pwsh.exe`（PowerShell 7）装了就优先用。
#[cfg(windows)]
fn shell_program() -> String {
    for candidate in ["pwsh.exe", "powershell.exe"] {
        if let Ok(path) = std::env::var("PATH") {
            for dir in std::env::split_paths(&path) {
                if dir.join(candidate).is_file() {
                    return candidate.to_owned();
                }
            }
        }
    }
    CommandBuilder::new_default_prog().get_shell()
}

/// 读线程主体：搬字节，直到 EOF 或对端不再接收。
fn pump_reader(mut reader: Box<dyn Read + Send>, tx: &mpsc::Sender<Vec<u8>>) {
    let mut buf = [0u8; READ_BUF];
    loop {
        match reader.read(&mut buf) {
            // 0 = EOF，子进程已经退出并且从端全部关闭
            Ok(0) => break,
            Ok(n) => {
                // 发送失败说明汇聚线程没了，再读也没有意义
                if tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }
}

/// 汇聚线程主体：按 [`FLUSH_INTERVAL`] / [`MAX_CHUNK`] 攒批发给 sink。
fn pump_output(id: &str, rx: &mpsc::Receiver<Vec<u8>>, sink: &impl TerminalSink) {
    let mut pending: Vec<u8> = Vec::with_capacity(MAX_CHUNK);
    let mut last_flush = Instant::now();

    loop {
        match rx.recv_timeout(FLUSH_INTERVAL) {
            Ok(chunk) => {
                pending.extend_from_slice(&chunk);
                if pending.len() >= MAX_CHUNK || last_flush.elapsed() >= FLUSH_INTERVAL {
                    flush(id, &mut pending, sink);
                    last_flush = Instant::now();
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if !pending.is_empty() {
                    flush(id, &mut pending, sink);
                    last_flush = Instant::now();
                }
            }
            // 读线程结束 = 子进程退出。把最后一批发完再收尾，
            // 否则命令的最后几行（往往正是结果）会丢。
            Err(RecvTimeoutError::Disconnected) => {
                flush(id, &mut pending, sink);
                break;
            }
        }
    }
}

/// 把累积的字节按 [`MAX_CHUNK`] 切开发出，并清空缓冲。
fn flush(id: &str, pending: &mut Vec<u8>, sink: &impl TerminalSink) {
    for chunk in pending.chunks(MAX_CHUNK) {
        sink.output(id, chunk);
    }
    pending.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, mpsc::Sender};

    /// 把回调收进 channel 的测试替身
    struct Collector {
        out: Sender<Vec<u8>>,
    }

    impl TerminalSink for Collector {
        fn output(&self, _id: &str, bytes: &[u8]) {
            let _ = self.out.send(bytes.to_vec());
        }
        fn exit(&self, _id: &str, _code: u32) {}
    }

    #[test]
    fn flush_splits_on_chunk_boundary() {
        let (tx, rx) = mpsc::channel();
        let sink = Collector { out: tx };

        let mut pending = vec![b'x'; MAX_CHUNK + 10];
        flush("t", &mut pending, &sink);

        assert!(pending.is_empty(), "flush 后必须清空缓冲");
        assert_eq!(rx.recv().unwrap().len(), MAX_CHUNK);
        assert_eq!(rx.recv().unwrap().len(), 10);
    }

    #[test]
    fn flush_of_empty_buffer_emits_nothing() {
        let (tx, rx) = mpsc::channel();
        let sink = Collector { out: tx };

        flush("t", &mut Vec::new(), &sink);
        assert!(rx.try_recv().is_err(), "空缓冲不该产生事件");
    }

    #[test]
    fn pty_size_never_zero() {
        // 0 列的 PTY 会让子进程按 0 宽度排版，输出全是乱码
        let size = pty_size(0, 0);
        assert_eq!((size.cols, size.rows), (1, 1));
    }

    /// 端到端：起一个真 shell，跑条命令，确认拿得到输出与退出码。
    #[test]
    fn spawns_shell_and_reports_exit() {
        struct Probe {
            out: Sender<Vec<u8>>,
            done: Sender<u32>,
        }
        impl TerminalSink for Probe {
            fn output(&self, _id: &str, bytes: &[u8]) {
                let _ = self.out.send(bytes.to_vec());
            }
            fn exit(&self, _id: &str, code: u32) {
                let _ = self.done.send(code);
            }
        }

        let (out_tx, out_rx) = mpsc::channel();
        let (done_tx, done_rx) = mpsc::channel();

        let manager = Arc::new(TerminalManager::new());
        let dir = std::env::temp_dir();
        manager
            .spawn(
                "test",
                &dir,
                80,
                24,
                Probe {
                    out: out_tx,
                    done: done_tx,
                },
            )
            .expect("应能启动 shell");

        manager
            .write("test", "echo postkiddie-probe\r")
            .expect("应能写入");

        // 攒够回显再判断。login shell 会先打印提示符，命令回显与结果分批到达。
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            match out_rx.recv_timeout(Duration::from_millis(500)) {
                Ok(chunk) => {
                    seen.extend_from_slice(&chunk);
                    // 回显本身也含这个词，出现两次才说明命令真的执行了
                    if String::from_utf8_lossy(&seen)
                        .matches("postkiddie-probe")
                        .count()
                        >= 2
                    {
                        break;
                    }
                }
                Err(_) => continue,
            }
        }

        let text = String::from_utf8_lossy(&seen);
        assert!(
            text.matches("postkiddie-probe").count() >= 2,
            "应能看到命令回显与执行结果，实际收到：{text}"
        );

        manager.write("test", "exit\r").expect("应能写入");
        let code = done_rx
            .recv_timeout(Duration::from_secs(15))
            .expect("shell 退出后应收到退出事件");
        assert_eq!(code, 0);

        manager.close("test").expect("关闭应当幂等");
    }
}
