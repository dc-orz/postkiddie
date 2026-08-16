//! Cookie 罐：持久化、按 URL 取用、以及从 `Set-Cookie` 回存。
//!
//! 存放位置是 `.postkiddie/cookies.yaml`，与密钥同级、同样被 gitignore。
//! **这一点没有商量余地**：cookie 就是登录凭证，推到远端等同于把账号交出去，
//! 而 git 历史里的东西撤不干净。

use serde::{Deserialize, Serialize};

use crate::domain::cookie::Cookie;

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CookieJar {
    #[serde(default)]
    pub cookies: Vec<Cookie>,
}

impl CookieJar {
    /// 取出应当随该请求发出的 cookie
    pub fn matching(&self, url: &url::Url, now: Option<&str>) -> Vec<&Cookie> {
        self.cookies
            .iter()
            .filter(|c| c.matches(url, now))
            .collect()
    }

    /// 直接拼好 `Cookie` 请求头的值；没有可发的返回 None
    pub fn header_for(&self, url: &url::Url, now: Option<&str>) -> Option<String> {
        let matched = self.matching(url, now);
        if matched.is_empty() {
            return None;
        }
        Some(crate::domain::cookie::to_header_value(&matched))
    }

    /// 插入或覆盖。
    ///
    /// 身份是 (name, domain, path) 三元组——这是 RFC 6265 的定义。
    /// 只按 name 去重会导致 `example.com` 与 `api.example.com` 的同名 cookie 互相顶掉。
    pub fn upsert(&mut self, cookie: Cookie) {
        let key = |c: &Cookie| (c.name.clone(), c.domain.clone(), c.path.clone());
        let incoming = key(&cookie);

        match self.cookies.iter_mut().find(|c| key(c) == incoming) {
            Some(existing) => *existing = cookie,
            None => self.cookies.push(cookie),
        }
    }

    pub fn remove(&mut self, name: &str, domain: &str, path: &str) {
        self.cookies
            .retain(|c| !(c.name == name && c.domain == domain && c.path == path));
    }

    /// 清掉某个域（含其子域）的全部 cookie，即「退出登录」
    pub fn clear_domain(&mut self, domain: &str) {
        let target = domain.trim_start_matches('.').to_ascii_lowercase();
        self.cookies.retain(|c| {
            let d = c.domain.trim_start_matches('.').to_ascii_lowercase();
            d != target && !d.ends_with(&format!(".{target}"))
        });
    }

    /// 丢弃已过期的条目，返回清理掉的数量
    pub fn purge_expired(&mut self, now: &str) -> usize {
        let before = self.cookies.len();
        self.cookies.retain(|c| !c.is_expired(Some(now)));
        before - self.cookies.len()
    }

    /// 按域分组，供 UI 展示。同一域下按名称排序，保证顺序稳定。
    pub fn grouped_by_domain(&self) -> Vec<(String, Vec<Cookie>)> {
        let mut map: std::collections::BTreeMap<String, Vec<Cookie>> = Default::default();
        for c in &self.cookies {
            map.entry(c.domain.clone()).or_default().push(c.clone());
        }
        for list in map.values_mut() {
            list.sort_by(|a, b| a.name.cmp(&b.name));
        }
        map.into_iter().collect()
    }
}

/// 解析一条 `Set-Cookie` 响应头。
///
/// `request_url` 用于在响应没给 Domain/Path 时补默认值——
/// 这正是 RFC 6265 §5.3 的要求，也是 `host_only` 的来源：
/// 没有 Domain 属性的 cookie 只对该主机生效，不下发给子域。
pub fn parse_set_cookie(raw: &str, request_url: &url::Url, now: &str) -> Option<Cookie> {
    let mut parts = raw.split(';');

    let (name, value) = parts.next()?.trim().split_once('=')?;
    let name = name.trim();
    if name.is_empty() {
        return None;
    }

    let mut cookie = Cookie {
        name: name.to_owned(),
        value: value.trim().to_owned(),
        domain: request_url.host_str()?.to_ascii_lowercase(),
        path: default_path_for(request_url),
        host_only: true,
        secure: false,
        http_only: false,
        expires: None,
    };

    // Max-Age 优先于 Expires（RFC 6265 §5.2.2），故单独记下来最后再套用
    let mut max_age: Option<i64> = None;

    for attr in parts {
        let attr = attr.trim();
        let (key, val) = match attr.split_once('=') {
            Some((k, v)) => (k.trim().to_ascii_lowercase(), v.trim()),
            None => (attr.to_ascii_lowercase(), ""),
        };

        match key.as_str() {
            "domain" if !val.is_empty() => {
                cookie.domain = val.trim_start_matches('.').to_ascii_lowercase();
                // 显式给了 Domain，就意味着允许子域共享
                cookie.host_only = false;
            }
            "path" if val.starts_with('/') => cookie.path = val.to_owned(),
            "secure" => cookie.secure = true,
            "httponly" => cookie.http_only = true,
            "max-age" => max_age = val.parse().ok(),
            "expires" => cookie.expires = parse_http_date(val),
            _ => {}
        }
    }

    if let Some(seconds) = max_age {
        cookie.expires = if seconds <= 0 {
            // Max-Age<=0 表示立即删除，落一个过去的时刻让它自然失效
            Some("1970-01-01T00:00:00Z".to_owned())
        } else {
            now.parse::<jiff::Timestamp>()
                .ok()
                .and_then(|t| t.checked_add(jiff::Span::new().seconds(seconds)).ok())
                .map(|t| t.to_string())
        };
    }

    Some(cookie)
}

/// RFC 6265 §5.1.4：默认 path 是请求路径去掉最后一段
fn default_path_for(url: &url::Url) -> String {
    let path = url.path();
    match path.rfind('/') {
        Some(0) | None => "/".to_owned(),
        Some(i) => path[..i].to_owned(),
    }
}

/// 解析 HTTP-date，如 `Wed, 21 Oct 2026 07:28:00 GMT`。
///
/// 按 civil 时间解析再显式赋予 UTC，而不是让格式串去匹配 `GMT`：
/// `GMT` 在格式里只是字面量，不携带偏移信息，`Timestamp::strptime` 无从确定时刻。
/// 而 RFC 7231 规定 HTTP-date 恒以 GMT 表示，当作 UTC 是安全的。
fn parse_http_date(raw: &str) -> Option<String> {
    // 少数服务端沿用 Netscape 旧格式，用 `-` 连接日期；统一成空格
    let normalized = raw.replace('-', " ");
    let trimmed = normalized
        .trim()
        .trim_end_matches("GMT")
        .trim_end_matches("UTC")
        .trim();

    for fmt in ["%a, %d %b %Y %H:%M:%S", "%a, %d %b %y %H:%M:%S"] {
        if let Ok(dt) = jiff::civil::DateTime::strptime(fmt, trimmed)
            && let Ok(zoned) = dt.to_zoned(jiff::tz::TimeZone::UTC)
        {
            return Some(zoned.timestamp().to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> url::Url {
        s.parse().unwrap()
    }
    const NOW: &str = "2026-01-01T00:00:00Z";

    fn jar_with(cookies: Vec<Cookie>) -> CookieJar {
        CookieJar { cookies }
    }

    fn simple(name: &str, domain: &str) -> Cookie {
        Cookie {
            name: name.to_owned(),
            value: "v".to_owned(),
            domain: domain.to_owned(),
            path: "/".to_owned(),
            host_only: false,
            secure: false,
            http_only: false,
            expires: None,
        }
    }

    // ---- Set-Cookie 解析 ----

    #[test]
    fn parses_minimal_set_cookie() {
        let c = parse_set_cookie("sid=abc123", &url("https://example.com/login"), NOW).unwrap();

        assert_eq!(c.name, "sid");
        assert_eq!(c.value, "abc123");
        assert_eq!(c.domain, "example.com");
        // 没有 Domain 属性 → 只对该主机生效
        assert!(c.host_only);
    }

    #[test]
    fn parses_all_attributes() {
        let raw = "sid=x; Domain=.example.com; Path=/api; Secure; HttpOnly; \
                   Expires=Wed, 21 Oct 2026 07:28:00 GMT";
        let c = parse_set_cookie(raw, &url("https://api.example.com/login"), NOW).unwrap();

        assert_eq!(c.domain, "example.com", "存储时应剥掉前导点");
        assert!(!c.host_only, "给了 Domain 就允许子域共享");
        assert_eq!(c.path, "/api");
        assert!(c.secure);
        assert!(c.http_only);
        assert_eq!(c.expires.as_deref(), Some("2026-10-21T07:28:00Z"));
    }

    #[test]
    fn max_age_wins_over_expires() {
        let raw = "sid=x; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Max-Age=3600";
        let c = parse_set_cookie(raw, &url("https://example.com/"), NOW).unwrap();
        assert_eq!(c.expires.as_deref(), Some("2026-01-01T01:00:00Z"));
    }

    /// Max-Age=0 是服务端删除 cookie 的标准手段
    #[test]
    fn zero_max_age_expires_immediately() {
        let c = parse_set_cookie("sid=; Max-Age=0", &url("https://example.com/"), NOW).unwrap();
        assert!(c.is_expired(Some(NOW)));
    }

    #[test]
    fn default_path_drops_last_segment() {
        let c = parse_set_cookie("a=1", &url("https://example.com/api/v1/login"), NOW).unwrap();
        assert_eq!(c.path, "/api/v1");

        let c = parse_set_cookie("a=1", &url("https://example.com/login"), NOW).unwrap();
        assert_eq!(c.path, "/");
    }

    #[test]
    fn value_may_be_empty_or_contain_equals() {
        let c = parse_set_cookie("token=a=b=c", &url("https://example.com/"), NOW).unwrap();
        assert_eq!(c.value, "a=b=c");

        let c = parse_set_cookie("sid=", &url("https://example.com/"), NOW).unwrap();
        assert_eq!(c.value, "");
    }

    // ---- jar 行为 ----

    #[test]
    fn upsert_keys_on_name_domain_path() {
        let mut jar = CookieJar::default();
        jar.upsert(simple("sid", "example.com"));
        jar.upsert(simple("sid", "api.example.com"));
        assert_eq!(jar.cookies.len(), 2, "不同域的同名 cookie 不该互相顶掉");

        let mut updated = simple("sid", "example.com");
        updated.value = "new".to_owned();
        jar.upsert(updated);

        assert_eq!(jar.cookies.len(), 2);
        let c = jar
            .cookies
            .iter()
            .find(|c| c.domain == "example.com")
            .unwrap();
        assert_eq!(c.value, "new");
    }

    #[test]
    fn header_includes_only_matching_cookies() {
        let jar = jar_with(vec![
            simple("a", "example.com"),
            simple("b", "other.com"),
            simple("c", "api.example.com"),
        ]);

        let header = jar
            .header_for(&url("https://api.example.com/x"), None)
            .unwrap();
        // a 来自父域（非 host_only），c 来自精确匹配；b 属于别的站点
        assert!(header.contains("a=v"));
        assert!(header.contains("c=v"));
        assert!(!header.contains("b=v"));
    }

    #[test]
    fn header_is_none_when_nothing_matches() {
        let jar = jar_with(vec![simple("a", "other.com")]);
        assert!(jar.header_for(&url("https://example.com/"), None).is_none());
    }

    #[test]
    fn clear_domain_also_drops_subdomains() {
        let mut jar = jar_with(vec![
            simple("a", "example.com"),
            simple("b", "api.example.com"),
            simple("c", "notexample.com"),
        ]);

        jar.clear_domain("example.com");

        assert_eq!(jar.cookies.len(), 1);
        assert_eq!(
            jar.cookies[0].domain, "notexample.com",
            "不得误伤名字相近的域"
        );
    }

    #[test]
    fn purge_expired_removes_only_stale_entries() {
        let mut fresh = simple("fresh", "example.com");
        fresh.expires = Some("2030-01-01T00:00:00Z".to_owned());
        let mut stale = simple("stale", "example.com");
        stale.expires = Some("2020-01-01T00:00:00Z".to_owned());

        let mut jar = jar_with(vec![fresh, stale, simple("session", "example.com")]);
        let removed = jar.purge_expired(NOW);

        assert_eq!(removed, 1);
        assert_eq!(jar.cookies.len(), 2);
        assert!(jar.cookies.iter().all(|c| c.name != "stale"));
    }

    #[test]
    fn groups_by_domain_with_stable_order() {
        let jar = jar_with(vec![
            simple("z", "b.com"),
            simple("a", "b.com"),
            simple("x", "a.com"),
        ]);

        let groups = jar.grouped_by_domain();
        assert_eq!(groups[0].0, "a.com");
        assert_eq!(groups[1].0, "b.com");
        assert_eq!(
            groups[1]
                .1
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "z"]
        );
    }
}
