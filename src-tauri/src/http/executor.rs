//! 请求执行器。
//!
//! 请求由 Rust 侧发出而非 WebView 的 `fetch`，这带来三个 WebView 做不到的能力：
//! 不受 CORS 限制、可自选是否校验 TLS 证书、能拿到未经浏览器加工的原始响应字节。

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use base64::Engine as _;
use serde::Serialize;

use crate::{
    domain::{
        cookie::Cookie,
        model::{ApiKeyPlacement, Auth, HttpMethod, HttpRequest, KeyValue, RequestBody},
    },
    error::{Error, Result},
    storage::{
        cookies::{CookieJar, parse_set_cookie},
        paths::resolve_within,
    },
};

use super::interpolate::VariableScope;

// ---------------------------------------------------------------------------
// 响应模型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    /// 实际发出的最终 URL（跟随重定向后可能与请求 URL 不同）
    pub final_url: String,
    pub headers: Vec<KeyValue>,
    pub body: ResponseBody,
    /// 响应体字节数（解压后）
    pub size_bytes: u32,
    /// 从发起到收完响应体的总耗时
    pub elapsed_ms: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResponseBody {
    /// 可按 UTF-8 解码的内容，直接给前端渲染
    Text {
        content: String,
    },
    /// 二进制内容以 base64 传给前端，由前端决定预览还是另存
    Binary {
        base64: String,
    },
    Empty,
}

// ---------------------------------------------------------------------------
// 客户端缓存
// ---------------------------------------------------------------------------

/// `reqwest::Client` 内含连接池，必须复用——每次新建会让每个请求都重做
/// TCP + TLS 握手，这正是「感觉卡」的常见来源。
///
/// 但重定向策略与证书校验只能在构建期设定，故按这两项组合缓存若干个实例。
#[derive(Debug, Default)]
pub struct ClientPool {
    clients: Mutex<HashMap<ClientKey, reqwest::Client>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct ClientKey {
    verify_tls: bool,
    follow_redirects: bool,
    max_redirects: u8,
    decompress: bool,
}

impl ClientPool {
    pub fn new() -> Self {
        Self::default()
    }

    fn get(&self, key: ClientKey) -> Result<reqwest::Client> {
        let mut clients = self
            .clients
            .lock()
            .map_err(|_| Error::Invalid("HTTP 客户端池状态损坏".to_owned()))?;

        if let Some(client) = clients.get(&key) {
            return Ok(client.clone());
        }

        let redirect = if key.follow_redirects {
            reqwest::redirect::Policy::limited(key.max_redirects as usize)
        } else {
            reqwest::redirect::Policy::none()
        };

        let mut builder = reqwest::Client::builder()
            .redirect(redirect)
            .danger_accept_invalid_certs(!key.verify_tls)
            .user_agent(concat!("PostKiddie/", env!("CARGO_PKG_VERSION")))
            // 连接池空闲超时略高于常见网关的 60s keep-alive
            .pool_idle_timeout(Duration::from_secs(90));

        if !key.decompress {
            builder = builder.no_gzip().no_brotli().no_deflate().no_zstd();
        }

        let client = builder.build()?;
        clients.insert(key, client.clone());
        Ok(client)
    }
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

/// 一次执行的完整结果。
///
/// 把「响应」与「响应带来的 cookie」分开返回，而不是在这里直接写盘：
/// executor 不碰文件系统，是否持久化由命令层决定，这样它才好被单测覆盖。
#[derive(Debug)]
pub struct ExecuteOutcome {
    pub response: HttpResponse,
    /// 响应中 `Set-Cookie` 解析出的 cookie
    pub received_cookies: Vec<Cookie>,
}

/// 发送一个请求。`scope` 需已按优先级合并完毕，`workspace_root` 用于解析 body 引用的文件。
///
/// `jar` 提供要自动附带的 cookie；`now` 是判断过期用的当前时刻（RFC 3339）。
pub async fn execute(
    pool: &ClientPool,
    request: &HttpRequest,
    scope: &VariableScope,
    workspace_root: &Path,
    jar: &CookieJar,
    now: &str,
) -> Result<ExecuteOutcome> {
    let settings = &request.settings;

    let client = pool.get(ClientKey {
        verify_tls: settings.verify_tls,
        follow_redirects: settings.follow_redirects,
        max_redirects: settings.max_redirects,
        decompress: settings.decompress,
    })?;

    let url = build_url(request, scope)?;
    let method = to_reqwest_method(request.method);

    let mut builder = client.request(method, url.clone());

    if settings.timeout_ms > 0 {
        builder = builder.timeout(Duration::from_millis(u64::from(settings.timeout_ms)));
    }

    let mut user_set_cookie_header = false;
    for header in request.headers.iter().filter(|h| h.enabled) {
        let name = scope.expand(&header.name)?;
        if name.eq_ignore_ascii_case("cookie") {
            user_set_cookie_header = true;
        }
        builder = builder.header(name, scope.expand(&header.value)?);
    }

    // 自动附带 cookie。用户手写了 Cookie 头就不插手——那是明确的意图表达，
    // 何况一个请求只能有一个 Cookie 头，硬合并只会产生难以预料的结果。
    if settings.send_cookies
        && !user_set_cookie_header
        && let Some(value) = jar.header_for(&url, Some(now))
    {
        builder = builder.header(reqwest::header::COOKIE, value);
    }

    builder = apply_auth(builder, &request.auth, scope)?;
    builder = apply_body(builder, &request.body, scope, workspace_root).await?;

    let started = Instant::now();
    let response = builder.send().await.map_err(|e| {
        if e.is_timeout() {
            Error::Timeout(settings.timeout_ms)
        } else {
            Error::Http(e)
        }
    })?;

    let status = response.status();
    let final_url = response.url().to_string();
    let headers = collect_headers(response.headers());
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    // Set-Cookie 可以出现多次，必须用 get_all。
    // 以最终 URL 为基准解析：跟随重定向后，cookie 属于落地的那个域。
    let cookie_base: url::Url = final_url.parse().unwrap_or_else(|_| url.clone());
    let received_cookies: Vec<Cookie> = response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|raw| parse_set_cookie(raw, &cookie_base, now))
        .collect();

    let bytes = response.bytes().await?;
    let elapsed_ms = started.elapsed().as_millis() as u32;

    Ok(ExecuteOutcome {
        response: HttpResponse {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").to_owned(),
            final_url,
            headers,
            size_bytes: bytes.len() as u32,
            body: decode_body(&bytes, content_type.as_deref()),
            elapsed_ms,
        },
        received_cookies,
    })
}

/// 合并 `url` 里已有的查询串与 `params` 列表。两者都存在时以 `params` 为准，
/// 因为它是 UI 上可见可编辑的那一份。
fn build_url(request: &HttpRequest, scope: &VariableScope) -> Result<url::Url> {
    let expanded = scope.expand(&request.url)?;
    let trimmed = expanded.trim();

    if trimmed.is_empty() {
        return Err(Error::Invalid("请求 URL 为空".to_owned()));
    }

    // 允许省略协议：用户常直接粘贴 `localhost:8080/api`
    let normalized = if trimmed.contains("://") {
        trimmed.to_owned()
    } else {
        format!("http://{trimmed}")
    };

    let mut url: url::Url = normalized.parse()?;

    let enabled: Vec<_> = request.params.iter().filter(|p| p.enabled).collect();
    if !enabled.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for param in enabled {
            pairs.append_pair(&scope.expand(&param.name)?, &scope.expand(&param.value)?);
        }
    }

    Ok(url)
}

fn to_reqwest_method(method: HttpMethod) -> reqwest::Method {
    match method {
        HttpMethod::Get => reqwest::Method::GET,
        HttpMethod::Post => reqwest::Method::POST,
        HttpMethod::Put => reqwest::Method::PUT,
        HttpMethod::Patch => reqwest::Method::PATCH,
        HttpMethod::Delete => reqwest::Method::DELETE,
        HttpMethod::Head => reqwest::Method::HEAD,
        HttpMethod::Options => reqwest::Method::OPTIONS,
    }
}

fn apply_auth(
    builder: reqwest::RequestBuilder,
    auth: &Auth,
    scope: &VariableScope,
) -> Result<reqwest::RequestBuilder> {
    Ok(match auth {
        // 继承在调用方已解析完毕，到这里仍是 Inherit 说明各层都没配，等同不认证
        Auth::Inherit | Auth::None => builder,

        Auth::Basic { username, password } => {
            builder.basic_auth(scope.expand(username)?, Some(scope.expand(password)?))
        }

        Auth::Bearer { token } => builder.bearer_auth(scope.expand(token)?),

        Auth::ApiKey {
            key,
            value,
            placement,
        } => {
            let (k, v) = (scope.expand(key)?, scope.expand(value)?);
            match placement {
                ApiKeyPlacement::Header => builder.header(k, v),
                ApiKeyPlacement::Query => builder.query(&[(k, v)]),
            }
        }
    })
}

async fn apply_body(
    builder: reqwest::RequestBuilder,
    body: &RequestBody,
    scope: &VariableScope,
    root: &Path,
) -> Result<reqwest::RequestBuilder> {
    // Content-Type 用 `header` 而非 `.json()`/`.form()` 显式设置，
    // 以便用户在 headers 里手写的同名值仍能覆盖（reqwest 后设置的生效）。
    Ok(match body {
        RequestBody::None => builder,

        RequestBody::Json { content } => builder
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(scope.expand(content)?),

        RequestBody::Text {
            content,
            content_type,
        } => builder
            .header(
                reqwest::header::CONTENT_TYPE,
                content_type
                    .as_deref()
                    .unwrap_or("text/plain; charset=utf-8"),
            )
            .body(scope.expand(content)?),

        RequestBody::Xml { content } => builder
            .header(reqwest::header::CONTENT_TYPE, "application/xml")
            .body(scope.expand(content)?),

        RequestBody::FormUrlencoded { fields } => {
            let pairs: Vec<(String, String)> = fields
                .iter()
                .filter(|f| f.enabled)
                .map(|f| Ok((scope.expand(&f.name)?, scope.expand(&f.value)?)))
                .collect::<Result<_>>()?;
            builder.form(&pairs)
        }

        RequestBody::Multipart { fields } => {
            let mut form = reqwest::multipart::Form::new();
            for field in fields.iter().filter(|f| f.enabled) {
                let name = scope.expand(&field.name)?;

                if let Some(file) = &field.file {
                    let path = resolve_within(root, &scope.expand(file)?)?;
                    let bytes = tokio::fs::read(&path).await?;
                    let file_name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_else(|| "file".to_owned());

                    let mime = field.content_type.clone().unwrap_or_else(|| {
                        mime_guess::from_path(&path)
                            .first_or_octet_stream()
                            .to_string()
                    });

                    let part = reqwest::multipart::Part::bytes(bytes)
                        .file_name(file_name)
                        .mime_str(&mime)
                        .map_err(|e| Error::Invalid(format!("MIME 类型无效：{e}")))?;
                    form = form.part(name, part);
                } else {
                    form = form.text(name, scope.expand(field.value.as_deref().unwrap_or(""))?);
                }
            }
            builder.multipart(form)
        }

        RequestBody::Binary { file, content_type } => {
            let path: PathBuf = resolve_within(root, &scope.expand(file)?)?;
            let bytes = tokio::fs::read(&path).await?;
            let mime = content_type.clone().unwrap_or_else(|| {
                mime_guess::from_path(&path)
                    .first_or_octet_stream()
                    .to_string()
            });
            builder
                .header(reqwest::header::CONTENT_TYPE, mime)
                .body(bytes)
        }

        RequestBody::Graphql {
            query,
            variables,
            operation_name,
        } => {
            let mut payload = serde_json::Map::new();
            payload.insert("query".into(), scope.expand(query)?.into());

            if let Some(vars) = variables {
                let expanded = scope.expand(vars)?;
                let trimmed = expanded.trim();
                if !trimmed.is_empty() {
                    payload.insert("variables".into(), serde_json::from_str(trimmed)?);
                }
            }
            if let Some(name) = operation_name {
                payload.insert("operationName".into(), scope.expand(name)?.into());
            }

            builder
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(serde_json::to_vec(&payload)?)
        }
    })
}

fn collect_headers(headers: &reqwest::header::HeaderMap) -> Vec<KeyValue> {
    headers
        .iter()
        .map(|(name, value)| KeyValue {
            name: name.as_str().to_owned(),
            // 非 UTF-8 的 header 值不该导致整个响应失败，退化为 lossy 展示
            value: String::from_utf8_lossy(value.as_bytes()).into_owned(),
            enabled: true,
            description: None,
        })
        .collect()
}

/// 判定响应体能否按文本展示。
///
/// 不只看 content-type：很多服务返回 `application/octet-stream` 却装着 JSON，
/// 也有服务给二进制打上 `text/plain`。以「能否 UTF-8 解码」作为最终判据更可靠。
fn decode_body(bytes: &[u8], content_type: Option<&str>) -> ResponseBody {
    if bytes.is_empty() {
        return ResponseBody::Empty;
    }

    let declared_binary = content_type.is_some_and(|ct| {
        let ct = ct.to_ascii_lowercase();
        ct.starts_with("image/")
            || ct.starts_with("audio/")
            || ct.starts_with("video/")
            || ct.starts_with("application/pdf")
            || ct.starts_with("application/zip")
    });

    if declared_binary {
        return ResponseBody::Binary {
            base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        };
    }

    match std::str::from_utf8(bytes) {
        Ok(text) => ResponseBody::Text {
            content: text.to_owned(),
        },
        Err(_) => ResponseBody::Binary {
            base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> VariableScope {
        let mut s = VariableScope::new();
        s.extend([("baseUrl", "https://api.example.com")]);
        s
    }

    #[test]
    fn prepends_http_when_scheme_missing() {
        let req = HttpRequest {
            url: "localhost:8080/api".to_owned(),
            ..Default::default()
        };
        let url = build_url(&req, &VariableScope::new()).unwrap();
        assert_eq!(url.as_str(), "http://localhost:8080/api");
    }

    #[test]
    fn merges_params_into_url() {
        let req = HttpRequest {
            url: "{{baseUrl}}/search?existing=1".to_owned(),
            params: vec![KeyValue {
                name: "q".to_owned(),
                value: "kiddie".to_owned(),
                enabled: true,
                description: None,
            }],
            ..Default::default()
        };
        let url = build_url(&req, &scope()).unwrap();
        assert!(url.query().unwrap().contains("existing=1"));
        assert!(url.query().unwrap().contains("q=kiddie"));
    }

    #[test]
    fn skips_disabled_params() {
        let req = HttpRequest {
            url: "{{baseUrl}}/x".to_owned(),
            params: vec![KeyValue {
                name: "debug".to_owned(),
                value: "1".to_owned(),
                enabled: false,
                description: None,
            }],
            ..Default::default()
        };
        assert!(build_url(&req, &scope()).unwrap().query().is_none());
    }

    #[test]
    fn rejects_empty_url() {
        let req = HttpRequest::default();
        assert!(build_url(&req, &VariableScope::new()).is_err());
    }

    /// content-type 声称二进制但内容是合法 UTF-8 时，仍按文本展示
    #[test]
    fn decodes_utf8_despite_octet_stream() {
        let body = decode_body(b"{\"ok\":true}", Some("application/octet-stream"));
        assert!(matches!(body, ResponseBody::Text { .. }));
    }

    #[test]
    fn encodes_invalid_utf8_as_base64() {
        let body = decode_body(&[0xff, 0xfe, 0x00], Some("text/plain"));
        assert!(matches!(body, ResponseBody::Binary { .. }));
    }

    #[test]
    fn treats_images_as_binary() {
        let body = decode_body(b"fake-png-bytes", Some("image/png"));
        assert!(matches!(body, ResponseBody::Binary { .. }));
    }

    #[test]
    fn empty_body_is_empty_variant() {
        assert!(matches!(decode_body(b"", None), ResponseBody::Empty));
    }
}
