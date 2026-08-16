//! 持久化层：工作区 = 一个 git 仓库目录。
//!
//! 磁盘布局
//! ```text
//! my-api-workspace/            ← git 仓库根 = 工作区根
//! ├── .git/
//! ├── .gitignore               ← 首次打开时自动补入 .postkiddie/
//! ├── postkiddie.yaml          ← 工作区标记与全局配置
//! ├── collections/             ← 目录结构 = 集合结构
//! │   └── 用户接口/
//! │       ├── _folder.yaml     ← 显示顺序、目录级 header/auth（可选）
//! │       ├── 登录.yaml
//! │       └── 查询资料.yaml
//! ├── environments/
//! │   ├── 本地.yaml
//! │   └── 预发.yaml
//! └── .postkiddie/             ← 本机私有，被 gitignore
//!     ├── secrets.yaml         ← secret 变量的真实值，永不入库
//!     └── history/             ← 请求历史，纯本地，不共享
//! ```
//!
//! 没有数据库、没有缓存索引：目录内容就是唯一事实来源。用户在 IDE 里直接编辑、
//! 或 `git pull` 拉入他人改动后，重新扫描即得到正确状态，不存在需要修复的不一致。

pub mod cookies;
pub mod history;
pub mod paths;
pub mod tree;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    domain::model::{Environment, WorkspaceConfig},
    error::{Error, Result},
};

pub const WORKSPACE_FILE: &str = "postkiddie.yaml";
pub const PRIVATE_DIR: &str = ".postkiddie";
pub const SECRETS_FILE: &str = "secrets.yaml";
/// Cookie 是登录凭证，与密钥同级：只存本机，永不入库
pub const COOKIES_FILE: &str = "cookies.yaml";
/// 请求历史：纯本地，记录的是「我这台机器上发生过什么」，不是团队契约
pub const HISTORY_FILE: &str = "history.jsonl";

#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: PathBuf,
    pub config: WorkspaceConfig,
}

/// 本机私有的密钥存储：与环境文件同名归组，值不进 git。
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
pub struct SecretStore {
    /// environment 名称 → (变量名 → 值)
    #[serde(default)]
    pub environments:
        std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
}

/// 把环境拆成「可入库的公开部分」与「仅存本机的密钥」。
///
/// 抽成纯函数而不是留在命令层：这是整个应用唯一一条可能把密钥写进 git 的路径，
/// 值得能被直接单测覆盖，而不必先拉起 Tauri 运行时。
///
/// 返回的 `Environment` 中，`secret` 变量的 `value` 一律为空——即便调用方传了值进来。
pub fn split_secrets(
    environment: Environment,
) -> (Environment, std::collections::BTreeMap<String, String>) {
    let mut public = environment;
    let mut secrets = std::collections::BTreeMap::new();

    for var in &mut public.variables {
        if var.secret {
            let value = std::mem::take(&mut var.value);
            if !value.is_empty() {
                secrets.insert(var.name.clone(), value);
            }
        }
    }

    (public, secrets)
}

impl Workspace {
    /// 打开已有工作区。目录必须已是 git 仓库——「git 管理」是这个应用的前提而非可选项。
    pub fn open(root: &Path) -> Result<Self> {
        let config_path = root.join(WORKSPACE_FILE);
        if !config_path.exists() {
            return Err(Error::Invalid(format!(
                "{} 不是 PostKiddie 工作区（缺少 {WORKSPACE_FILE}）",
                root.display()
            )));
        }

        let raw = std::fs::read_to_string(&config_path)?;
        let config: WorkspaceConfig = serde_norway::from_str(&raw)?;

        let ws = Self {
            root: root.to_path_buf(),
            config,
        };
        ws.ensure_private_dir_ignored()?;
        Ok(ws)
    }

    /// 在空目录（或已有 git 仓库）中初始化工作区结构。
    pub fn init(root: &Path, name: &str) -> Result<Self> {
        let config = WorkspaceConfig {
            name: name.to_owned(),
            ..Default::default()
        };

        std::fs::create_dir_all(root.join(&config.collections_dir))?;
        std::fs::create_dir_all(root.join(&config.environments_dir))?;

        let yaml = serde_norway::to_string(&config)?;
        std::fs::write(root.join(WORKSPACE_FILE), yaml)?;

        let ws = Self {
            root: root.to_path_buf(),
            config,
        };
        ws.ensure_private_dir_ignored()?;
        Ok(ws)
    }

    pub fn collections_path(&self) -> PathBuf {
        self.root.join(&self.config.collections_dir)
    }

    pub fn environments_path(&self) -> PathBuf {
        self.root.join(&self.config.environments_dir)
    }

    pub fn private_path(&self) -> PathBuf {
        self.root.join(PRIVATE_DIR)
    }

    /// 扫描集合树
    pub fn scan(&self) -> Result<Vec<tree::TreeNode>> {
        let collections = self.collections_path();
        if !collections.exists() {
            return Ok(Vec::new());
        }
        tree::scan(&self.root, &collections)
    }

    /// 环境列表，且把本机密钥值合并回 `secret` 变量。
    ///
    /// UI 需要看到并编辑真实的密钥值，所以给它的必须是合并后的完整对象；
    /// 写回时由 `commands::environment::environment_save` 重新分离。
    pub fn list_environments_resolved(&self) -> Result<Vec<Environment>> {
        let secrets = self.read_secrets()?;
        let mut envs = self.list_environments()?;

        for env in &mut envs {
            let Some(bucket) = secrets.environments.get(&env.name) else {
                continue;
            };
            for var in &mut env.variables {
                if var.secret
                    && let Some(value) = bucket.get(&var.name)
                {
                    var.value = value.clone();
                }
            }
        }
        Ok(envs)
    }

    /// 环境文件路径。文件名经过净化，环境名可以是任意文本。
    pub fn environment_path(&self, name: &str) -> PathBuf {
        self.environments_path()
            .join(format!("{}.yaml", paths::sanitize_file_name(name)))
    }

    /// 原样写入环境文件。**不做密钥分离**，一般不要直接用——
    /// 除非你确信传入的对象里已经没有密钥值。日常保存请走 [`Self::save_environment`]。
    pub fn write_environment_raw(&self, name: &str, environment: &Environment) -> Result<()> {
        std::fs::create_dir_all(self.environments_path())?;
        let yaml = serde_norway::to_string(environment)?;
        std::fs::write(self.environment_path(name), yaml)?;
        Ok(())
    }

    /// 保存环境：密钥值抽到本机密钥库，公开部分写进 git 跟踪的文件。
    ///
    /// 这是保存环境的**唯一**入口，命令层和测试都走这条路径——
    /// 若让两者各写一份分离逻辑，迟早会漂移，而漂移的后果是密钥进了 git。
    pub fn save_environment(&self, name: &str, environment: Environment) -> Result<()> {
        let (public, bucket) = split_secrets(environment);

        let mut secrets = self.read_secrets()?;
        if bucket.is_empty() {
            // 不留空条目，否则 secrets.yaml 会随环境增删越积越乱
            secrets.environments.remove(name);
        } else {
            secrets.environments.insert(name.to_owned(), bucket);
        }

        self.write_environment_raw(name, &public)?;
        self.write_secrets(&secrets)?;
        Ok(())
    }

    /// 删除环境，同时清掉它在本机密钥库里的那一组值。
    ///
    /// 一并清理是刻意的：留着一组指向已删除环境的密钥没有任何用处，
    /// 只会让 secrets.yaml 越积越多，且日后同名环境重建时会静默继承旧值。
    pub fn delete_environment(&self, name: &str) -> Result<()> {
        let path = self.environment_path(name);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }

        let mut secrets = self.read_secrets()?;
        if secrets.environments.remove(name).is_some() {
            self.write_secrets(&secrets)?;
        }
        Ok(())
    }

    // -- Cookie ------------------------------------------------------------

    pub fn read_cookies(&self) -> Result<cookies::CookieJar> {
        let path = self.private_path().join(COOKIES_FILE);
        if !path.exists() {
            return Ok(cookies::CookieJar::default());
        }
        let raw = std::fs::read_to_string(&path)?;
        Ok(serde_norway::from_str(&raw)?)
    }

    pub fn write_cookies(&self, jar: &cookies::CookieJar) -> Result<()> {
        let dir = self.private_path();
        std::fs::create_dir_all(&dir)?;
        let yaml = serde_norway::to_string(jar)?;
        std::fs::write(dir.join(COOKIES_FILE), yaml)?;
        Ok(())
    }

    pub fn read_history(&self) -> Result<Vec<history::HistoryEntry>> {
        let path = self.private_path().join(HISTORY_FILE);
        if !path.exists() {
            return Ok(Vec::new());
        }
        Ok(history::parse(&std::fs::read_to_string(&path)?))
    }

    /// 追加一条历史。
    ///
    /// 失败不该影响请求本身——历史是旁路记录，磁盘满或权限不足时
    /// 让用户「请求发不出去」是本末倒置，故调用方只记日志、不向上抛。
    pub fn append_history(&self, entry: &history::HistoryEntry) -> Result<()> {
        use std::io::Write as _;

        let dir = self.private_path();
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(HISTORY_FILE);
        let existing = std::fs::read_to_string(&path).unwrap_or_default();

        match history::append(&existing, entry)? {
            history::AppendPlan::Append(line) => {
                let mut file = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)?;
                writeln!(file, "{line}")?;
            }
            history::AppendPlan::Rewrite(all) => std::fs::write(&path, all)?,
        }
        Ok(())
    }

    pub fn clear_history(&self) -> Result<()> {
        let path = self.private_path().join(HISTORY_FILE);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }

    pub fn list_environments(&self) -> Result<Vec<Environment>> {
        let dir = self.environments_path();
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut envs = Vec::new();
        for entry in std::fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                continue;
            }
            let raw = std::fs::read_to_string(&path)?;
            // 单个环境文件损坏不应导致整个列表加载失败
            match serde_norway::from_str::<Environment>(&raw) {
                Ok(env) => envs.push(env),
                Err(e) => {
                    tracing::warn!(path = %path.display(), error = %e, "环境文件解析失败，已跳过")
                }
            }
        }

        envs.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(envs)
    }

    // -- 密钥 ---------------------------------------------------------------

    pub fn read_secrets(&self) -> Result<SecretStore> {
        let path = self.private_path().join(SECRETS_FILE);
        if !path.exists() {
            return Ok(SecretStore::default());
        }
        let raw = std::fs::read_to_string(&path)?;
        Ok(serde_norway::from_str(&raw)?)
    }

    pub fn write_secrets(&self, store: &SecretStore) -> Result<()> {
        let dir = self.private_path();
        std::fs::create_dir_all(&dir)?;
        let yaml = serde_norway::to_string(store)?;
        std::fs::write(dir.join(SECRETS_FILE), yaml)?;
        Ok(())
    }

    /// 确保 `.postkiddie/` 出现在 `.gitignore` 里。
    ///
    /// 每次打开工作区都检查一次：`git pull` 到别人建的仓库、或用户手工改过 .gitignore
    /// 都可能让这行丢失，而它一旦丢失，本地密钥就会在下一次提交时被推到远端。
    /// 这是整个方案里唯一「泄密」风险点，值得在每次打开时付出一次文件读取的代价。
    fn ensure_private_dir_ignored(&self) -> Result<()> {
        let gitignore = self.root.join(".gitignore");
        let entry = format!("{PRIVATE_DIR}/");

        let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
        if existing
            .lines()
            .any(|l| l.trim() == entry || l.trim() == PRIVATE_DIR)
        {
            return Ok(());
        }

        let mut updated = existing;
        if !updated.is_empty() && !updated.ends_with('\n') {
            updated.push('\n');
        }
        updated.push_str("\n# PostKiddie 本机私有数据（密钥、历史），请勿提交\n");
        updated.push_str(&entry);
        updated.push('\n');

        std::fs::write(&gitignore, updated)?;
        tracing::info!("已将 {} 写入 .gitignore", entry);
        Ok(())
    }
}
