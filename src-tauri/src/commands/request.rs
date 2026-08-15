//! 请求的读写与发送。

use std::path::{Path, PathBuf};

use tauri::State;

use crate::{
    AppState,
    domain::model::{HttpMethod, HttpRequest},
    error::{Error, Result},
    http::{HttpResponse, VariableScope, execute},
    storage::{
        Workspace,
        paths::{resolve_within, sanitize_file_name, to_relative_slash},
        tree::{REQUEST_EXT, read_folder_meta, read_request, write_folder_meta, write_request},
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

/// 重命名请求：同时改文件名与 YAML 里的 `name`，返回新的 id。
///
/// 两者必须一起改。只改 `name` 会让文件名与显示名长期背离，
/// 而文件名正是这个项目里请求的身份——git 历史、diff、别人 clone 后看到的都是它。
///
/// 用 `git mv` 而非普通重命名：让 git 直接把它记成一次重命名而非「删一个加一个」，
/// 历史与 blame 才连得上。git 不可用时退回普通改名，不阻塞用户。
#[tauri::command]
pub async fn request_rename(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<String> {
    let ws = state.workspace()?;
    let old_path = resolve_within(&ws.root, &id)?;

    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::Invalid("请求名不能为空".to_owned()));
    }

    let dir = old_path
        .parent()
        .ok_or_else(|| Error::Invalid("无法确定所在目录".to_owned()))?;
    let new_path = unique_path(dir, &sanitize_file_name(trimmed), REQUEST_EXT);

    // 文件内容里的 name 也要跟着改，否则下次扫描出来的显示名又变回去了
    let mut request = read_request(&old_path)?;
    request.name = trimmed.to_owned();

    if new_path != old_path {
        write_request(&old_path, &request)?;
        move_file(state.git.as_ref(), &ws.root, &old_path, &new_path)?;
        rename_in_folder_order(dir, &old_path, &new_path)?;
    } else {
        write_request(&old_path, &request)?;
    }

    let new_id = to_relative_slash(&ws.root, &new_path)?;
    tracing::info!(from = %id, to = %new_id, "已重命名请求");
    Ok(new_id)
}

/// 移动文件。优先 `git mv` 以保留重命名历史，失败则退回普通移动。
fn move_file(git: &dyn crate::git::GitBackend, repo: &Path, from: &Path, to: &Path) -> Result<()> {
    let (Ok(rel_from), Ok(rel_to)) = (to_relative_slash(repo, from), to_relative_slash(repo, to))
    else {
        std::fs::rename(from, to)?;
        return Ok(());
    };

    // 未被 git 跟踪的新文件 git mv 会失败，这时普通改名才是对的
    if git.move_path(repo, &rel_from, &rel_to).is_err() {
        std::fs::rename(from, to)?;
    }
    Ok(())
}

/// 若目录的 `_folder.yaml` 里记了旧文件名，同步换成新的，否则顺序会悄悄丢失。
fn rename_in_folder_order(dir: &Path, old_path: &Path, new_path: &Path) -> Result<()> {
    let (Some(old_name), Some(new_name)) = (
        old_path.file_name().and_then(|n| n.to_str()),
        new_path.file_name().and_then(|n| n.to_str()),
    ) else {
        return Ok(());
    };

    let mut meta = read_folder_meta(dir)?;
    let Some(slot) = meta.order.iter_mut().find(|n| n.as_str() == old_name) else {
        return Ok(());
    };

    *slot = new_name.to_owned();
    write_folder_meta(dir, &meta)
}

/// 重排某个目录下的显示顺序。
///
/// 顺序集中写在 `_folder.yaml` 的 `order` 里，所以一次拖拽只产生一处 diff——
/// 这正是当初不在每个请求里放 `seq` 序号的原因。
#[tauri::command]
pub async fn folder_reorder(
    state: State<'_, AppState>,
    folder: Option<String>,
    order: Vec<String>,
) -> Result<()> {
    let ws = state.workspace()?;
    let dir = resolve_parent(&ws, folder.as_deref())?;

    let mut meta = read_folder_meta(&dir)?;
    meta.order = order;
    write_folder_meta(&dir, &meta)?;
    Ok(())
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
    let mut jar = ws.read_cookies()?;
    let now = jiff::Timestamp::now().to_string();

    tracing::debug!(method = request.method.as_str(), url = %request.url, "发送请求");
    let outcome = execute(&state.http, &request, &scope, &ws.root, &jar, &now).await?;

    // 回存响应带来的 cookie，让「先调登录接口、再调业务接口」这条链路自动成立。
    // send_cookies 关闭时不回存：那是完整隔离，不该反过来污染真实会话。
    if request.settings.send_cookies && !outcome.received_cookies.is_empty() {
        let count = outcome.received_cookies.len();
        for cookie in outcome.received_cookies {
            jar.upsert(cookie);
        }
        jar.purge_expired(&now);
        ws.write_cookies(&jar)?;
        tracing::debug!(count, "已保存响应返回的 Cookie");
    }

    Ok(outcome.response)
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
