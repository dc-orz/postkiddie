//! Postman Collection v2.1 导入。
//!
//! 用 `serde_json::Value` 宽松遍历而非定义完整结构体：导出的集合里塞着大量
//! 我们不关心的字段（`_postman_id`、`event`、`protocolProfileBehavior`、
//! 各种插件写入的自定义键），而且不同版本的形状略有出入。
//! 严格结构体会因为一个对不上的字段让整份集合导不进来，代价不成比例。
//!
//! 一处幸运的巧合：Postman 的变量语法也是 `{{var}}`，与本应用一致，
//! URL 与请求体里的占位符原样搬过来就能用，不需要任何转写。

use serde_json::Value;

use crate::{
    domain::model::{ApiKeyPlacement, Auth, HttpMethod, HttpRequest, KeyValue, RequestBody},
    error::{Error, Result},
};

/// 导入结果的一个节点。刻意不复用 `TreeNode`——那个是「磁盘上已有什么」，
/// 这个是「打算写下去什么」，两者的生命周期与字段都不同。
#[derive(Debug, Clone, PartialEq)]
pub enum ImportedItem {
    Folder {
        name: String,
        children: Vec<ImportedItem>,
    },
    Request(Box<HttpRequest>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImportedCollection {
    pub name: String,
    pub items: Vec<ImportedItem>,
}

impl ImportedCollection {
    /// 请求总数（递归）。用于给用户一个「导入了多少条」的交代。
    pub fn request_count(&self) -> usize {
        fn count(items: &[ImportedItem]) -> usize {
            items
                .iter()
                .map(|item| match item {
                    ImportedItem::Request(_) => 1,
                    ImportedItem::Folder { children, .. } => count(children),
                })
                .sum()
        }
        count(&self.items)
    }
}

pub fn parse_collection(json: &str) -> Result<ImportedCollection> {
    let root: Value = serde_json::from_str(json)?;

    // 只认 v2 系列。v1 的结构完全不同（扁平 requests 数组 + folders 引用 id），
    // 与其半懂不懂地导错，不如明确告诉用户先在 Postman 里转换一次。
    let schema = root
        .get("info")
        .and_then(|i| i.get("schema"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !schema.contains("v2.") {
        return Err(Error::Invalid(
            "只支持 Postman Collection v2 格式。请在 Postman 中以 v2.1 重新导出。".to_owned(),
        ));
    }

    let name = root
        .get("info")
        .and_then(|i| i.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("Postman 集合")
        .to_owned();

    let items = root
        .get("item")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(parse_item).collect())
        .unwrap_or_default();

    Ok(ImportedCollection { name, items })
}

/// 单个 item：有 `item` 数组的是文件夹，有 `request` 的是请求，两者都没有就跳过。
fn parse_item(value: &Value) -> Option<ImportedItem> {
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("未命名")
        .to_owned();

    if let Some(children) = value.get("item").and_then(Value::as_array) {
        return Some(ImportedItem::Folder {
            name,
            children: children.iter().filter_map(parse_item).collect(),
        });
    }

    let request = value.get("request")?;
    Some(ImportedItem::Request(Box::new(parse_request(
        name, request,
    ))))
}

fn parse_request(name: String, request: &Value) -> HttpRequest {
    // Postman 允许 request 直接是一个 URL 字符串（老式简写）
    if let Some(url) = request.as_str() {
        return HttpRequest {
            name,
            url: url.to_owned(),
            ..Default::default()
        };
    }

    let method = request
        .get("method")
        .and_then(Value::as_str)
        .map(parse_method)
        .unwrap_or_default();

    let (url, params) = parse_url(request.get("url"));

    HttpRequest {
        name,
        method,
        url,
        description: request
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_owned),
        params,
        headers: parse_key_values(request.get("header")),
        body: parse_body(request.get("body")),
        auth: parse_auth(request.get("auth")),
        ..Default::default()
    }
}

fn parse_method(raw: &str) -> HttpMethod {
    match raw.to_ascii_uppercase().as_str() {
        "POST" => HttpMethod::Post,
        "PUT" => HttpMethod::Put,
        "PATCH" => HttpMethod::Patch,
        "DELETE" => HttpMethod::Delete,
        "HEAD" => HttpMethod::Head,
        "OPTIONS" => HttpMethod::Options,
        // 认不出的（Postman 允许自定义方法）退回 GET，至少请求能打开而不是整条丢失
        _ => HttpMethod::Get,
    }
}

/// 拆 URL：返回「不含查询串的 URL」与「查询参数表」。
///
/// Postman 同时存 `raw` 和拆解后的结构，且 `raw` 里已经带着启用的 query。
/// 若照搬 raw 又把 query 数组也填进 params，参数就会发两遍。
/// 这里统一以 query 数组为准、从 raw 上摘掉查询串——参数在本应用里是可勾选的表格，
/// 拆开才能编辑，也才看得见 Postman 里那些被禁用的参数。
fn parse_url(url: Option<&Value>) -> (String, Vec<KeyValue>) {
    let Some(url) = url else {
        return (String::new(), Vec::new());
    };

    if let Some(raw) = url.as_str() {
        return (raw.to_owned(), Vec::new());
    }

    let raw = url
        .get("raw")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();

    let params = parse_key_values(url.get("query"));

    // 只有确实解析出了参数才截断，否则 `?` 出现在别处（如变量里）会误伤
    let base = if params.is_empty() {
        raw
    } else {
        raw.split_once('?')
            .map_or(raw.clone(), |(l, _)| l.to_owned())
    };

    (base, params)
}

/// header / query / form 字段共用的形状：`{key, value, disabled, description}`
fn parse_key_values(value: Option<&Value>) -> Vec<KeyValue> {
    value
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let name = item.get("key").and_then(Value::as_str)?.to_owned();
                    Some(KeyValue {
                        name,
                        value: item
                            .get("value")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned(),
                        // Postman 记的是 disabled，我们记的是 enabled，取反
                        enabled: !item
                            .get("disabled")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        description: item
                            .get("description")
                            .and_then(Value::as_str)
                            .filter(|s| !s.is_empty())
                            .map(str::to_owned),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_body(body: Option<&Value>) -> RequestBody {
    let Some(body) = body else {
        return RequestBody::None;
    };

    let mode = body.get("mode").and_then(Value::as_str).unwrap_or_default();
    let raw = || {
        body.get("raw")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned()
    };

    match mode {
        "raw" => {
            // Postman 把「这段 raw 是什么语言」藏在 options.raw.language 里，
            // 没有它就无从知道该按 JSON 还是纯文本对待
            let language = body
                .get("options")
                .and_then(|o| o.get("raw"))
                .and_then(|r| r.get("language"))
                .and_then(Value::as_str)
                .unwrap_or("text");

            match language {
                "json" => RequestBody::Json { content: raw() },
                "xml" => RequestBody::Xml { content: raw() },
                _ => RequestBody::Text {
                    content: raw(),
                    content_type: None,
                },
            }
        }
        "urlencoded" => RequestBody::FormUrlencoded {
            fields: parse_key_values(body.get("urlencoded")),
        },
        "formdata" => RequestBody::Multipart {
            fields: parse_multipart(body.get("formdata")),
        },
        "graphql" => RequestBody::Graphql {
            query: body
                .get("graphql")
                .and_then(|g| g.get("query"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            variables: body
                .get("graphql")
                .and_then(|g| g.get("variables"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            operation_name: None,
        },
        // file 模式存的是导出者机器上的绝对路径，换台机器必然失效。
        // 保留路径让用户看得见「这里原本要传一个文件」，比静默丢成空 body 强。
        "file" => RequestBody::Binary {
            file: body
                .get("file")
                .and_then(|f| f.get("src"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            content_type: None,
        },
        _ => RequestBody::None,
    }
}

fn parse_multipart(value: Option<&Value>) -> Vec<crate::domain::model::MultipartField> {
    use crate::domain::model::MultipartField;

    value
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let name = item.get("key").and_then(Value::as_str)?.to_owned();
                    let is_file = item.get("type").and_then(Value::as_str) == Some("file");

                    Some(MultipartField {
                        name,
                        value: (!is_file)
                            .then(|| item.get("value").and_then(Value::as_str))
                            .flatten()
                            .map(str::to_owned),
                        // src 可能是数组（多文件），我们一次只支持一个，取第一个
                        file: is_file
                            .then(|| {
                                item.get("src").and_then(|s| {
                                    s.as_str().map(str::to_owned).or_else(|| {
                                        s.as_array()?.first()?.as_str().map(str::to_owned)
                                    })
                                })
                            })
                            .flatten(),
                        content_type: item
                            .get("contentType")
                            .and_then(Value::as_str)
                            .map(str::to_owned),
                        enabled: !item
                            .get("disabled")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Postman 把认证参数存成 `[{key, value}]` 数组而非对象，取值要按 key 找。
fn auth_param(auth: &Value, kind: &str, key: &str) -> String {
    auth.get(kind)
        .and_then(Value::as_array)
        .and_then(|arr| {
            arr.iter()
                .find(|p| p.get("key").and_then(Value::as_str) == Some(key))
                .and_then(|p| p.get("value"))
                .and_then(Value::as_str)
        })
        .unwrap_or_default()
        .to_owned()
}

fn parse_auth(auth: Option<&Value>) -> Auth {
    // 没有 auth 字段意味着「跟随父级」，这与本应用的 Inherit 语义一致
    let Some(auth) = auth else {
        return Auth::Inherit;
    };

    match auth.get("type").and_then(Value::as_str).unwrap_or_default() {
        "noauth" => Auth::None,
        "basic" => Auth::Basic {
            username: auth_param(auth, "basic", "username"),
            password: auth_param(auth, "basic", "password"),
        },
        "bearer" => Auth::Bearer {
            token: auth_param(auth, "bearer", "token"),
        },
        "apikey" => {
            let placement = if auth_param(auth, "apikey", "in") == "query" {
                ApiKeyPlacement::Query
            } else {
                ApiKeyPlacement::Header
            };
            Auth::ApiKey {
                key: auth_param(auth, "apikey", "key"),
                value: auth_param(auth, "apikey", "value"),
                placement,
            }
        }
        // oauth2、awsv4、ntlm 等暂不支持。返回 Inherit 而非 None：
        // 请求本身仍然导进来了，用户补一下认证就能用，丢掉整条才是损失。
        _ => Auth::Inherit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

    fn collection(items: &str) -> String {
        format!(r#"{{"info":{{"name":"我的集合","schema":"{SCHEMA}"}},"item":{items}}}"#)
    }

    #[test]
    fn rejects_v1_with_actionable_message() {
        let json = r#"{"info":{"name":"x","schema":"https://schema.getpostman.com/json/collection/v1.0.0/collection.json"},"item":[]}"#;
        let err = parse_collection(json).unwrap_err();
        assert!(err.to_string().contains("v2.1"), "应当指明该怎么办：{err}");
    }

    #[test]
    fn parses_nested_folders() {
        let json = collection(
            r#"[{"name":"用户","item":[
                {"name":"详情","request":{"method":"GET","url":{"raw":"{{baseUrl}}/users/1"}}},
                {"name":"子目录","item":[{"name":"深层","request":{"method":"GET","url":"/deep"}}]}
            ]}]"#,
        );

        let parsed = parse_collection(&json).unwrap();
        assert_eq!(parsed.name, "我的集合");
        assert_eq!(parsed.request_count(), 2);

        let ImportedItem::Folder { name, children } = &parsed.items[0] else {
            panic!("应为文件夹");
        };
        assert_eq!(name, "用户");
        assert_eq!(children.len(), 2);
    }

    /// `{{var}}` 两边同构，原样搬运即可
    #[test]
    fn keeps_variable_syntax_as_is() {
        let json = collection(
            r#"[{"name":"t","request":{"method":"GET","url":{"raw":"{{baseUrl}}/x"}}}]"#,
        );
        let ImportedItem::Request(req) = &parse_collection(&json).unwrap().items[0] else {
            panic!("应为请求");
        };
        assert_eq!(req.url, "{{baseUrl}}/x");
    }

    /// 回归测试：raw 里已经带着启用的 query，若不摘掉就会连同 params 发两遍
    #[test]
    fn query_moves_out_of_url_into_params() {
        let json = collection(
            r#"[{"name":"t","request":{"method":"GET","url":{
                "raw":"https://x.com/search?q=cat&page=2",
                "query":[{"key":"q","value":"cat"},{"key":"page","value":"2"},
                         {"key":"debug","value":"1","disabled":true}]
            }}}]"#,
        );

        let ImportedItem::Request(req) = &parse_collection(&json).unwrap().items[0] else {
            panic!("应为请求");
        };
        assert_eq!(req.url, "https://x.com/search", "查询串必须从 URL 上摘掉");
        assert_eq!(req.params.len(), 3);
        assert!(req.params[0].enabled);
        assert!(!req.params[2].enabled, "disabled 应翻转为 enabled: false");
    }

    #[test]
    fn header_disabled_flips_to_enabled() {
        let json = collection(
            r#"[{"name":"t","request":{"method":"GET","url":"/x","header":[
                {"key":"Accept","value":"application/json"},
                {"key":"X-Debug","value":"1","disabled":true}
            ]}}]"#,
        );
        let ImportedItem::Request(req) = &parse_collection(&json).unwrap().items[0] else {
            panic!("应为请求");
        };
        assert!(req.headers[0].enabled);
        assert!(!req.headers[1].enabled);
    }

    /// raw 模式要靠 options.raw.language 才知道是 JSON 还是纯文本
    #[test]
    fn raw_body_language_decides_kind() {
        let mk = |options: &str| {
            collection(&format!(
                r#"[{{"name":"t","request":{{"method":"POST","url":"/x",
                    "body":{{"mode":"raw","raw":"{{\"a\":1}}"{options}}}}}}}]"#
            ))
        };

        let json = mk(r#","options":{"raw":{"language":"json"}}"#);
        let ImportedItem::Request(req) = &parse_collection(&json).unwrap().items[0] else {
            panic!()
        };
        assert!(matches!(req.body, RequestBody::Json { .. }));

        // 没有 options 时不猜，按纯文本处理
        let json = mk("");
        let ImportedItem::Request(req) = &parse_collection(&json).unwrap().items[0] else {
            panic!()
        };
        assert!(matches!(req.body, RequestBody::Text { .. }));
    }

    #[test]
    fn parses_auth_variants() {
        let cases = [
            (
                r#"{"type":"bearer","bearer":[{"key":"token","value":"tk"}]}"#,
                Auth::Bearer {
                    token: "tk".to_owned(),
                },
            ),
            (
                r#"{"type":"basic","basic":[{"key":"username","value":"u"},{"key":"password","value":"p"}]}"#,
                Auth::Basic {
                    username: "u".to_owned(),
                    password: "p".to_owned(),
                },
            ),
            (
                r#"{"type":"apikey","apikey":[{"key":"key","value":"X-Key"},{"key":"value","value":"v"},{"key":"in","value":"query"}]}"#,
                Auth::ApiKey {
                    key: "X-Key".to_owned(),
                    value: "v".to_owned(),
                    placement: ApiKeyPlacement::Query,
                },
            ),
            (r#"{"type":"noauth"}"#, Auth::None),
            // 不支持的类型不该让请求整条丢失
            (r#"{"type":"oauth2"}"#, Auth::Inherit),
        ];

        for (auth_json, expected) in cases {
            let json = collection(&format!(
                r#"[{{"name":"t","request":{{"method":"GET","url":"/x","auth":{auth_json}}}}}]"#
            ));
            let ImportedItem::Request(req) = &parse_collection(&json).unwrap().items[0] else {
                panic!()
            };
            assert_eq!(req.auth, expected, "auth={auth_json}");
        }
    }

    /// 认不出的方法退回 GET，而不是让整条请求消失
    #[test]
    fn unknown_method_falls_back_to_get() {
        let json = collection(r#"[{"name":"t","request":{"method":"PURGE","url":"/x"}}]"#);
        let ImportedItem::Request(req) = &parse_collection(&json).unwrap().items[0] else {
            panic!()
        };
        assert_eq!(req.method, HttpMethod::Get);
    }

    /// 缺字段、多出未知字段都不该让导入失败——导出文件里这类东西很多
    #[test]
    fn tolerates_missing_and_unknown_fields() {
        let json = collection(
            r#"[{"name":"t","_postman_id":"abc","protocolProfileBehavior":{"x":1},
                 "request":{"url":"/x"}},
                {"name":"没有 request 也没有 item"}]"#,
        );
        let parsed = parse_collection(&json).unwrap();
        assert_eq!(parsed.request_count(), 1, "无从解析的条目跳过即可");
    }
}
