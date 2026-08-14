//! 请求的读写与发送。

use std::path::{Path, PathBuf};

use tauri::State;

use crate::{
    AppState,
    domain::model::{HttpMethod, HttpRequest},
    error::Result,
    http::{HttpResponse, VariableScope, execute},
    storage::{
        Workspace,
        paths::{resolve_within, sanitize_file_name, to_relative_slash},
        tree::{REQUEST_EXT, read_request, write_request},
    },
};

/// 按路径读取请求。`id` 即请求相对工作区根的路径。
#[tauri::command]
pub async fn request_read(state: State<'_, AppState>, id: String) -> Result<HttpRequest> {
    let ws = state.workspace()?;
    let path = resolve_within(&ws.root, &id)?;
    read_request(&path)
}

#[tauri::command]
pub async fn request_save(
    state: State<'_, AppState>,
    id: String,
    request: HttpRequest,
) -> Result<()> {
    let ws = state.workspace()?;
    let path = resolve_within(&ws.root, &id)?;
    write_request(&path, &request)?;
    tracing::debug!(id = %id, "已保存请求");
    Ok(())
}

/// 新建请求，返回新文件的 id（相对工作区根的路径）。
///
/// `parent` 是目标目录（相对工作区根），为空则放在集合根下。
///
/// 由 Rust 而非前端拼路径：文件名净化与重名消歧的规则只应存在一处，
/// 在前端复制一份迟早会与磁盘上的真实行为漂移。
#[tauri::command]
pub async fn request_create(
    state: State<'_, AppState>,
    parent: Option<String>,
    name: String,
    method: Option<HttpMethod>,
) -> Result<String> {
    let ws = state.workspace()?;
    let dir = resolve_parent(&ws, parent.as_deref())?;
    std::fs::create_dir_all(&dir)?;

    let path = unique_path(&dir, &sanitize_file_name(&name), REQUEST_EXT);
    let request = HttpRequest {
        name,
        method: method.unwrap_or_default(),
        ..Default::default()
    };

    write_request(&path, &request)?;
    let id = to_relative_slash(&ws.root, &path)?;
    tracing::info!(id = %id, "已新建请求");
    Ok(id)
}

/// 新建文件夹，返回其 id（相对工作区根的路径）。
#[tauri::command]
pub async fn folder_create(
    state: State<'_, AppState>,
    parent: Option<String>,
    name: String,
) -> Result<String> {
    let ws = state.workspace()?;
    let base = resolve_parent(&ws, parent.as_deref())?;

    let mut path = base.join(sanitize_file_name(&name));
    let mut suffix = 2;
    while path.exists() {
        path = base.join(format!("{} {suffix}", sanitize_file_name(&name)));
        suffix += 1;
    }

    std::fs::create_dir_all(&path)?;
    let id = to_relative_slash(&ws.root, &path)?;
    tracing::info!(id = %id, "已新建文件夹");
    Ok(id)
}

#[tauri::command]
pub async fn request_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    let ws = state.workspace()?;
    let path = resolve_within(&ws.root, &id)?;
    // 用普通删除而非移入回收站：文件在 git 管理下，误删可以 `git restore` 找回，
    // 这比引入一个平台相关的回收站依赖更符合本项目的取向。
    std::fs::remove_file(&path)?;
    tracing::info!(id = %id, "已删除请求");
    Ok(())
}

/// 发送请求。
///
/// 接收的是**完整的请求对象**而不是路径，因为用户经常在未保存的编辑态下点发送；
/// 若从磁盘读取会丢掉当前编辑内容。
#[tauri::command]
pub async fn request_send(
    state: State<'_, AppState>,
    request: HttpRequest,
    environment: Option<String>,
) -> Result<HttpResponse> {
    let ws = state.workspace()?;
    let scope = build_scope(&ws, environment.as_deref())?;

    tracing::debug!(method = request.method.as_str(), url = %request.url, "发送请求");
    execute(&state.http, &request, &scope, &ws.root).await
}

/// 在不发送的前提下，列出请求里引用了但当前无法解析的变量。
/// 前端用它做发送前的静态提示，比发出去再报错体验好。
#[tauri::command]
pub async fn request_check_variables(
    state: State<'_, AppState>,
    request: HttpRequest,
    environment: Option<String>,
) -> Result<Vec<String>> {
    let ws = state.workspace()?;
    let scope = build_scope(&ws, environment.as_deref())?;

    let mut missing = Vec::new();
    let mut collect = |text: &str| {
        for name in scope.find_unresolved(text) {
            if !missing.contains(&name) {
                missing.push(name);
            }
        }
    };

    collect(&request.url);
    for kv in request
        .headers
        .iter()
        .chain(request.params.iter())
        .filter(|k| k.enabled)
    {
        collect(&kv.name);
        collect(&kv.value);
    }

    Ok(missing)
}

/// 解析「父目录」参数：缺省落到集合根，给定则按相对路径解析并做越界校验。
fn resolve_parent(ws: &Workspace, parent: Option<&str>) -> Result<PathBuf> {
    match parent {
        Some(p) if !p.is_empty() => resolve_within(&ws.root, p),
        _ => Ok(ws.collections_path()),
    }
}

/// 在目录下找一个不冲突的文件名：`登录.yaml`、`登录 2.yaml`、`登录 3.yaml`…
///
/// 用「空格 + 序号」而非 `(1)` 或 `_copy`：与 macOS/Windows 文件管理器的习惯一致，
/// 且不会引入需要转义的字符。
fn unique_path(dir: &Path, base: &str, ext: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{base}.{ext}"));
    let mut suffix = 2;

    while candidate.exists() {
        candidate = dir.join(format!("{base} {suffix}.{ext}"));
        suffix += 1;
    }
    candidate
}

/// 按优先级由低到高合并变量：工作区全局 → 环境（公开值）→ 环境（本机密钥）。
///
/// 密钥最后合并，因此本机 `.postkiddie/secrets.yaml` 里的值总能覆盖
/// git 里那份被清空的占位值。
fn build_scope(ws: &Workspace, environment: Option<&str>) -> Result<VariableScope> {
    let mut scope = VariableScope::new();

    let Some(env_name) = environment else {
        return Ok(scope);
    };

    if let Some(env) = ws
        .list_environments()?
        .into_iter()
        .find(|e| e.name == env_name)
    {
        scope.extend(
            env.variables
                .iter()
                .filter(|v| v.enabled)
                .map(|v| (v.name.clone(), v.value.clone())),
        );
    }

    if let Some(secrets) = ws.read_secrets()?.environments.get(env_name) {
        scope.extend(secrets.iter().map(|(k, v)| (k.clone(), v.clone())));
    }

    Ok(scope)
}
