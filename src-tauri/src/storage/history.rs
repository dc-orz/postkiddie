//! 请求历史。
//!
//! 纯本地、不进 git：历史里带着实际发出的 URL、实际生效的变量值和响应内容，
//! 那是「我这台机器上发生过什么」，不是团队要共享的契约。
//! 落在 `.postkiddie/history.jsonl`，与 secrets / cookies 同处被 gitignore 的目录。
//!
//! 选 JSONL 而非 YAML：这里是只追加的日志，一行一条，写入不必读出全文再序列化。
//! 也正因如此，单条记录损坏只影响那一行，解析时跳过即可，不会让整个历史读不出来。

use serde::{Deserialize, Serialize};

use crate::{
    domain::model::HttpMethod,
    error::Result,
    http::executor::{HttpResponse, ResponseBody},
};

/// 保留的最大条数。
///
/// 超过后按时间丢弃最旧的。取 500 是因为它足够覆盖「昨天那次调用返回了什么」
/// 这类实际诉求，又不至于让文件涨到需要考虑索引。
pub const MAX_ENTRIES: usize = 500;

/// 触发压缩的阈值。
///
/// 不在每次写入时都裁剪：那意味着每发一个请求就要重写整个文件。
/// 攒到 1.5 倍再一次性裁回上限，把重写成本摊薄到几百次请求上。
const COMPACT_AT: usize = MAX_ENTRIES * 3 / 2;

/// 单条响应体最多保留的字节数。
///
/// 历史的用途是「回看当时返回了什么」，通常看开头就够；
/// 而不设限的话，一次下载几十 MB 的接口就能把历史文件撑爆。
const MAX_BODY_BYTES: usize = 256 * 1024;

/// 历史里保存的响应体。二进制不留内容——回看一段 base64 没有意义，尺寸信息已经够了。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum HistoryBody {
    Empty,
    Binary,
    Text {
        content: String,
        /// 内容被截断过。UI 必须显示出来，否则用户会以为服务端就返回了这么多。
        #[serde(default, skip_serializing_if = "is_false")]
        truncated: bool,
    },
}

fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    /// 发生时刻，RFC3339。同时用作排序键与列表 key。
    pub at: String,
    /// 来源请求的 id（相对工作区根的路径）。从未保存过的草稿没有来源。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub name: String,
    pub method: HttpMethod,
    /// 变量插值**之后**实际发出的 URL——回看时想知道的是真实打到了哪儿，
    /// 而不是 `{{baseUrl}}/users` 这种还原不出上下文的模板。
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,
    pub status: u16,
    pub status_text: String,
    pub elapsed_ms: u32,
    pub size_bytes: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    pub body: HistoryBody,
}

impl HistoryEntry {
    /// 从一次真实响应构造历史记录，顺带按上限截断响应体。
    pub fn from_response(
        at: String,
        request_id: Option<String>,
        name: String,
        method: HttpMethod,
        url: String,
        environment: Option<String>,
        response: &HttpResponse,
    ) -> Self {
        let content_type = response
            .headers
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case("content-type"))
            .map(|h| h.value.clone());

        let body = match &response.body {
            ResponseBody::Empty => HistoryBody::Empty,
            ResponseBody::Binary { .. } => HistoryBody::Binary,
            ResponseBody::Text { content } => {
                if content.len() <= MAX_BODY_BYTES {
                    HistoryBody::Text {
                        content: content.clone(),
                        truncated: false,
                    }
                } else {
                    // 按字符边界切，不能直接切字节——从中间截断 UTF-8 会得到无效字符串
                    let mut end = MAX_BODY_BYTES;
                    while end > 0 && !content.is_char_boundary(end) {
                        end -= 1;
                    }
                    HistoryBody::Text {
                        content: content[..end].to_owned(),
                        truncated: true,
                    }
                }
            }
        };

        Self {
            at,
            request_id,
            name,
            method,
            url,
            environment,
            status: response.status,
            status_text: response.status_text.clone(),
            elapsed_ms: response.elapsed_ms,
            size_bytes: response.size_bytes,
            content_type,
            body,
        }
    }
}

/// 解析 JSONL。
///
/// 坏行跳过而不是整体失败：历史是诊断用的辅助信息，
/// 为了一行残缺（写入时断电、手工编辑失误）就让整个面板打不开，代价不成比例。
pub fn parse(raw: &str) -> Vec<HistoryEntry> {
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

/// 追加一条，必要时压缩。返回压缩后写回的全文（若未压缩则为 None）。
///
/// 纯函数形式便于测试：文件读写留给调用方。
pub fn append(existing: &str, entry: &HistoryEntry) -> Result<AppendPlan> {
    let line = serde_json::to_string(entry)?;
    let count = existing.lines().filter(|l| !l.trim().is_empty()).count();

    if count < COMPACT_AT {
        return Ok(AppendPlan::Append(line));
    }

    // 超阈值：连同新条目一起裁到上限，只保留最新的
    let mut all = parse(existing);
    all.push(entry.clone());
    let keep = all.split_off(all.len().saturating_sub(MAX_ENTRIES));

    let mut out = String::new();
    for e in &keep {
        out.push_str(&serde_json::to_string(e)?);
        out.push('\n');
    }
    Ok(AppendPlan::Rewrite(out))
}

#[derive(Debug, PartialEq, Eq)]
pub enum AppendPlan {
    /// 直接往文件尾追加这一行（不含换行符）
    Append(String),
    /// 用这段内容整体覆盖文件
    Rewrite(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(at: &str) -> HistoryEntry {
        HistoryEntry {
            at: at.to_owned(),
            request_id: None,
            name: "t".to_owned(),
            method: HttpMethod::Get,
            url: "https://x.com/".to_owned(),
            environment: None,
            status: 200,
            status_text: "OK".to_owned(),
            elapsed_ms: 12,
            size_bytes: 3,
            content_type: None,
            body: HistoryBody::Empty,
        }
    }

    #[test]
    fn parses_jsonl() {
        let raw = format!(
            "{}\n{}\n",
            serde_json::to_string(&entry("a")).unwrap(),
            serde_json::to_string(&entry("b")).unwrap()
        );
        let parsed = parse(&raw);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[1].at, "b");
    }

    /// 坏行不该让整个历史读不出来
    #[test]
    fn skips_corrupt_lines() {
        let raw = format!(
            "{{ 这不是 json\n{}\n\n",
            serde_json::to_string(&entry("good")).unwrap()
        );
        let parsed = parse(&raw);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].at, "good");
    }

    #[test]
    fn appends_without_rewriting_below_threshold() {
        let existing = format!("{}\n", serde_json::to_string(&entry("a")).unwrap());
        match append(&existing, &entry("b")).unwrap() {
            AppendPlan::Append(line) => assert!(line.contains("\"at\":\"b\"")),
            AppendPlan::Rewrite(_) => panic!("条数远未到阈值，不该整体重写"),
        }
    }

    /// 压缩的两个要点：裁到上限、保留的是**最新**的那批
    #[test]
    fn compacts_to_max_keeping_newest() {
        let mut raw = String::new();
        for i in 0..COMPACT_AT {
            raw.push_str(&serde_json::to_string(&entry(&format!("{i:04}"))).unwrap());
            raw.push('\n');
        }

        match append(&raw, &entry("9999")).unwrap() {
            AppendPlan::Append(_) => panic!("已超阈值，应当压缩"),
            AppendPlan::Rewrite(out) => {
                let kept = parse(&out);
                assert_eq!(kept.len(), MAX_ENTRIES);
                assert_eq!(kept.last().unwrap().at, "9999", "新条目必须在最后");
                // 被丢掉的应该是最旧的那些
                assert!(kept.iter().all(|e| e.at != "0000"));
            }
        }
    }

    /// 回归测试：按字节切 UTF-8 会切出无效字符串，中文响应体首当其冲
    #[test]
    fn truncates_on_char_boundary() {
        let long = "中".repeat(MAX_BODY_BYTES); // 每个 3 字节，远超上限
        let response = HttpResponse {
            status: 200,
            status_text: "OK".to_owned(),
            final_url: "https://x.com/".to_owned(),
            headers: Vec::new(),
            body: ResponseBody::Text {
                content: long.clone(),
            },
            size_bytes: long.len() as u32,
            elapsed_ms: 1,
        };

        let e = HistoryEntry::from_response(
            "now".to_owned(),
            None,
            "t".to_owned(),
            HttpMethod::Get,
            "https://x.com/".to_owned(),
            None,
            &response,
        );

        match e.body {
            HistoryBody::Text { content, truncated } => {
                assert!(truncated);
                assert!(content.len() <= MAX_BODY_BYTES);
                // 能取到字符说明没在多字节序列中间断开
                assert!(content.chars().all(|c| c == '中'));
            }
            other => panic!("应为文本体，实际 {other:?}"),
        }
    }
}
