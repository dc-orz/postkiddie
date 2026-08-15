//! Cookie 的查看、导入与登录态捕获。
//!
//! ## 为什么不去读浏览器的 Cookie 数据库
//!
//! 技术上做得到：Chrome 的 cookie 存在 SQLite 里，值用 Keychain（macOS）或
//! DPAPI（Windows）中的密钥加密。但这条路不值得走：
//!
//! - 需要访问用户的钥匙串与浏览器私有数据，Safari 还要完全磁盘访问权限
//! - Chrome 127+ 在 Windows 上加了 App-Bound Encryption，基本封死
//! - **「扫描浏览器凭证库」正是 infostealer 的典型行为**，杀软会直接报毒，
//!   而一个 API 调试工具不该让用户在这种事上替它做信任判断
//!
//! ## 改用内置登录窗口
//!
//! 开一个属于本应用的 WebView 加载目标站点，用户在里面正常登录——SSO、双因子、
//! 验证码都照常工作，因为那就是个真浏览器。登录产生的 cookie 天然属于这个 WebView，
//! 用 `cookies_for_url` 读出来即可：不需要任何特殊权限，三端行为一致。

use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, webview::Cookie as WebviewCookie,
};

use crate::{
    AppState,
    domain::cookie::{Cookie, parse_cookie_header},
    error::{Error, Result},
    storage::cookies::CookieJar,
};

/// 登录窗口的固定标签。同一时刻只允许一个，避免用户开出一堆分不清哪个是哪个。
const LOGIN_WINDOW_LABEL: &str = "pk-login";

/// 按域分组的 cookie，供 UI 展示
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieGroup {
    pub domain: String,
    pub cookies: Vec<Cookie>,
}

#[tauri::command]
pub async fn cookie_list(state: State<'_, AppState>) -> Result<Vec<CookieGroup>> {
    let jar = state.workspace()?.read_cookies()?;
    Ok(jar
        .grouped_by_domain()
        .into_iter()
        .map(|(domain, cookies)| CookieGroup { domain, cookies })
        .collect())
}

#[tauri::command]
pub async fn cookie_delete(
    state: State<'_, AppState>,
    name: String,
    domain: String,
    path: String,
) -> Result<()> {
    let ws = state.workspace()?;
    let mut jar = ws.read_cookies()?;
    jar.remove(&name, &domain, &path);
    ws.write_cookies(&jar)?;
    Ok(())
}

/// 清掉某个域及其子域的全部 cookie，相当于「退出登录」
#[tauri::command]
pub async fn cookie_clear_domain(state: State<'_, AppState>, domain: String) -> Result<()> {
    let ws = state.workspace()?;
    let mut jar = ws.read_cookies()?;
    jar.clear_domain(&domain);
    ws.write_cookies(&jar)?;
    tracing::info!(domain = %domain, "已清除该域的 Cookie");
    Ok(())
}

/// 粘贴导入：接受 DevTools 里复制的 `Cookie` 请求头，或整条 curl 命令。
///
/// 保留这条通道是因为它零门槛且永远可用——浏览器右键「Copy as cURL」出来的内容
/// 直接粘进来就行，不必先想清楚该用哪种同步方式。
///
/// `url` 决定 cookie 归属的域；`raw` 可以是 Cookie 头的值，也可以是整条 curl 命令。
#[tauri::command]
pub async fn cookie_import(state: State<'_, AppState>, url: String, raw: String) -> Result<usize> {
    let target: url::Url = url.parse()?;
    let domain = target
        .host_str()
        .ok_or_else(|| Error::Invalid("URL 中没有主机名".to_owned()))?;

    let header = extract_cookie_header(&raw);
    let cookies = parse_cookie_header(&header, domain);
    if cookies.is_empty() {
        return Err(Error::Invalid(
            "没能从粘贴内容里解析出 Cookie，请确认格式形如 `a=1; b=2`".to_owned(),
        ));
    }

    let ws = state.workspace()?;
    let mut jar = ws.read_cookies()?;
    let count = cookies.len();
    for cookie in cookies {
        jar.upsert(cookie);
    }
    ws.write_cookies(&jar)?;

    tracing::info!(count, domain = %domain, "已导入 Cookie");
    Ok(count)
}

/// 从粘贴内容里取出 Cookie 头的值。
///
/// 支持三种形态，因为用户不该被要求先把内容整理干净：
/// - 裸的 `a=1; b=2`
/// - `Cookie: a=1; b=2`
/// - 整条 curl 命令，其中含 `-H 'Cookie: ...'` 或 `-b 'a=1'`
pub fn extract_cookie_header(raw: &str) -> String {
    let trimmed = raw.trim();

    // 逐行找 `-H 'Cookie: ...'` / `--header "cookie: ..."` / `-b '...'`
    for line in trimmed.lines() {
        let line = line.trim().trim_end_matches('\\').trim();
        let lower = line.to_ascii_lowercase();

        if let Some(idx) = lower.find("cookie:") {
            let value = &line[idx + "cookie:".len()..];
            return strip_quotes(value).to_owned();
        }
        if let Some(rest) = line
            .strip_prefix("-b ")
            .or_else(|| line.strip_prefix("--cookie "))
        {
            return strip_quotes(rest).to_owned();
        }
    }

    // 都不匹配就当成裸的 Cookie 头值
    strip_quotes(trimmed).to_owned()
}

/// 去掉两端残留的引号。
///
/// 不要求引号成对：从 `-H 'cookie: a=1'` 里截出来的片段只剩尾部那一个引号，
/// 开头那个留在了 `cookie:` 前面。两端各自 trim 才能覆盖这种情况。
fn strip_quotes(s: &str) -> &str {
    s.trim().trim_matches(|c| c == '\'' || c == '"').trim()
}

/// 打开内置登录窗口。用户在其中完成登录后，再调用 [`cookie_capture`] 收取。
#[tauri::command]
pub async fn cookie_login_open(app: AppHandle, url: String) -> Result<()> {
    let target: url::Url = url.parse()?;

    // 已经开着就聚焦，不要越开越多
    if let Some(existing) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        let _ = existing.set_focus();
        let _ = existing.navigate(target);
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, LOGIN_WINDOW_LABEL, WebviewUrl::External(target))
        .title("登录以获取 Cookie —— 完成后回到 PostKiddie 点「收取」")
        .inner_size(1000.0, 720.0)
        .center()
        .build()
        .map_err(|e| Error::Invalid(format!("无法打开登录窗口：{e}")))?;

    Ok(())
}

/// 从登录窗口收取指定 URL 下的 cookie 并保存，返回收到的条数。
///
/// `close_window` 决定收取后是否顺手关掉登录窗口。
#[tauri::command]
pub async fn cookie_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    close_window: bool,
) -> Result<usize> {
    let target: url::Url = url.parse()?;

    let window = app
        .get_webview_window(LOGIN_WINDOW_LABEL)
        .ok_or_else(|| Error::Invalid("登录窗口未打开".to_owned()))?;

    let captured = window
        .cookies_for_url(target.clone())
        .map_err(|e| Error::Invalid(format!("读取登录窗口的 Cookie 失败：{e}")))?;

    let ws = state.workspace()?;
    let mut jar = ws.read_cookies()?;
    let count = merge_captured(&mut jar, captured, &target);
    ws.write_cookies(&jar)?;

    if close_window {
        let _ = window.close();
    }

    tracing::info!(count, url = %url, "已从登录窗口收取 Cookie");
    Ok(count)
}

/// 把 WebView 读到的 cookie 并入罐子，返回并入条数。
///
/// 单独成函数是为了能脱离 Tauri 运行时测试这段转换——
/// 它要处理 domain 前导点、host_only 判定这些容易出错的细节。
pub fn merge_captured(
    jar: &mut CookieJar,
    captured: Vec<WebviewCookie<'static>>,
    target: &url::Url,
) -> usize {
    let fallback_domain = target.host_str().unwrap_or_default().to_ascii_lowercase();
    let mut count = 0;

    for raw in captured {
        // WebView 给的 domain 可能带前导点（表示可跨子域），也可能缺省
        let (domain, host_only) = match raw.domain() {
            Some(d) if !d.is_empty() => {
                let host_only = !d.starts_with('.');
                (d.trim_start_matches('.').to_ascii_lowercase(), host_only)
            }
            _ => (fallback_domain.clone(), true),
        };

        jar.upsert(Cookie {
            name: raw.name().to_owned(),
            value: raw.value().to_owned(),
            domain,
            path: raw.path().unwrap_or("/").to_owned(),
            host_only,
            secure: raw.secure().unwrap_or(false),
            http_only: raw.http_only().unwrap_or(false),
            // WebView 不回传过期时间，按会话 cookie 处理：
            // 宁可留久一点由用户手动清，也别让登录态莫名失效
            expires: None,
        });
        count += 1;
    }

    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_bare_cookie_header() {
        assert_eq!(
            extract_cookie_header("sid=1; theme=dark"),
            "sid=1; theme=dark"
        );
    }

    #[test]
    fn extracts_from_labelled_header() {
        assert_eq!(extract_cookie_header("Cookie: sid=1; a=2"), "sid=1; a=2");
        assert_eq!(extract_cookie_header("cookie: sid=1"), "sid=1");
    }

    /// 浏览器「Copy as cURL」出来的内容应该能直接粘贴
    #[test]
    fn extracts_from_curl_command() {
        let curl = r#"curl 'https://example.com/api/me' \
  -H 'accept: application/json' \
  -H 'cookie: sid=abc123; csrf=xyz' \
  -H 'user-agent: Mozilla/5.0'"#;
        assert_eq!(extract_cookie_header(curl), "sid=abc123; csrf=xyz");
    }

    #[test]
    fn extracts_from_curl_short_flag() {
        let curl = "curl https://example.com \\\n  -b 'sid=abc123'";
        assert_eq!(extract_cookie_header(curl), "sid=abc123");
    }

    #[test]
    fn strips_surrounding_quotes() {
        assert_eq!(extract_cookie_header("\"sid=1\""), "sid=1");
        assert_eq!(extract_cookie_header("'sid=1'"), "sid=1");
    }
}
