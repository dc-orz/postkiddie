//! `{{变量}}` 插值。
//!
//! 变量来源按优先级由高到低：请求级 → 文件夹级 → 环境 → 工作区全局。
//! 支持变量值内再含变量（`{{host}}` = `{{scheme}}://{{domain}}`），
//! 但限制展开深度以防自引用导致死循环。

use std::collections::HashMap;

use crate::error::{Error, Result};

/// 最大递归展开层数。超过即判定为循环引用。
const MAX_DEPTH: usize = 10;

#[derive(Debug, Clone, Default)]
pub struct VariableScope {
    values: HashMap<String, String>,
}

impl VariableScope {
    pub fn new() -> Self {
        Self::default()
    }

    /// 后写入的覆盖先写入的，因此请按优先级从低到高依次 extend
    pub fn extend<I, K, V>(&mut self, entries: I) -> &mut Self
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        for (k, v) in entries {
            self.values.insert(k.into(), v.into());
        }
        self
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }

    /// 展开文本中的所有 `{{name}}`。
    ///
    /// 遇到未定义变量时**返回错误而非留空**：静默发出一个 URL 里带着字面
    /// `{{baseUrl}}` 的请求，排查成本远高于当场报错。
    pub fn expand(&self, input: &str) -> Result<String> {
        self.expand_inner(input, 0)
    }

    fn expand_inner(&self, input: &str, depth: usize) -> Result<String> {
        if depth > MAX_DEPTH {
            return Err(Error::Invalid(format!(
                "变量展开层数超过 {MAX_DEPTH}，可能存在循环引用"
            )));
        }
        if !input.contains("{{") {
            return Ok(input.to_owned());
        }

        let mut out = String::with_capacity(input.len());
        let mut rest = input;

        while let Some(start) = rest.find("{{") {
            out.push_str(&rest[..start]);
            let after = &rest[start + 2..];

            let Some(end) = after.find("}}") else {
                // 没有闭合，按字面量处理——用户可能就是想发一个含 `{{` 的 body
                out.push_str(&rest[start..]);
                return Ok(out);
            };

            let name = after[..end].trim();
            let value = self
                .values
                .get(name)
                .ok_or_else(|| Error::UnresolvedVariable(name.to_owned()))?;

            out.push_str(&self.expand_inner(value, depth + 1)?);
            rest = &after[end + 2..];
        }

        out.push_str(rest);
        Ok(out)
    }

    /// 收集文本中引用到的、当前作用域未定义的变量名。
    /// 供 UI 在发送前做静态提示，比发出去再报错体验好。
    pub fn find_unresolved(&self, input: &str) -> Vec<String> {
        let mut missing = Vec::new();
        let mut rest = input;

        while let Some(start) = rest.find("{{") {
            let after = &rest[start + 2..];
            let Some(end) = after.find("}}") else { break };

            let name = after[..end].trim();
            if !name.is_empty()
                && !self.values.contains_key(name)
                && !missing.iter().any(|m| m == name)
            {
                missing.push(name.to_owned());
            }
            rest = &after[end + 2..];
        }

        missing
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(pairs: &[(&str, &str)]) -> VariableScope {
        let mut s = VariableScope::new();
        s.extend(pairs.iter().copied());
        s
    }

    #[test]
    fn expands_simple_variable() {
        let s = scope(&[("baseUrl", "http://localhost:8080")]);
        assert_eq!(
            s.expand("{{baseUrl}}/users").unwrap(),
            "http://localhost:8080/users"
        );
    }

    #[test]
    fn expands_nested_variables() {
        let s = scope(&[
            ("scheme", "https"),
            ("domain", "api.example.com"),
            ("baseUrl", "{{scheme}}://{{domain}}"),
        ]);
        assert_eq!(
            s.expand("{{baseUrl}}/v1").unwrap(),
            "https://api.example.com/v1"
        );
    }

    #[test]
    fn tolerates_whitespace_inside_braces() {
        let s = scope(&[("token", "abc")]);
        assert_eq!(s.expand("Bearer {{ token }}").unwrap(), "Bearer abc");
    }

    /// 未定义变量必须报错，不能静默发出带字面量的请求
    #[test]
    fn errors_on_undefined_variable() {
        let err = scope(&[]).expand("{{missing}}/x").unwrap_err();
        assert_eq!(err.kind(), crate::error::ErrorKind::UnresolvedVariable);
    }

    #[test]
    fn detects_self_reference_loop() {
        let s = scope(&[("a", "{{b}}"), ("b", "{{a}}")]);
        assert!(s.expand("{{a}}").is_err());
    }

    /// 未闭合的 `{{` 按字面量处理——GraphQL / 模板类 body 里合法出现
    #[test]
    fn leaves_unclosed_braces_intact() {
        assert_eq!(
            scope(&[]).expand("query { user {{ id").unwrap(),
            "query { user {{ id"
        );
    }

    #[test]
    fn lists_missing_variables_without_erroring() {
        let s = scope(&[("known", "1")]);
        let missing = s.find_unresolved("{{known}}/{{a}}/{{b}}/{{a}}");
        assert_eq!(missing, vec!["a", "b"]);
    }
}
