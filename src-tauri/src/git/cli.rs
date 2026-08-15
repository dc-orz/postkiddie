//! [`GitBackend`] 的系统 git CLI 实现。

use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::OnceLock,
};

use crate::error::{Error, Result};

use super::{BranchInfo, CommitInfo, FileState, GitBackend, GitStatus, StatusEntry};

/// `git log` 的自定义格式。用 `%x1f`(单元分隔符) 分列、`%x1e`(记录分隔符) 分条，
/// 这两个控制字符不会出现在提交信息里，比按行解析可靠得多。
const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e";

const UNIT_SEP: char = '\x1f';
const RECORD_SEP: char = '\x1e';

#[derive(Debug, Default)]
pub struct GitCli;

impl GitCli {
    pub fn new() -> Self {
        Self
    }

    /// 定位 git 可执行文件。
    ///
    /// 必须显式查找，不能依赖 `Command::new("git")`：macOS 上从 Finder / Dock 启动的
    /// GUI 应用继承的是 launchd 的精简 PATH（通常只有 `/usr/bin:/bin:/usr/sbin:/sbin`），
    /// 拿不到用户在 shell profile 里配置的 Homebrew 路径。这是「终端里跑得好好的，
    /// 打包成 app 就找不到 git」的根因。
    fn binary() -> &'static Path {
        static GIT_BIN: OnceLock<PathBuf> = OnceLock::new();

        GIT_BIN.get_or_init(|| {
            // PATH 找不到时的兜底位置，按平台区分——
            // 在 Windows 上罗列 /usr/bin/git 毫无意义，等于没有兜底
            #[cfg(target_os = "windows")]
            const CANDIDATES: &[&str] = &[
                r"C:\Program Files\Git\cmd\git.exe",
                r"C:\Program Files (x86)\Git\cmd\git.exe",
                r"C:\Program Files\Git\bin\git.exe",
            ];
            #[cfg(not(target_os = "windows"))]
            const CANDIDATES: &[&str] = &[
                "/usr/bin/git",
                "/opt/homebrew/bin/git",
                "/usr/local/bin/git",
                "/usr/local/git/bin/git",
            ];

            // PATH 里能找到就优先用（尊重用户显式配置的 git 版本）
            if let Ok(path) = std::env::var("PATH") {
                for dir in std::env::split_paths(&path) {
                    let candidate = dir.join(if cfg!(windows) { "git.exe" } else { "git" });
                    if candidate.is_file() {
                        return candidate;
                    }
                }
            }

            for candidate in CANDIDATES {
                let p = Path::new(candidate);
                if p.is_file() {
                    return p.to_path_buf();
                }
            }

            // 都没找到就退回裸名，让错误在实际调用时以清晰的 NotFound 暴露
            PathBuf::from("git")
        })
    }

    /// 执行一条 git 命令。所有 git 调用都必须经过这里，以统一施加防挂起的环境变量。
    fn run<I, S>(&self, repo: &Path, args: I) -> Result<Output>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let args: Vec<_> = args.into_iter().collect();
        let display = args
            .iter()
            .map(|a| a.as_ref().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(" ");

        let mut cmd = Command::new(Self::binary());
        cmd.current_dir(repo)
            .args(&args)
            // 关键：GUI 进程没有 tty。任何交互式提示都会让子进程永久等待输入，
            // 表现为整个应用「卡死」。以下三个变量把所有提示变成快速失败。
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", "")
            .env("SSH_ASKPASS", "")
            // 禁用 pager，否则 log/diff 会试图启动 less 并阻塞
            .env("GIT_PAGER", "cat")
            .env("PAGER", "cat")
            // 禁用可选锁，避免只读操作与后台 fetch 互相阻塞
            .env("GIT_OPTIONAL_LOCKS", "0");

        #[cfg(windows)]
        {
            // 不弹出控制台窗口
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let output = cmd.output().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Error::Invalid(
                "找不到 git 可执行文件，请确认已安装 git 并可在 PATH 中访问".to_owned(),
            ),
            _ => Error::Io(e),
        })?;

        if !output.status.success() {
            return Err(Error::Git {
                command: display,
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            });
        }

        Ok(output)
    }

    /// 执行并把 stdout 当作 UTF-8 文本返回
    fn run_text<I, S>(&self, repo: &Path, args: I) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let output = self.run(repo, args)?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

impl GitBackend for GitCli {
    fn discover_repo(&self, path: &Path) -> Result<PathBuf> {
        let out = self
            .run_text(path, ["rev-parse", "--show-toplevel"])
            .map_err(|_| Error::NotAGitRepo(path.display().to_string()))?;

        let root = out.trim();
        if root.is_empty() {
            return Err(Error::NotAGitRepo(path.display().to_string()));
        }
        Ok(PathBuf::from(root))
    }

    fn init(&self, path: &Path) -> Result<()> {
        // 不传 -b：让默认分支名沿用用户的 init.defaultBranch 配置，
        // 与「复用系统 git 既有配置」的整体取向一致
        self.run(path, ["init"])?;
        Ok(())
    }

    fn status(&self, repo: &Path) -> Result<GitStatus> {
        // `-z`    用 NUL 分隔且不转义文件名——中文路径和含空格的名字必须靠它才能正确解析
        // `-uall` 未跟踪项要展开到**文件**级。默认的 normal 模式会把整个未跟踪目录
        //         折叠成一行（如 `collections/`），而侧边栏需要逐个请求文件的状态。
        //         代价是未跟踪文件极多时会变慢，但请求集合仓库本就很小。
        let raw = self.run_text(
            repo,
            ["status", "--porcelain=v1", "--branch", "-z", "-uall"],
        )?;
        Ok(parse_status(&raw))
    }

    fn stage(&self, repo: &Path, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut args = vec!["add".to_owned(), "--".to_owned()];
        args.extend(paths.iter().cloned());
        self.run(repo, args)?;
        Ok(())
    }

    fn unstage(&self, repo: &Path, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut args = vec!["restore".to_owned(), "--staged".to_owned(), "--".to_owned()];
        args.extend(paths.iter().cloned());
        self.run(repo, args)?;
        Ok(())
    }

    fn discard(&self, repo: &Path, paths: &[String]) -> Result<()> {
        if paths.is_empty() {
            return Ok(());
        }
        let mut args = vec![
            "restore".to_owned(),
            "--worktree".to_owned(),
            "--staged".to_owned(),
            "--".to_owned(),
        ];
        args.extend(paths.iter().cloned());
        self.run(repo, args)?;
        Ok(())
    }

    fn commit(&self, repo: &Path, message: &str) -> Result<String> {
        // 用 `-F -`（从 stdin 读）而非 `-m`，避免超长信息触碰命令行长度上限，
        // 也免去消息里含引号/换行时的转义问题。
        use std::io::Write as _;
        use std::process::Stdio;

        let mut child = Command::new(Self::binary())
            .current_dir(repo)
            .args(["commit", "--file", "-", "--cleanup=strip"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_EDITOR", "true")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        child
            .stdin
            .as_mut()
            .ok_or_else(|| Error::Invalid("无法写入 git commit 的标准输入".to_owned()))?
            .write_all(message.as_bytes())?;

        let output = child.wait_with_output()?;
        if !output.status.success() {
            return Err(Error::Git {
                command: "commit".to_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            });
        }

        Ok(self
            .run_text(repo, ["rev-parse", "HEAD"])?
            .trim()
            .to_owned())
    }

    fn diff(&self, repo: &Path, path: Option<&str>, staged: bool) -> Result<String> {
        let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
        if staged {
            args.push("--cached");
        }
        if let Some(p) = path {
            args.push("--");
            args.push(p);
        }
        self.run_text(repo, args)
    }

    fn log(&self, repo: &Path, limit: usize) -> Result<Vec<CommitInfo>> {
        let limit_arg = format!("-{limit}");
        let raw = self.run_text(repo, ["log", &limit_arg, LOG_FORMAT])?;
        Ok(parse_log(&raw))
    }

    fn branches(&self, repo: &Path) -> Result<Vec<BranchInfo>> {
        let raw = self.run_text(
            repo,
            [
                "for-each-ref",
                "--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(refname)",
                "refs/heads",
                "refs/remotes",
            ],
        )?;
        Ok(parse_branches(&raw))
    }

    fn checkout(&self, repo: &Path, branch: &str, create: bool) -> Result<()> {
        if create {
            self.run(repo, ["switch", "--create", branch])?;
        } else {
            self.run(repo, ["switch", branch])?;
        }
        Ok(())
    }

    fn fetch(&self, repo: &Path) -> Result<()> {
        self.run(repo, ["fetch", "--prune", "--quiet"])?;
        Ok(())
    }

    fn pull(&self, repo: &Path, rebase: bool) -> Result<()> {
        // --ff-only / --rebase 都不会开编辑器；显式指定以免受用户 pull.rebase 配置影响，
        // 保证 UI 上「拉取」按钮的行为和它的说明一致。
        if rebase {
            self.run(repo, ["pull", "--rebase", "--quiet"])?;
        } else {
            self.run(repo, ["pull", "--no-rebase", "--no-edit", "--quiet"])?;
        }
        Ok(())
    }

    fn push(&self, repo: &Path, set_upstream: bool) -> Result<()> {
        if set_upstream {
            let branch = self.run_text(repo, ["symbolic-ref", "--short", "HEAD"])?;
            self.run(repo, ["push", "--set-upstream", "origin", branch.trim()])?;
        } else {
            self.run(repo, ["push"])?;
        }
        Ok(())
    }

    fn show_file(&self, repo: &Path, rev: &str, path: &str) -> Result<String> {
        self.run_text(repo, ["show", &format!("{rev}:{path}")])
    }
}

// ---------------------------------------------------------------------------
// 输出解析
// ---------------------------------------------------------------------------

/// 解析 `git status --porcelain=v1 --branch -z`。
///
/// 格式：首条记录是 `## <branch>...<upstream> [ahead N, behind M]`，
/// 其后每条为 `XY <path>`；重命名/复制额外占用**下一条**记录存放原路径。
fn parse_status(raw: &str) -> GitStatus {
    let mut status = GitStatus::default();
    let mut records = raw.split('\0').filter(|s| !s.is_empty());

    // 分支行
    if let Some(head) = records.next()
        && let Some(rest) = head.strip_prefix("## ")
    {
        parse_branch_line(rest, &mut status);
    }

    while let Some(record) = records.next() {
        if record.len() < 3 {
            continue;
        }

        let bytes = record.as_bytes();
        let (x, y) = (bytes[0] as char, bytes[1] as char);
        let path = record[3..].to_owned();

        // 冲突：两侧都非空且非「已暂存的普通改动」组合
        let conflicted = matches!((x, y), ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D'));

        if conflicted {
            status.has_conflicts = true;
            status.entries.push(StatusEntry {
                path,
                original_path: None,
                state: FileState::Conflicted,
                staged: false,
            });
            continue;
        }

        if x == '?' {
            status.entries.push(StatusEntry {
                path,
                original_path: None,
                state: FileState::Untracked,
                staged: false,
            });
            continue;
        }

        // 重命名/复制：原路径在紧随其后的记录里
        let original_path = if x == 'R' || x == 'C' {
            records.next().map(str::to_owned)
        } else {
            None
        };

        // 暂存区侧(X)与工作区侧(Y)可能同时有变更，此处各产出一条，UI 分区展示
        if x != ' ' && x != '?' {
            status.entries.push(StatusEntry {
                path: path.clone(),
                original_path: original_path.clone(),
                state: code_to_state(x),
                staged: true,
            });
        }
        if y != ' ' && y != '?' {
            status.entries.push(StatusEntry {
                path,
                original_path,
                state: code_to_state(y),
                staged: false,
            });
        }
    }

    status
}

fn parse_branch_line(rest: &str, status: &mut GitStatus) {
    // 形如 `main...origin/main [ahead 1, behind 2]`，或分离 HEAD 时 `HEAD (no branch)`
    let (refs, tracking) = match rest.split_once(" [") {
        Some((r, t)) => (r, Some(t.trim_end_matches(']'))),
        None => (rest, None),
    };

    match refs.split_once("...") {
        Some((local, upstream)) => {
            status.branch = Some(local.to_owned());
            status.upstream = Some(upstream.to_owned());
        }
        None => {
            if !refs.contains("(no branch)") {
                status.branch = Some(refs.to_owned());
            }
        }
    }

    if let Some(t) = tracking {
        for part in t.split(", ") {
            if let Some(n) = part.strip_prefix("ahead ") {
                status.ahead = n.trim().parse().unwrap_or(0);
            } else if let Some(n) = part.strip_prefix("behind ") {
                status.behind = n.trim().parse().unwrap_or(0);
            }
        }
    }
}

fn code_to_state(code: char) -> FileState {
    match code {
        'A' => FileState::Added,
        'M' | 'T' => FileState::Modified,
        'D' => FileState::Deleted,
        'R' => FileState::Renamed,
        'C' => FileState::Copied,
        '!' => FileState::Ignored,
        '?' => FileState::Untracked,
        _ => FileState::Modified,
    }
}

fn parse_log(raw: &str) -> Vec<CommitInfo> {
    raw.split(RECORD_SEP)
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .filter_map(|record| {
            let mut f = record.split(UNIT_SEP);
            Some(CommitInfo {
                hash: f.next()?.to_owned(),
                short_hash: f.next()?.to_owned(),
                author_name: f.next()?.to_owned(),
                author_email: f.next()?.to_owned(),
                timestamp: f.next()?.to_owned(),
                subject: f.next()?.to_owned(),
                body: f.next().unwrap_or_default().trim().to_owned(),
            })
        })
        .collect()
}

fn parse_branches(raw: &str) -> Vec<BranchInfo> {
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let mut f = line.split(UNIT_SEP);
            let name = f.next()?.to_owned();
            let is_current = f.next()? == "*";
            let upstream = f.next().filter(|s| !s.is_empty()).map(str::to_owned);
            let full_ref = f.next().unwrap_or_default();

            // origin/HEAD 是个指向默认分支的符号引用，列出来只会让用户困惑
            if name.ends_with("/HEAD") {
                return None;
            }

            Some(BranchInfo {
                name,
                is_current,
                is_remote: full_ref.starts_with("refs/remotes/"),
                upstream,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_with_ahead_behind() {
        let raw = "## main...origin/main [ahead 2, behind 3]\0";
        let s = parse_status(raw);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (2, 3));
    }

    #[test]
    fn parses_branch_without_upstream() {
        let s = parse_status("## feature/new-api\0");
        assert_eq!(s.branch.as_deref(), Some("feature/new-api"));
        assert!(s.upstream.is_none());
    }

    /// 中文路径是 `-z` 存在的理由：不加它 git 会把非 ASCII 转义成 `\344\270\255`
    #[test]
    fn parses_utf8_paths_verbatim() {
        let raw = "## main\0 M collections/用户接口/登录.yaml\0";
        let s = parse_status(raw);
        assert_eq!(s.entries.len(), 1);
        assert_eq!(s.entries[0].path, "collections/用户接口/登录.yaml");
        assert!(!s.entries[0].staged);
    }

    /// 同一文件既有暂存改动又有工作区改动时，应产出两条独立记录
    #[test]
    fn splits_staged_and_unstaged_for_same_file() {
        let raw = "## main\0MM collections/a.yaml\0";
        let s = parse_status(raw);
        assert_eq!(s.entries.len(), 2);
        assert!(s.entries.iter().any(|e| e.staged));
        assert!(s.entries.iter().any(|e| !e.staged));
    }

    #[test]
    fn detects_conflicts() {
        let raw = "## main\0UU collections/a.yaml\0";
        let s = parse_status(raw);
        assert!(s.has_conflicts);
        assert_eq!(s.entries[0].state, FileState::Conflicted);
    }

    #[test]
    fn parses_rename_with_original_path() {
        let raw = "## main\0R  collections/new.yaml\0collections/old.yaml\0";
        let s = parse_status(raw);
        assert_eq!(s.entries[0].state, FileState::Renamed);
        assert_eq!(
            s.entries[0].original_path.as_deref(),
            Some("collections/old.yaml")
        );
    }

    #[test]
    fn parses_untracked() {
        let raw = "## main\0?? collections/brand-new.yaml\0";
        let s = parse_status(raw);
        assert_eq!(s.entries[0].state, FileState::Untracked);
    }

    #[test]
    fn parses_log_records() {
        let raw = format!(
            "abc123{UNIT_SEP}abc{UNIT_SEP}Tim{UNIT_SEP}t@e.com{UNIT_SEP}2026-08-14T10:00:00+08:00{UNIT_SEP}feat: 新增登录接口{UNIT_SEP}正文{RECORD_SEP}"
        );
        let commits = parse_log(&raw);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "feat: 新增登录接口");
        assert_eq!(commits[0].short_hash, "abc");
    }

    #[test]
    fn skips_remote_head_symref() {
        let raw = format!(
            "main{UNIT_SEP}*{UNIT_SEP}origin/main{UNIT_SEP}refs/heads/main\n\
             origin/HEAD{UNIT_SEP} {UNIT_SEP}{UNIT_SEP}refs/remotes/origin/HEAD\n\
             origin/main{UNIT_SEP} {UNIT_SEP}{UNIT_SEP}refs/remotes/origin/main"
        );
        let branches = parse_branches(&raw);
        assert_eq!(branches.len(), 2);
        assert!(branches.iter().any(|b| b.is_current && b.name == "main"));
        assert!(
            branches
                .iter()
                .any(|b| b.is_remote && b.name == "origin/main")
        );
    }
}
