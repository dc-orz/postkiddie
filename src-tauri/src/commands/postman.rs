//! Postman 集合导入。

use std::path::Path;

use tauri::State;

use crate::{
    AppState,
    domain::postman::{ImportedItem, parse_collection},
    error::Result,
    storage::{
        Workspace,
        paths::{resolve_within, sanitize_file_name},
        tree::{REQUEST_EXT, write_request},
    },
};

/// 导入一份 Postman 集合，返回写入的请求数。
///
/// 集合整体落在一个以其名字命名的目录下，而不是摊到目标目录里：
/// Postman 集合动辄几十条，摊开会把现有的树冲散，而套一层之后
/// 用户可以整体拖走、整体删掉，也一眼看得出这批是从哪来的。
#[tauri::command]
#[specta::specta]
pub async fn postman_import(
    state: State<'_, AppState>,
    path: String,
    parent: Option<String>,
) -> Result<u32> {
    let ws = state.workspace()?;
    let raw = std::fs::read_to_string(&path)?;
    let collection = parse_collection(&raw)?;

    let base = match parent.as_deref() {
        Some(p) if !p.is_empty() => resolve_within(&ws.root, p)?,
        _ => ws.collections_path(),
    };

    let root = unique_dir(&base, &sanitize_file_name(&collection.name));
    std::fs::create_dir_all(&root)?;
    write_items(&root, &collection.items)?;

    let count = collection.request_count() as u32;
    tracing::info!(name = %collection.name, count, "已导入 Postman 集合");
    Ok(count)
}

/// 递归写入。目录顺序交给 `_folder.yaml` 之外的默认排序——
/// Postman 的 item 顺序就是用户在那边看到的顺序，这里按同样的先后落盘即可。
fn write_items(dir: &Path, items: &[ImportedItem]) -> Result<()> {
    use crate::storage::tree::{read_folder_meta, write_folder_meta};

    let mut order = Vec::new();

    for item in items {
        match item {
            ImportedItem::Request(request) => {
                let path = unique_file(dir, &sanitize_file_name(&request.name));
                write_request(&path, request)?;
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    order.push(name.to_owned());
                }
            }
            ImportedItem::Folder { name, children } => {
                let sub = unique_dir(dir, &sanitize_file_name(name));
                std::fs::create_dir_all(&sub)?;
                write_items(&sub, children)?;
                if let Some(n) = sub.file_name().and_then(|n| n.to_str()) {
                    order.push(n.to_owned());
                }
            }
        }
    }

    // 显式写下顺序，否则扫描时会退回按名称排序，
    // 而 Postman 里的排列往往是有意为之（登录在前、业务在后）
    let mut meta = read_folder_meta(dir)?;
    meta.order = order;
    write_folder_meta(dir, &meta)?;
    Ok(())
}

fn unique_dir(parent: &Path, stem: &str) -> std::path::PathBuf {
    let mut candidate = parent.join(stem);
    let mut n = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{stem} {n}"));
        n += 1;
    }
    candidate
}

fn unique_file(parent: &Path, stem: &str) -> std::path::PathBuf {
    let mut candidate = parent.join(format!("{stem}.{REQUEST_EXT}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{stem} {n}.{REQUEST_EXT}"));
        n += 1;
    }
    candidate
}

/// 便于集成测试直接驱动写盘逻辑，无需 Tauri 运行时
pub fn import_into(ws: &Workspace, json: &str) -> Result<u32> {
    let collection = parse_collection(json)?;
    let root = unique_dir(
        &ws.collections_path(),
        &sanitize_file_name(&collection.name),
    );
    std::fs::create_dir_all(&root)?;
    write_items(&root, &collection.items)?;
    Ok(collection.request_count() as u32)
}
