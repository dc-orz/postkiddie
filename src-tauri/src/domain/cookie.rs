//! Cookie 模型与匹配规则（RFC 6265）。
//!
//! 放在 `domain` 而非 `http`：匹配规则是纯逻辑，不碰网络也不碰文件系统，
//! 值得被直接单测覆盖——这里的每一条边界都对应过真实世界的安全事故。
//!
//! **Cookie 是登录凭证，等同密码。** 因此：
//! - 只存在本机 `.postkiddie/cookies.yaml`，与密钥同级，绝不进 git
//! - `secure` 的 cookie 不得随明文 HTTP 发出
//! - 域匹配必须严格，否则会把 A 站的会话泄露给 B 站

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cookie {
    pub name: String,
    pub value: String,

    /// 不含前导点。RFC 6265 要求存储时剥掉 `.example.com` 的点，
    /// 是否匹配子域改由 `host_only` 表达。
    pub domain: String,

    #[serde(default = "default_path")]
    pub path: String,

    /// true = 只匹配精确主机（Set-Cookie 未带 Domain 属性时）
    #[serde(default, skip_serializing_if = "is_false")]
    pub host_only: bool,

    /// 只随 HTTPS 发送
    #[serde(default, skip_serializing_if = "is_false")]
    pub secure: bool,

    /// 仅供参考：我们不是浏览器，没有 JS 上下文，但保留它以便如实展示来源
    #[serde(default, skip_serializing_if = "is_false")]
    pub http_only: bool,

    /// RFC 3339 时间戳。None 表示会话 cookie（关闭即失效，我们仍会保留到用户手动清除）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
}

fn default_path() -> String {
    "/".to_owned()
}
fn is_false(v: &bool) -> bool {
    !*v
}

impl Cookie {
    /// 该 cookie 是否应当随这个请求发出。
    ///
    /// `now` 用 RFC 3339 字符串传入而非在函数内取当前时间：纯函数才好测，
    /// 也免得测试依赖真实时钟。
    pub fn matches(&self, url: &url::Url, now: Option<&str>) -> bool {
        let Some(host) = url.host_str() else {
            return false;
        };

        if self.secure && url.scheme() != "https" {
            return false;
        }
        if !domain_matches(host, &self.domain, self.host_only) {
            return false;
        }
        if !path_matches(url.path(), &self.path) {
            return false;
        }
        !self.is_expired(now)
    }

    pub fn is_expired(&self, now: Option<&str>) -> bool {
        match (&self.expires, now) {
            // 字符串比较即可：RFC 3339 的同偏移时间戳字典序与时间序一致。
            // 为避免跨时区误判，双方都规范到 UTC 后再比（见 normalize_rfc3339）。
            (Some(expires), Some(now)) => {
                match (normalize_rfc3339(expires), normalize_rfc3339(now)) {
                    (Some(exp), Some(n)) => exp <= n,
                    // 解析不了就不判过期——宁可多发一个 cookie，也别让用户的会话莫名失效
                    _ => false,
                }
            }
            _ => false,
        }
    }
}

/// 把 RFC 3339 时间戳规范化到 UTC，便于字典序比较。解析失败返回 None。
fn normalize_rfc3339(input: &str) -> Option<String> {
    let ts: jiff::Timestamp = input.parse().ok()?;
    Some(ts.to_string())
}

/// RFC 6265 §5.1.3 domain-match。
///
/// `host_only` 为真时只接受完全相同的主机；否则 cookie 域可以是请求域的后缀，
/// 但必须落在**点分隔的边界**上——否则 `example.com` 的 cookie 会被发给
/// `notexample.com`，这是真实出现过的一类越权。
pub fn domain_matches(host: &str, cookie_domain: &str, host_only: bool) -> bool {
    let host = host.trim_start_matches('.').to_ascii_lowercase();
    let cookie_domain = cookie_domain.trim_start_matches('.').to_ascii_lowercase();

    if host == cookie_domain {
        return true;
    }
    if host_only {
        return false;
    }

    // IP 地址不参与子域匹配：`1.2.3.4` 不该匹配 `2.3.4`
    if host.parse::<std::net::IpAddr>().is_ok() {
        return false;
    }

    host.strip_suffix(&cookie_domain)
        .is_some_and(|prefix| prefix.ends_with('.'))
}

/// RFC 6265 §5.1.4 path-match。
///
/// 同样要落在边界上：cookie-path 为 `/api` 时应匹配 `/api` 与 `/api/v1`，
/// 但不该匹配 `/apirandom`。
pub fn path_matches(request_path: &str, cookie_path: &str) -> bool {
    let request_path = if request_path.is_empty() {
        "/"
    } else {
        request_path
    };
    let cookie_path = if cookie_path.is_empty() {
        "/"
    } else {
        cookie_path
    };

    if request_path == cookie_path {
        return true;
    }
    let Some(rest) = request_path.strip_prefix(cookie_path) else {
        return false;
    };

    cookie_path.ends_with('/') || rest.starts_with('/')
}

/// 把匹配到的 cookie 拼成 `Cookie` 请求头的值。
///
/// 顺序按 RFC 6265 §5.4：path 长的在前；我们不追踪创建时间，
/// 同长度时退化为按名称排序以保证输出稳定（否则每次请求的 header 都可能不同）。
pub fn to_header_value(cookies: &[&Cookie]) -> String {
    let mut sorted: Vec<_> = cookies.to_vec();
    sorted.sort_by(|a, b| {
        b.path
            .len()
            .cmp(&a.path.len())
            .then_with(|| a.name.cmp(&b.name))
    });

    sorted
        .iter()
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ")
}

/// 解析 `Cookie` 请求头风格的字符串：`a=1; b=2`。
///
/// 供「从 DevTools 复制 Cookie 头粘贴进来」这条兜底通道使用。
/// 这种来源只有名值对，域与路径由调用方按目标 URL 补齐。
pub fn parse_cookie_header(raw: &str, domain: &str) -> Vec<Cookie> {
    raw.split(';')
        .filter_map(|pair| {
            let pair = pair.trim();
            if pair.is_empty() {
                return None;
            }
            let (name, value) = pair.split_once('=')?;
            let name = name.trim();
            if name.is_empty() {
                return None;
            }
            Some(Cookie {
                name: name.to_owned(),
                value: value.trim().to_owned(),
                domain: domain.to_ascii_lowercase(),
                path: "/".to_owned(),
                // 手工粘贴的没有 Domain 属性信息，按最严格处理：只匹配该主机
                host_only: true,
                secure: false,
                http_only: false,
                expires: None,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> url::Url {
        s.parse().expect("测试 URL 无效")
    }

    fn cookie(name: &str, domain: &str, path: &str) -> Cookie {
        Cookie {
            name: name.to_owned(),
            value: "v".to_owned(),
            domain: domain.to_owned(),
            path: path.to_owned(),
            host_only: false,
            secure: false,
            http_only: false,
            expires: None,
        }
    }

    // ---- domain-match ----

    #[test]
    fn domain_matches_exact_host() {
        assert!(domain_matches("example.com", "example.com", true));
        assert!(domain_matches("example.com", "example.com", false));
    }

    #[test]
    fn domain_matches_subdomain_only_when_not_host_only() {
        assert!(domain_matches("api.example.com", "example.com", false));
        assert!(!domain_matches("api.example.com", "example.com", true));
    }

    /// 后缀必须落在点边界上，否则 example.com 的会话会被发给 notexample.com
    #[test]
    fn domain_does_not_match_across_label_boundary() {
        assert!(!domain_matches("notexample.com", "example.com", false));
        assert!(!domain_matches("evil-example.com", "example.com", false));
    }

    #[test]
    fn domain_match_ignores_leading_dot_and_case() {
        assert!(domain_matches("API.Example.COM", ".example.com", false));
    }

    /// IP 不做子域匹配：1.2.3.4 与 2.3.4 无从属关系
    #[test]
    fn ip_hosts_never_match_as_subdomain() {
        assert!(!domain_matches("1.2.3.4", "2.3.4", false));
        assert!(domain_matches("1.2.3.4", "1.2.3.4", false));
    }

    // ---- path-match ----

    #[test]
    fn path_matches_prefix_on_boundary() {
        assert!(path_matches("/api", "/api"));
        assert!(path_matches("/api/v1/users", "/api"));
        assert!(path_matches("/anything", "/"));
    }

    #[test]
    fn path_does_not_match_partial_segment() {
        assert!(!path_matches("/apirandom", "/api"));
        assert!(!path_matches("/ap", "/api"));
    }

    #[test]
    fn path_with_trailing_slash_matches_children() {
        assert!(path_matches("/api/v1", "/api/"));
    }

    // ---- 综合匹配 ----

    #[test]
    fn secure_cookie_is_withheld_from_plain_http() {
        let mut c = cookie("sid", "example.com", "/");
        c.secure = true;

        assert!(!c.matches(&url("http://example.com/x"), None));
        assert!(c.matches(&url("https://example.com/x"), None));
    }

    #[test]
    fn expired_cookie_does_not_match() {
        let mut c = cookie("sid", "example.com", "/");
        c.expires = Some("2020-01-01T00:00:00Z".to_owned());

        assert!(c.matches(&url("https://example.com/"), Some("2019-01-01T00:00:00Z")));
        assert!(!c.matches(&url("https://example.com/"), Some("2026-01-01T00:00:00Z")));
    }

    /// 过期判断要跨时区正确：+08:00 的午夜早于 UTC 的午夜
    #[test]
    fn expiry_comparison_normalizes_timezones() {
        let mut c = cookie("sid", "example.com", "/");
        c.expires = Some("2026-01-01T08:00:00+08:00".to_owned()); // = 2026-01-01T00:00:00Z

        // 过期时刻之前仍然有效
        assert!(c.matches(&url("https://example.com/"), Some("2025-12-31T23:00:00Z")));
        assert!(!c.is_expired(Some("2025-12-31T23:59:59Z")));

        // 越过之后失效。若不做时区规范化，字典序会把 "2026-01-01T08:00:00+08:00"
        // 判成晚于 "2026-01-01T00:00:01Z"，于是这条 cookie 会永远不过期。
        assert!(c.is_expired(Some("2026-01-01T00:00:01Z")));
        assert!(!c.matches(&url("https://example.com/"), Some("2026-01-01T00:00:01Z")));
    }

    /// 时间戳解析不了时宁可发出去，也不要让用户的会话莫名其妙失效
    #[test]
    fn unparsable_expiry_is_treated_as_valid() {
        let mut c = cookie("sid", "example.com", "/");
        c.expires = Some("下周三".to_owned());
        assert!(!c.is_expired(Some("2026-01-01T00:00:00Z")));
    }

    // ---- 序列化为请求头 ----

    #[test]
    fn header_orders_longer_paths_first() {
        let a = cookie("a", "example.com", "/");
        let b = cookie("b", "example.com", "/api/v1");
        let c = cookie("c", "example.com", "/api");

        assert_eq!(to_header_value(&[&a, &b, &c]), "b=v; c=v; a=v");
    }

    #[test]
    fn header_output_is_stable_for_equal_paths() {
        let z = cookie("z", "example.com", "/");
        let a = cookie("a", "example.com", "/");
        assert_eq!(to_header_value(&[&z, &a]), "a=v; z=v");
    }

    // ---- 粘贴导入 ----

    #[test]
    fn parses_pasted_cookie_header() {
        let cookies = parse_cookie_header("sid=abc123; theme=dark; ", "example.com");

        assert_eq!(cookies.len(), 2);
        assert_eq!(cookies[0].name, "sid");
        assert_eq!(cookies[0].value, "abc123");
        assert_eq!(cookies[1].name, "theme");
        // 手工粘贴缺少 Domain 属性信息，按最严格处理
        assert!(cookies[0].host_only);
    }

    #[test]
    fn pasted_values_may_contain_equals_sign() {
        // JWT 与 base64 值里带 = 很常见，只能按第一个 = 切分
        let cookies = parse_cookie_header("token=eyJhbGci=ImtpZCI6; x=1", "example.com");
        assert_eq!(cookies[0].value, "eyJhbGci=ImtpZCI6");
        assert_eq!(cookies.len(), 2);
    }

    #[test]
    fn ignores_malformed_pairs() {
        let cookies = parse_cookie_header("; ;novalue; =noname; ok=1", "example.com");
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0].name, "ok");
    }
}
