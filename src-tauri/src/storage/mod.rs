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

#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: PathBuf,
    pub config: WorkspaceConfig,
}

/// 本机私有的密钥存储：与环境文件同名归组，值不进 git。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SecretStore {
    /// environment 名称 → (变量名 → 值)
    #[serde(default)]
    pub environments:
        std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
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
