//! `GitCli` 的集成测试：跑在真实的 git 仓库上。
//!
//! 单元测试只覆盖了输出解析函数（喂进去构造好的字符串）。这里补上另一半——
//! git 真的会那样输出吗？命令参数拼对了吗？中文路径在真实链路上能活下来吗？
//! 这些只有跑真 git 才知道，而它们恰恰是最容易出错的地方。

use std::{fs, path::Path, process::Command};

use postkiddie_lib::git::{FileState, GitBackend, cli::GitCli};
use tempfile::TempDir;

/// 建一个配好身份的空仓库。
///
/// 必须显式配 user.name/email：CI 容器里通常没有全局 git 配置，
/// 缺了它 commit 会直接失败，且报错信息与业务无关，很难一眼看出原因。
fn temp_repo() -> (TempDir, GitCli) {
    let dir = tempfile::tempdir().expect("创建临时目录失败");
    let git = GitCli::new();

    git.init(dir.path()).expect("git init 失败");

    for (key, value) in [
        ("user.name", "PostKiddie Test"),
        ("user.email", "test@postkiddie.dev"),
        // 提交时不要求 GPG 签名，否则在配了 commit.gpgsign 的开发机上会卡住
        ("commit.gpgsign", "false"),
    ] {
        let output = Command::new("git")
            .current_dir(dir.path())
            .args(["config", key, value])
            .output()
            .expect("git config 失败");
        assert!(output.status.success(), "git config {key} 失败");
    }

    (dir, git)
}

fn write(root: &Path, relative: &str, content: &str) {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("创建目录失败");
    }
    fs::write(path, content).expect("写文件失败");
}

#[test]
fn discovers_repo_root_from_subdirectory() {
    let (dir, git) = temp_repo();
    let nested = dir.path().join("collections/用户中心");
    fs::create_dir_all(&nested).unwrap();

    let found = git.discover_repo(&nested).expect("应能从子目录找到仓库根");

    // macOS 的临时目录是 /var -> /private/var 的符号链接，比较时需规范化
    assert_eq!(
        found.canonicalize().unwrap(),
        dir.path().canonicalize().unwrap(),
    );
}

#[test]
fn rejects_directory_outside_any_repo() {
    let plain = tempfile::tempdir().unwrap();
    let git = GitCli::new();

    let err = git
        .discover_repo(plain.path())
        .expect_err("非仓库目录应当报错");
    assert_eq!(err.kind(), postkiddie_lib::error::ErrorKind::NotAGitRepo);
}

/// 刚 init 完、一次提交都还没有的仓库。
///
/// 这正是「新建工作区」之后的状态，也就是用户看到的第一屏。git 此时报的分支行是
/// `## No commits yet on main`，而不是普通的 `## main`——单测里那串输入是照抄的，
/// 这条测试负责确认 git 真的会那样输出，前缀没被 git 的版本变更改掉。
#[test]
fn reports_real_branch_name_before_first_commit() {
    let (dir, git) = temp_repo();

    let status = git.status(dir.path()).expect("status 失败");

    let branch = status.branch.as_deref().expect("未提交的仓库也该有分支名");
    assert!(
        !branch.contains("No commits yet"),
        "分支名里混进了 git 的提示语：{branch}"
    );
    // 分支名取决于用户的 init.defaultBranch，不写死成 main
    assert!(
        branch == "main" || branch == "master" || !branch.is_empty(),
        "分支名应当是一个真实的引用名，实际：{branch}"
    );
    assert!(status.upstream.is_none());
}

#[test]
fn reports_untracked_then_staged_then_clean() {
    let (dir, git) = temp_repo();
    write(dir.path(), "collections/登录.yaml", "name: 登录\n");

    let status = git.status(dir.path()).unwrap();
    assert_eq!(status.entries.len(), 1);
    assert_eq!(status.entries[0].state, FileState::Untracked);
    assert_eq!(status.entries[0].path, "collections/登录.yaml");

    git.stage(dir.path(), &["collections/登录.yaml".to_owned()])
        .unwrap();
    let status = git.status(dir.path()).unwrap();
    assert_eq!(status.entries[0].state, FileState::Added);
    assert!(status.entries[0].staged);

    git.commit(dir.path(), "feat: 新增登录请求").unwrap();
    let status = git.status(dir.path()).unwrap();
    assert!(status.entries.is_empty(), "提交后工作区应当干净");
}

/// 中文路径是 `--porcelain -z` 存在的理由：不加 `-z`，git 会把非 ASCII
/// 转义成 `\344\270\255` 这种八进制串，前端拿到的路径就对不上了。
#[test]
fn handles_cjk_and_spaced_paths_end_to_end() {
    let (dir, git) = temp_repo();
    let path = "collections/用户 中心/获取 资料.yaml";
    write(dir.path(), path, "name: 获取资料\n");

    let status = git.status(dir.path()).unwrap();
    assert_eq!(status.entries[0].path, path);

    git.stage(dir.path(), &[path.to_owned()]).unwrap();
    git.commit(dir.path(), "feat: 中文路径").unwrap();

    let content = git.show_file(dir.path(), "HEAD", path).unwrap();
    assert_eq!(content, "name: 获取资料\n");
}

#[test]
fn separates_staged_and_unstaged_changes_of_one_file() {
    let (dir, git) = temp_repo();
    write(dir.path(), "a.yaml", "v1\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();
    git.commit(dir.path(), "chore: 初始").unwrap();

    write(dir.path(), "a.yaml", "v2\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();
    write(dir.path(), "a.yaml", "v3\n");

    let status = git.status(dir.path()).unwrap();
    assert_eq!(status.entries.len(), 2, "应当分别报告暂存与工作区的改动");
    assert!(
        status
            .entries
            .iter()
            .any(|e| e.staged && e.state == FileState::Modified)
    );
    assert!(
        status
            .entries
            .iter()
            .any(|e| !e.staged && e.state == FileState::Modified)
    );
}

#[test]
fn unstage_moves_change_back_to_worktree() {
    let (dir, git) = temp_repo();
    write(dir.path(), "a.yaml", "v1\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();
    git.commit(dir.path(), "chore: 初始").unwrap();

    write(dir.path(), "a.yaml", "v2\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();
    git.unstage(dir.path(), &["a.yaml".to_owned()]).unwrap();

    let status = git.status(dir.path()).unwrap();
    assert_eq!(status.entries.len(), 1);
    assert!(!status.entries[0].staged);
}

#[test]
fn discard_restores_file_to_head() {
    let (dir, git) = temp_repo();
    write(dir.path(), "a.yaml", "原始\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();
    git.commit(dir.path(), "chore: 初始").unwrap();

    write(dir.path(), "a.yaml", "被改坏了\n");
    git.discard(dir.path(), &["a.yaml".to_owned()]).unwrap();

    assert_eq!(
        fs::read_to_string(dir.path().join("a.yaml")).unwrap(),
        "原始\n"
    );
    assert!(git.status(dir.path()).unwrap().entries.is_empty());
}

#[test]
fn commit_message_survives_newlines_and_quotes() {
    let (dir, git) = temp_repo();
    write(dir.path(), "a.yaml", "x\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();

    // 走 stdin 而非 -m 的理由：这种消息用 -m 拼命令行会被转义规则坑到
    let message = "feat: 支持 \"引号\" 与换行\n\n正文第一行\n正文第二行";
    let hash = git.commit(dir.path(), message).unwrap();
    assert_eq!(hash.len(), 40, "应返回完整的 40 位 hash");

    let log = git.log(dir.path(), 10).unwrap();
    assert_eq!(log.len(), 1);
    assert_eq!(log[0].subject, "feat: 支持 \"引号\" 与换行");
    assert_eq!(log[0].body, "正文第一行\n正文第二行");
    assert_eq!(log[0].author_name, "PostKiddie Test");
    assert_eq!(log[0].hash, hash);
}

#[test]
fn empty_commit_message_is_rejected_by_git() {
    let (dir, git) = temp_repo();
    write(dir.path(), "a.yaml", "x\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();

    let err = git
        .commit(dir.path(), "   \n\n  ")
        .expect_err("空消息应当被拒绝");
    assert_eq!(err.kind(), postkiddie_lib::error::ErrorKind::Git);
}

#[test]
fn lists_branches_and_switches_between_them() {
    let (dir, git) = temp_repo();
    write(dir.path(), "a.yaml", "x\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();
    git.commit(dir.path(), "chore: 初始").unwrap();

    git.checkout(dir.path(), "feature/新接口", true).unwrap();

    let branches = git.branches(dir.path()).unwrap();
    let current = branches
        .iter()
        .find(|b| b.is_current)
        .expect("应当有当前分支");
    assert_eq!(current.name, "feature/新接口");
    assert!(
        branches.iter().all(|b| !b.is_remote),
        "本地仓库不应有远程分支"
    );

    let status = git.status(dir.path()).unwrap();
    assert_eq!(status.branch.as_deref(), Some("feature/新接口"));
    assert!(status.upstream.is_none(), "新建分支尚未关联上游");
}

#[test]
fn diff_reports_worktree_and_staged_separately() {
    let (dir, git) = temp_repo();
    write(dir.path(), "a.yaml", "name: 旧\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();
    git.commit(dir.path(), "chore: 初始").unwrap();

    write(dir.path(), "a.yaml", "name: 新\n");

    let worktree = git.diff(dir.path(), None, false).unwrap();
    assert!(worktree.contains("-name: 旧"));
    assert!(worktree.contains("+name: 新"));

    assert!(
        git.diff(dir.path(), None, true).unwrap().is_empty(),
        "尚未暂存，cached diff 应为空"
    );

    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();
    assert!(
        git.diff(dir.path(), None, true)
            .unwrap()
            .contains("+name: 新")
    );
}

/// 推送到不存在的远程必须**快速失败**而不是挂起。
///
/// 这是整个 git 集成里最关键的一条：GUI 进程没有 tty，若 git 弹出凭证提示，
/// 子进程会永久等待输入，表现为整个应用卡死。`GIT_TERMINAL_PROMPT=0` 就是为此。
#[test]
fn push_without_remote_fails_fast_instead_of_hanging() {
    let (dir, git) = temp_repo();
    write(dir.path(), "a.yaml", "x\n");
    git.stage(dir.path(), &["a.yaml".to_owned()]).unwrap();
    git.commit(dir.path(), "chore: 初始").unwrap();

    let started = std::time::Instant::now();
    let err = git.push(dir.path(), false).expect_err("没有远程时应当报错");

    assert_eq!(err.kind(), postkiddie_lib::error::ErrorKind::Git);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(10),
        "应当立即失败而非等待输入，实际耗时 {:?}",
        started.elapsed(),
    );
}

/// `git mv` 的意义在于让历史连得上：git 把它记成一次重命名，
/// 而不是「删掉一个文件、新增另一个」——后者会让 blame 和 log --follow 断掉。
#[test]
fn move_path_is_recorded_as_rename() {
    let (dir, git) = temp_repo();
    write(dir.path(), "collections/旧名字.yaml", "name: 旧名字\n");
    git.stage(dir.path(), &["collections/旧名字.yaml".to_owned()])
        .unwrap();
    git.commit(dir.path(), "chore: 初始").unwrap();

    git.move_path(
        dir.path(),
        "collections/旧名字.yaml",
        "collections/新名字.yaml",
    )
    .unwrap();

    let status = git.status(dir.path()).unwrap();
    let renamed = status
        .entries
        .iter()
        .find(|e| e.state == FileState::Renamed)
        .expect("应当被记成重命名");

    assert_eq!(renamed.path, "collections/新名字.yaml");
    assert_eq!(
        renamed.original_path.as_deref(),
        Some("collections/旧名字.yaml")
    );
    assert!(renamed.staged, "git mv 会直接把改动放进暂存区");
}

/// 未被跟踪的文件 git mv 会失败——调用方据此退回普通改名，所以这个行为要固定下来
#[test]
fn move_path_fails_for_untracked_file() {
    let (dir, git) = temp_repo();
    write(dir.path(), "新建的.yaml", "x\n");

    let err = git
        .move_path(dir.path(), "新建的.yaml", "改名的.yaml")
        .expect_err("未跟踪的文件应当 mv 失败");
    assert_eq!(err.kind(), postkiddie_lib::error::ErrorKind::Git);
}
