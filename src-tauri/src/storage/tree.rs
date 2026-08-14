//! 集合树扫描：把磁盘目录结构读成 UI 可渲染的树。
//!
//! 磁盘布局即业务结构，不存在额外的索引文件需要与之同步——
//! 这是「以 git 目录为唯一事实来源」的直接结果，也意味着用户在 IDE 里
//! 直接改文件、或 `git pull` 拉到别人的改动后，重新扫描即可得到正确的树。

use std::path::Path;

use serde::Serialize;

use crate::{
    domain::model::{FolderMeta, HttpMethod, HttpRequest},
    error::Result,
};

use super::paths::to_relative_slash;

pub const REQUEST_EXT: &str = "yaml";
pub const FOLDER_META_FILE: &str = "_folder.yaml";

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TreeNode {
    #[serde(rename_all = "camelCase")]
    Folder {
        /// 相对工作区根的路径，同时作为前端的稳定 key
        id: String,
        name: String,
        children: Vec<TreeNode>,
    },
    #[serde(rename_all = "camelCase")]
    Request {
        id: String,
        name: String,
        method: HttpMethod,
        url: String,
    },
    /// 解析失败的文件也要出现在树里并标红，而不是静默消失——
    /// 静默丢失会让用户以为 `git pull` 把请求弄丢了。
    #[serde(rename_all = "camelCase")]
    Broken {
        id: String,
        name: String,
        error: String,
    },
}

/// 递归扫描目录，产出树。
pub fn scan(root: &Path, dir: &Path) -> Result<Vec<TreeNode>> {
    let meta = read_folder_meta(dir).unwrap_or_default();

    let mut folders = Vec::new();
    let mut requests = Vec::new();

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().into_owned();

        // 隐藏文件与 git 内部目录一律跳过
        if file_name.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            folders.push((
                file_name.clone(),
                TreeNode::Folder {
                    id: to_relative_slash(root, &path)?,
                    name: read_folder_meta(&path)
                        .ok()
                        .and_then(|m| m.name)
                        .unwrap_or(file_name),
                    children: scan(root, &path)?,
                },
            ));
            continue;
        }

        if file_name == FOLDER_META_FILE {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some(REQUEST_EXT) {
            continue;
        }

        let id = to_relative_slash(root, &path)?;
        let node = match read_request(&path) {
            Ok(req) => TreeNode::Request {
                id,
                name: req.name,
                method: req.method,
                url: req.url,
            },
            Err(e) => TreeNode::Broken {
                id,
                name: file_name.clone(),
                error: e.to_string(),
            },
        };
        requests.push((file_name, node));
    }

    Ok(order_nodes(folders, requests, &meta.order))
}

/// 按 `_folder.yaml` 的 `order` 排序：列出的在前且保持给定顺序，
/// 未列出的按「文件夹优先、再按名称」跟在后面。
///
/// 这样 `order` 可以是不完整的——外部新增的文件不会消失，也不强制立刻维护顺序。
fn order_nodes(
    folders: Vec<(String, TreeNode)>,
    requests: Vec<(String, TreeNode)>,
    order: &[String],
) -> Vec<TreeNode> {
    let mut all: Vec<(String, TreeNode)> = folders;
    let folder_count = all.len();
    all.extend(requests);

    let rank = |file_name: &str| order.iter().position(|o| o == file_name);

    let mut listed: Vec<_> = Vec::new();
    let mut unlisted: Vec<_> = Vec::new();

    for (idx, (file_name, node)) in all.into_iter().enumerate() {
        match rank(&file_name) {
            Some(pos) => listed.push((pos, node)),
            // 保留「文件夹在前」的原始分组信息用于兜底排序
            None => unlisted.push((idx < folder_count, file_name, node)),
        }
    }

    listed.sort_by_key(|(pos, _)| *pos);
    unlisted.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| natural_cmp(&a.1, &b.1)));

    listed
        .into_iter()
        .map(|(_, n)| n)
        .chain(unlisted.into_iter().map(|(_, _, n)| n))
        .collect()
}

/// 大小写不敏感的名称比较。纯 `str::cmp` 会把 `Zebra` 排在 `apple` 前面，
/// 在侧边栏里看起来像是排序坏了。
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.to_lowercase()
        .cmp(&b.to_lowercase())
        .then_with(|| a.cmp(b))
}

pub fn read_request(path: &Path) -> Result<HttpRequest> {
    let raw = std::fs::read_to_string(path)?;
    Ok(serde_norway::from_str(&raw)?)
}

pub fn write_request(path: &Path, request: &HttpRequest) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let yaml = serde_norway::to_string(request)?;
    std::fs::write(path, yaml)?;
    Ok(())
}

pub fn read_folder_meta(dir: &Path) -> Result<FolderMeta> {
    let path = dir.join(FOLDER_META_FILE);
    if !path.exists() {
        return Ok(FolderMeta::default());
    }
    let raw = std::fs::read_to_string(&path)?;
    Ok(serde_norway::from_str(&raw)?)
}

pub fn write_folder_meta(dir: &Path, meta: &FolderMeta) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let yaml = serde_norway::to_string(meta)?;
    std::fs::write(dir.join(FOLDER_META_FILE), yaml)?;
    Ok(())
}
