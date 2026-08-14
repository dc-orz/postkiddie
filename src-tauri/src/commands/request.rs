//! 请求的读写与发送。

use tauri::State;

use crate::{
    AppState,
    domain::model::HttpRequest,
    error::Result,
    http::{HttpResponse, VariableScope, execute},
    storage::{
        Workspace,
        paths::resolve_within,
        tree::{read_request, write_request},
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
