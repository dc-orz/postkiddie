//! 路径安全与规范化。
//!
//! 工作区文件来自 git 仓库，可能由他人编写并通过 `git pull` 进入本机。
//! 因此任何来自文件内容或前端的路径都视为不可信输入，必须经 [`resolve_within`]
//! 校验后才可用于 IO——否则一个精心构造的 `../../.ssh/id_rsa` 就能越权读写。

use std::path::{Component, Path, PathBuf};

use crate::error::{Error, Result};

/// 把相对路径安全地解析到 `root` 之下。
///
/// 拒绝：绝对路径、盘符前缀、任何 `..` 分量。
/// 不使用 `canonicalize`，因为目标文件在「新建」场景下尚不存在。
pub fn resolve_within(root: &Path, relative: &str) -> Result<PathBuf> {
    if relative.is_empty() {
        return Ok(root.to_path_buf());
    }

    let candidate = Path::new(relative);
    let mut resolved = root.to_path_buf();

    for component in candidate.components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            // `./` 无害，直接跳过
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(Error::PathEscape(relative.to_owned()));
            }
        }
    }

    Ok(resolved)
}

/// 把绝对路径转成相对 `root` 的、以 `/` 分隔的字符串。
///
/// 统一用 `/` 是为了让路径在 Windows 与 Unix 上有一致的表示：
/// 它同时是请求的 ID、git 的路径参数和前端的 React key，三者必须逐字节相等。
pub fn to_relative_slash(root: &Path, path: &Path) -> Result<String> {
    let rel = path
        .strip_prefix(root)
        .map_err(|_| Error::PathEscape(path.display().to_string()))?;

    let parts: Vec<_> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(p) => Some(p.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();

    Ok(parts.join("/"))
}

/// 把用户输入的名称转成安全的文件名。
///
/// 请求名可以是任意文本（含中文、空格、`/`），但文件名不行。
/// 保留中文与空格（现代文件系统与 git 都能正确处理，且可读性远胜转拼音），
/// 只替换掉在任一主流平台上非法的字符。
pub fn sanitize_file_name(name: &str) -> String {
    const ILLEGAL: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'];

    let cleaned: String = name
        .chars()
        .map(|c| {
            if ILLEGAL.contains(&c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();

    // Windows 不允许文件名以点或空格结尾
    let trimmed = cleaned.trim().trim_end_matches('.').trim();

    // 清理后若只剩替换符与空白，说明原名整个由非法字符构成（例如 "///"），
    // 生成 "---.yaml" 这种文件毫无意义，退回占位名
    let meaningful = trimmed.chars().any(|c| c != '-' && !c.is_whitespace());

    if meaningful {
        trimmed.to_owned()
    } else {
        "untitled".to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_traversal() {
        let root = Path::new("/ws");
        assert!(resolve_within(root, "../../etc/passwd").is_err());
        assert!(resolve_within(root, "collections/../../secret").is_err());
    }

    #[test]
    fn rejects_absolute_paths() {
        assert!(resolve_within(Path::new("/ws"), "/etc/passwd").is_err());
    }

    #[test]
    fn allows_nested_relative_paths() {
        let got = resolve_within(Path::new("/ws"), "collections/user/login.yaml").unwrap();
        assert_eq!(got, PathBuf::from("/ws/collections/user/login.yaml"));
    }

    #[test]
    fn keeps_cjk_and_spaces_in_file_names() {
        assert_eq!(sanitize_file_name("用户 登录"), "用户 登录");
    }

    #[test]
    fn replaces_illegal_chars() {
        assert_eq!(sanitize_file_name("GET /users/:id"), "GET -users--id");
    }

    #[test]
    fn falls_back_when_name_is_all_illegal() {
        assert_eq!(sanitize_file_name("///"), "untitled");
        assert_eq!(sanitize_file_name("   "), "untitled");
    }

    #[test]
    fn relative_paths_use_forward_slashes() {
        let got = to_relative_slash(
            Path::new("/ws"),
            Path::new("/ws/collections/user/login.yaml"),
        )
        .unwrap();
        assert_eq!(got, "collections/user/login.yaml");
    }
}
