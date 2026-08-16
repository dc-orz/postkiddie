//! Postman 导入的落盘行为：跑在真实文件系统上。
//!
//! 解析本身在 `domain::postman` 里有单元测试覆盖，这里只验证「写下去之后
//! 磁盘上长什么样」——目录嵌套、顺序保留、重名消歧，以及导入结果能被
//! 正常扫描回来（导进来却读不出，等于没导）。

use postkiddie_lib::{
    commands::postman::import_into,
    storage::{Workspace, tree::TreeNode},
};
use tempfile::TempDir;

const SCHEMA: &str = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

fn temp_workspace() -> (TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("创建临时目录失败");
    let ws = Workspace::init(dir.path(), "测试工作区").expect("初始化工作区失败");
    (dir, ws)
}

fn collection(name: &str, items: &str) -> String {
    format!(r#"{{"info":{{"name":"{name}","schema":"{SCHEMA}"}},"item":{items}}}"#)
}

#[test]
fn imports_into_a_single_folder_named_after_the_collection() {
    let (_dir, ws) = temp_workspace();

    let json = collection(
        "订单服务",
        r#"[{"name":"创建订单","request":{"method":"POST","url":{"raw":"{{baseUrl}}/orders"}}}]"#,
    );
    let count = import_into(&ws, &json).expect("导入失败");
    assert_eq!(count, 1);

    let tree = ws.scan().expect("扫描失败");
    let TreeNode::Folder { name, children, .. } = &tree[0] else {
        panic!("集合应当套在一层同名目录下，而不是摊进集合根：{tree:?}");
    };
    assert_eq!(name, "订单服务");
    assert_eq!(children.len(), 1);
}

#[test]
fn preserves_nesting_and_order() {
    let (_dir, ws) = temp_workspace();

    // Postman 里的先后往往是有意为之（登录在前、业务在后），
    // 不显式记下来的话扫描会退回按名称排序，把它打乱
    let json = collection(
        "API",
        r#"[
            {"name":"登录","request":{"method":"POST","url":"/login"}},
            {"name":"用户","item":[
                {"name":"列表","request":{"method":"GET","url":"/users"}},
                {"name":"详情","request":{"method":"GET","url":"/users/1"}}
            ]},
            {"name":"注销","request":{"method":"POST","url":"/logout"}}
        ]"#,
    );
    assert_eq!(import_into(&ws, &json).expect("导入失败"), 4);

    let tree = ws.scan().expect("扫描失败");
    let TreeNode::Folder { children, .. } = &tree[0] else {
        panic!("应为文件夹");
    };

    let names: Vec<&str> = children
        .iter()
        .map(|n| match n {
            TreeNode::Folder { name, .. }
            | TreeNode::Request { name, .. }
            | TreeNode::Broken { name, .. } => name.as_str(),
        })
        .collect();
    assert_eq!(names, ["登录", "用户", "注销"], "顺序必须与集合中一致");
}

/// 导两次同一份集合不该互相覆盖
#[test]
fn repeated_import_does_not_overwrite() {
    let (_dir, ws) = temp_workspace();
    let json = collection(
        "重复",
        r#"[{"name":"同名","request":{"method":"GET","url":"/x"}}]"#,
    );

    import_into(&ws, &json).expect("首次导入失败");
    import_into(&ws, &json).expect("再次导入失败");

    let tree = ws.scan().expect("扫描失败");
    assert_eq!(tree.len(), 2, "第二次应当落在另一个目录里：{tree:?}");
}

/// 导进来却读不出等于没导：请求内容必须能原样扫描回来
#[test]
fn imported_requests_are_readable() {
    let (_dir, ws) = temp_workspace();

    let json = collection(
        "读回",
        r#"[{"name":"查询","request":{
            "method":"GET",
            "url":{"raw":"https://x.com/s?q=cat","query":[{"key":"q","value":"cat"}]},
            "header":[{"key":"Accept","value":"application/json"}]
        }}]"#,
    );
    import_into(&ws, &json).expect("导入失败");

    let tree = ws.scan().expect("扫描失败");
    let TreeNode::Folder { children, .. } = &tree[0] else {
        panic!("应为文件夹");
    };
    let TreeNode::Request { id, method, .. } = &children[0] else {
        panic!("应为请求，实际 {children:?}");
    };
    assert_eq!(*method, postkiddie_lib::domain::model::HttpMethod::Get);

    let path = ws.root.join(id);
    let request = postkiddie_lib::storage::tree::read_request(&path).expect("读取失败");
    assert_eq!(request.url, "https://x.com/s", "查询串应已移入 params");
    assert_eq!(request.params.len(), 1);
    assert_eq!(request.headers[0].name, "Accept");
}
