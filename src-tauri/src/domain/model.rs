//! 领域模型 —— 同时也是磁盘 YAML 的 schema 定义。
//!
//! 这些结构体的**字段声明顺序即 YAML 输出顺序**，改动顺序会让所有文件产生 diff，
//! 因此调整前请确认确有必要。
//!
//! 四条贯穿性约定：
//!
//! 0. **一律 `rename_all = "camelCase"`。** 这些结构同时是磁盘 YAML 的 schema
//!    和 IPC 的传输格式，两端必须完全一致。选 camelCase 而非 Rust 惯用的
//!    snake_case，是因为它同时要被 TypeScript 读写——让磁盘迁就前端一次，
//!    好过在 IPC 边界上做一层易漏的转换。漏加会静默丢字段：
//!    前端写 `timeoutMs`、后端读 `timeout_ms`，`#[serde(default)]` 会把它当没填，
//!    用户改的超时设置就这么无声消失了。**新增结构时不要忘。**
//!
//! 1. **不使用 `deny_unknown_fields`。** 团队成员的客户端版本必然参差不齐，
//!    老版本读到新版本写入的字段时应当忽略而不是报错。代价是拼错的字段会被静默丢弃，
//!    由 lint 命令（`workspace::lint`）单独负责提示。
//!
//! 2. **默认值一律 `skip_serializing_if`。** 只有偏离默认的字段才落盘，
//!    保证新建请求的 YAML 足够短、diff 里只出现真正改动的行。
//!
//! 3. **有序集合用 `Vec` 而非 `Map`。** HTTP header / query 允许重名，
//!    且顺序对 diff 稳定性至关重要——`Map` 的序列化顺序不可靠。

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// 基础类型
// ---------------------------------------------------------------------------

/// 键值对条目，用于 header / query / form 字段。
///
/// `enabled: false` 表示「保留但不发送」，等价于 Postman 里取消勾选。
/// 这比直接删除更实用：调试用的 header 可以留在文件里随时打开。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    pub name: String,

    #[serde(default)]
    pub value: String,

    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub enabled: bool,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    #[default]
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

impl HttpMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Patch => "PATCH",
            Self::Delete => "DELETE",
            Self::Head => "HEAD",
            Self::Options => "OPTIONS",
        }
    }
}

// ---------------------------------------------------------------------------
// 请求体
// ---------------------------------------------------------------------------

/// 请求体。用 internally-tagged enum，YAML 形如：
///
/// ```yaml
/// body:
///   type: json
///   content: |
///     { "name": "kiddie" }
/// ```
///
/// 文本类内容统一放 `content` 字段并用 YAML block scalar（`|`）书写：
/// 原文逐行落盘，无转义，diff 可以精确到 JSON 的某一行。
/// 这正是选 YAML 而非 JSON 作为存储格式的核心理由。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum RequestBody {
    #[default]
    None,

    Json {
        #[serde(default)]
        content: String,
    },

    Text {
        #[serde(default)]
        content: String,
        /// 覆盖默认的 `text/plain`
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_type: Option<String>,
    },

    Xml {
        #[serde(default)]
        content: String,
    },

    /// application/x-www-form-urlencoded
    FormUrlencoded {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        fields: Vec<KeyValue>,
    },

    /// multipart/form-data；`file` 为相对工作区根的路径，保证仓库可移植
    Multipart {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        fields: Vec<MultipartField>,
    },

    /// 原始二进制，`file` 为相对工作区根的路径
    Binary {
        file: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content_type: Option<String>,
    },

    /// GraphQL 是 HTTP 之上最常见的一层，值得内建支持而非让用户手拼 JSON
    Graphql {
        #[serde(default)]
        query: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        variables: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        operation_name: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartField {
    pub name: String,

    /// 文本字段的值；与 `file` 二选一
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,

    /// 文件字段：相对工作区根的路径
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,

    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub enabled: bool,
}

// ---------------------------------------------------------------------------
// 认证
// ---------------------------------------------------------------------------

/// 认证配置。`Inherit` 表示沿用父文件夹 / 集合的设置，
/// 这是最常用的情形——整个集合共用一套 token，不该在每个请求里重复。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Auth {
    #[default]
    Inherit,

    None,

    Basic {
        username: String,
        #[serde(default)]
        password: String,
    },

    Bearer {
        token: String,
    },

    /// 放进任意 header / query 的 API key
    ApiKey {
        key: String,
        value: String,
        #[serde(default)]
        placement: ApiKeyPlacement,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ApiKeyPlacement {
    #[default]
    Header,
    Query,
}

// ---------------------------------------------------------------------------
// 请求级设置
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSettings {
    /// 毫秒。0 表示不超时。
    #[serde(
        default = "default_timeout",
        skip_serializing_if = "is_default_timeout"
    )]
    pub timeout_ms: u64,

    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub follow_redirects: bool,

    #[serde(
        default = "default_max_redirects",
        skip_serializing_if = "is_default_max_redirects"
    )]
    pub max_redirects: u8,

    /// 关闭后接受自签名证书。内网调试常用，故做成请求级开关而非全局设置。
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub verify_tls: bool,

    /// 关闭后 `Accept-Encoding` 不声明压缩，便于观察服务端原始字节
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub decompress: bool,

    /// 是否参与 Cookie 机制。
    ///
    /// 关闭后**既不附带**已存的 cookie，**也不保存**响应返回的 cookie——
    /// 是完整的隔离而非只单向关闭。关掉它的典型场景是「以未登录身份访问同一接口」
    /// 做对照，此时若响应里的 Set-Cookie 仍被存下来，反而会污染真实会话。
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub send_cookies: bool,
}

impl Default for RequestSettings {
    fn default() -> Self {
        Self {
            timeout_ms: default_timeout(),
            follow_redirects: true,
            max_redirects: default_max_redirects(),
            verify_tls: true,
            decompress: true,
            send_cookies: true,
        }
    }
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

/// 一个 HTTP 请求 = 磁盘上的一个 `.yaml` 文件。
///
/// **没有 `id` 字段**，这是刻意的：请求的身份就是它相对工作区根的路径。
/// 好处是重命名/移动的语义天然正确、复制文件不会撞 ID、
/// 也不存在两个人各自新建请求生成同一 UUID 的合并冲突。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub name: String,

    #[serde(default)]
    pub method: HttpMethod,

    #[serde(default)]
    pub url: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 查询参数。也可以直接写在 `url` 里；两者会合并，此处的优先。
    /// 独立成字段的价值在于可以逐条 `enabled` 开关。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub params: Vec<KeyValue>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<KeyValue>,

    #[serde(default, skip_serializing_if = "is_body_none")]
    pub body: RequestBody,

    #[serde(default, skip_serializing_if = "is_auth_inherit")]
    pub auth: Auth,

    #[serde(default, skip_serializing_if = "is_default_settings")]
    pub settings: RequestSettings,
}

// ---------------------------------------------------------------------------
// 文件夹 / 集合
// ---------------------------------------------------------------------------

/// 目录的元信息，存于该目录下的 `_folder.yaml`（可选，缺省时用目录名）。
///
/// `order` 是这里最关键的设计：树的显示顺序集中记录在**一个**文件里，
/// 而不是在每个请求里写 `seq` 序号。拖拽重排只产生一处 diff，
/// 而不是几十个文件的序号全体位移。
///
/// 未列入 `order` 的条目按文件名排在其后——外部新建的文件不会消失，也不需要立即维护顺序。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 子条目文件名（含扩展名）或子目录名，按显示顺序排列
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub order: Vec<String>,

    /// 本目录下所有请求默认继承的 header
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<KeyValue>,

    #[serde(default, skip_serializing_if = "is_auth_inherit")]
    pub auth: Auth,
}

// ---------------------------------------------------------------------------
// 环境变量
// ---------------------------------------------------------------------------

/// 一个环境 = `environments/<name>.yaml`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub name: String,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<EnvVariable>,
}

/// 环境变量。
///
/// `secret: true` 的变量**其 `value` 不会写入 git 跟踪的文件**——
/// 落盘时被清空，真实值存放于工作区内被 gitignore 的 `.postkiddie/secrets.yaml`。
/// 这样团队共享的是「有哪些密钥要填」的契约，而不是密钥本身。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVariable {
    pub name: String,

    #[serde(default)]
    pub value: String,

    #[serde(default, skip_serializing_if = "is_false")]
    pub secret: bool,

    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub enabled: bool,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

// ---------------------------------------------------------------------------
// 工作区配置
// ---------------------------------------------------------------------------

/// 工作区根目录下的 `postkiddie.yaml`，标记「这是一个 PostKiddie 工作区」。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    /// schema 版本。破坏性变更时递增，客户端据此决定迁移或提示升级。
    #[serde(default = "default_schema_version")]
    pub version: u32,

    pub name: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 集合根目录，相对工作区根。默认 `collections`。
    #[serde(default = "default_collections_dir")]
    pub collections_dir: String,

    /// 环境目录，相对工作区根。默认 `environments`。
    #[serde(default = "default_environments_dir")]
    pub environments_dir: String,

    /// 所有请求共享的默认 header
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<KeyValue>,

    #[serde(default, skip_serializing_if = "is_auth_inherit")]
    pub auth: Auth,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            version: default_schema_version(),
            name: "PostKiddie Workspace".to_owned(),
            description: None,
            collections_dir: default_collections_dir(),
            environments_dir: default_environments_dir(),
            headers: Vec::new(),
            auth: Auth::Inherit,
        }
    }
}

// ---------------------------------------------------------------------------
// serde 辅助
// ---------------------------------------------------------------------------

pub const SCHEMA_VERSION: u32 = 1;

fn default_true() -> bool {
    true
}
fn is_true(v: &bool) -> bool {
    *v
}
fn is_false(v: &bool) -> bool {
    !*v
}
fn default_timeout() -> u64 {
    30_000
}
fn is_default_timeout(v: &u64) -> bool {
    *v == default_timeout()
}
fn default_max_redirects() -> u8 {
    10
}
fn is_default_max_redirects(v: &u8) -> bool {
    *v == default_max_redirects()
}
fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}
fn default_collections_dir() -> String {
    "collections".to_owned()
}
fn default_environments_dir() -> String {
    "environments".to_owned()
}
fn is_body_none(v: &RequestBody) -> bool {
    matches!(v, RequestBody::None)
}
fn is_auth_inherit(v: &Auth) -> bool {
    matches!(v, Auth::Inherit)
}
fn is_default_settings(v: &RequestSettings) -> bool {
    *v == RequestSettings::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 新建的最简请求应当只落盘 name/method/url 三行——
    /// 这是「YAML 存储 + git diff 友好」的可验证下限，回归时最先破的就是它。
    #[test]
    fn minimal_request_serializes_without_noise() {
        let req = HttpRequest {
            name: "获取用户".to_owned(),
            method: HttpMethod::Get,
            url: "{{baseUrl}}/users/1".to_owned(),
            ..Default::default()
        };

        let yaml = serde_norway::to_string(&req).expect("序列化失败");

        assert_eq!(yaml.lines().count(), 3, "多余字段泄漏进了 YAML：\n{yaml}");
        assert!(yaml.contains("name: 获取用户"));
        assert!(yaml.contains("method: GET"));
    }

    /// 未知字段必须被忽略而非报错，否则老客户端会打不开新版本写的文件
    #[test]
    fn unknown_fields_are_ignored_for_forward_compat() {
        let yaml = "name: t\nmethod: POST\nurl: /x\nfutureFeature: {a: 1}\n";
        let req: HttpRequest = serde_norway::from_str(yaml).expect("应当容忍未知字段");
        assert_eq!(req.method, HttpMethod::Post);
    }

    /// 多词字段必须以 camelCase 落盘。
    ///
    /// 这是回归测试：早先 `RequestSettings` 等结构漏了 `rename_all`，
    /// 于是后端写 `timeout_ms`、前端读 `timeoutMs`，双方都不报错，
    /// 只是用户改的超时与 TLS 开关每次保存后都悄悄变回默认值。
    #[test]
    fn multi_word_fields_serialize_as_camel_case() {
        let req = HttpRequest {
            name: "t".to_owned(),
            method: HttpMethod::Post,
            url: "/x".to_owned(),
            settings: RequestSettings {
                timeout_ms: 5_000,
                verify_tls: false,
                max_redirects: 3,
                ..Default::default()
            },
            body: RequestBody::Text {
                content: "a,b\n".to_owned(),
                content_type: Some("text/csv".to_owned()),
            },
            ..Default::default()
        };

        let yaml = serde_norway::to_string(&req).expect("序列化失败");

        for camel in ["timeoutMs:", "verifyTls:", "maxRedirects:", "contentType:"] {
            assert!(yaml.contains(camel), "缺少 {camel}\n{yaml}");
        }
        for snake in ["timeout_ms", "verify_tls", "max_redirects", "content_type"] {
            assert!(!yaml.contains(snake), "残留 snake_case 键 {snake}\n{yaml}");
        }
    }

    /// 与上一条配套：camelCase 写出去之后必须还能读回来，且值不丢
    #[test]
    fn camel_case_settings_round_trip() {
        let original = HttpRequest {
            name: "t".to_owned(),
            method: HttpMethod::Get,
            url: "/x".to_owned(),
            settings: RequestSettings {
                timeout_ms: 1_234,
                follow_redirects: false,
                max_redirects: 2,
                verify_tls: false,
                decompress: false,
                send_cookies: false,
            },
            ..Default::default()
        };

        let yaml = serde_norway::to_string(&original).expect("序列化失败");
        let loaded: HttpRequest = serde_norway::from_str(&yaml).expect("反序列化失败");

        assert_eq!(loaded.settings, original.settings);
        assert_eq!(loaded, original);
    }

    /// 工作区配置同样过 IPC，键名也必须一致
    #[test]
    fn workspace_config_uses_camel_case() {
        let yaml = serde_norway::to_string(&WorkspaceConfig::default()).expect("序列化失败");
        assert!(yaml.contains("collectionsDir:"), "{yaml}");
        assert!(yaml.contains("environmentsDir:"), "{yaml}");
        assert!(!yaml.contains("collections_dir"), "{yaml}");
    }

    /// 多行 body 必须以 block scalar 落盘，保证 diff 能精确到 JSON 的某一行
    #[test]
    fn json_body_uses_block_scalar() {
        let req = HttpRequest {
            name: "登录".to_owned(),
            method: HttpMethod::Post,
            url: "/login".to_owned(),
            body: RequestBody::Json {
                content: "{\n  \"user\": \"admin\"\n}".to_owned(),
            },
            ..Default::default()
        };

        let yaml = serde_norway::to_string(&req).expect("序列化失败");
        assert!(
            yaml.contains("content: |"),
            "body 未使用 block scalar：\n{yaml}"
        );
    }
}
