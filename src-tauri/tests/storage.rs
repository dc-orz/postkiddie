//! 存储层集成测试：跑在真实文件系统上。
//!
//! 重点验证三件事：磁盘布局是否如文档所述、YAML 往返是否保真、
//! 以及「有人手改坏了一个文件」时是否只影响那一个节点而不是整棵树。

use std::fs;

use postkiddie_lib::{
    domain::model::{FolderMeta, HttpMethod, HttpRequest, KeyValue, RequestBody},
    storage::{Workspace, tree::TreeNode},
};
use tempfile::TempDir;

fn temp_workspace() -> (TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("创建临时目录失败");
    let ws = Workspace::init(dir.path(), "测试工作区").expect("初始化工作区失败");
    (dir, ws)
}

fn write_yaml(ws: &Workspace, relative: &str, content: &str) {
    let path = ws.root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

/// 从树里取出请求节点的名字，按显示顺序
fn request_names(nodes: &[TreeNode]) -> Vec<&str> {
    nodes
        .iter()
        .filter_map(|n| match n {
            TreeNode::Request { name, .. } => Some(name.as_str()),
            _ => None,
        })
        .collect()
}

fn node_names(nodes: &[TreeNode]) -> Vec<&str> {
    nodes
        .iter()
        .map(|n| match n {
            TreeNode::Folder { name, .. } => name.as_str(),
            TreeNode::Request { name, .. } => name.as_str(),
            TreeNode::Broken { name, .. } => name.as_str(),
        })
        .collect()
}

#[test]
fn init_creates_documented_layout() {
    let (dir, _ws) = temp_workspace();
    let root = dir.path();

    assert!(root.join("postkiddie.yaml").is_file());
    assert!(root.join("collections").is_dir());
    assert!(root.join("environments").is_dir());

    let config = fs::read_to_string(root.join("postkiddie.yaml")).unwrap();
    assert!(config.contains("name: 测试工作区"));
    assert!(config.contains("version: 1"));
}

/// 密钥文件一旦被提交就等于泄露，因此每次打开都要确认这行还在
#[test]
fn private_dir_is_gitignored_on_init() {
    let (dir, _ws) = temp_workspace();
    let ignore = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert!(ignore.contains(".postkiddie/"));
}

#[test]
fn gitignore_entry_is_restored_when_removed() {
    let (dir, _ws) = temp_workspace();

    // 模拟有人手工清空了 .gitignore，或从别处 pull 到一份没有这行的版本
    fs::write(dir.path().join(".gitignore"), "node_modules/\n").unwrap();

    Workspace::open(dir.path()).expect("重新打开失败");

    let ignore = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert!(ignore.contains(".postkiddie/"), "重新打开时应补回忽略规则");
    assert!(ignore.contains("node_modules/"), "不得覆盖用户原有的规则");
}

#[test]
fn gitignore_entry_is_not_duplicated_across_opens() {
    let (dir, _ws) = temp_workspace();

    for _ in 0..3 {
        Workspace::open(dir.path()).unwrap();
    }

    let ignore = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert_eq!(ignore.matches(".postkiddie/").count(), 1);
}

#[test]
fn open_rejects_directory_without_config() {
    let plain = tempfile::tempdir().unwrap();
    let err = Workspace::open(plain.path()).expect_err("缺少 postkiddie.yaml 时应当报错");
    assert_eq!(err.kind(), "invalid");
}

#[test]
fn scans_nested_directories_into_tree() {
    let (_dir, ws) = temp_workspace();

    write_yaml(
        &ws,
        "collections/用户中心/登录.yaml",
        "name: 登录\nmethod: POST\nurl: /login\n",
    );
    write_yaml(
        &ws,
        "collections/用户中心/资料.yaml",
        "name: 资料\nmethod: GET\nurl: /me\n",
    );
    write_yaml(
        &ws,
        "collections/健康检查.yaml",
        "name: 健康检查\nmethod: HEAD\nurl: /z\n",
    );

    let tree = ws.scan().unwrap();

    // 文件夹排在请求前面
    assert_eq!(node_names(&tree), vec!["用户中心", "健康检查"]);

    let TreeNode::Folder { children, id, .. } = &tree[0] else {
        panic!("首个节点应当是文件夹");
    };
    assert_eq!(id, "collections/用户中心");
    assert_eq!(request_names(children), vec!["登录", "资料"]);
}

/// 请求的身份就是它的相对路径，前端拿它当 React key 和 git 路径参数
#[test]
fn request_id_is_its_relative_slash_path() {
    let (_dir, ws) = temp_workspace();
    write_yaml(
        &ws,
        "collections/用户 中心/查询 资料.yaml",
        "name: 查询资料\nmethod: GET\nurl: /x\n",
    );

    let tree = ws.scan().unwrap();
    let TreeNode::Folder { children, .. } = &tree[0] else {
        panic!()
    };
    let TreeNode::Request { id, .. } = &children[0] else {
        panic!()
    };

    assert_eq!(id, "collections/用户 中心/查询 资料.yaml");
}

/// order 集中记录顺序，是「拖拽重排只产生一处 diff」的实现基础
#[test]
fn folder_order_controls_display_sequence() {
    let (_dir, ws) = temp_workspace();

    for name in ["甲", "乙", "丙"] {
        write_yaml(
            &ws,
            &format!("collections/{name}.yaml"),
            &format!("name: {name}\nurl: /x\n"),
        );
    }

    let meta = FolderMeta {
        order: vec!["丙.yaml".to_owned(), "甲.yaml".to_owned()],
        ..Default::default()
    };
    fs::write(
        ws.collections_path().join("_folder.yaml"),
        serde_norway::to_string(&meta).unwrap(),
    )
    .unwrap();

    let tree = ws.scan().unwrap();
    // 列出的按给定顺序在前，未列出的（乙）按名称跟在后面
    assert_eq!(request_names(&tree), vec!["丙", "甲", "乙"]);
}

/// order 允许不完整：外部新建的文件不会消失，也不强制立刻维护顺序
#[test]
fn unlisted_entries_survive_and_sort_by_name() {
    let (_dir, ws) = temp_workspace();

    for name in ["zebra", "Apple", "mango"] {
        write_yaml(
            &ws,
            &format!("collections/{name}.yaml"),
            &format!("name: {name}\nurl: /x\n"),
        );
    }

    let tree = ws.scan().unwrap();
    // 大小写不敏感排序，否则 Apple 会被排到 mango 后面，看起来像排序坏了
    assert_eq!(request_names(&tree), vec!["Apple", "mango", "zebra"]);
}

/// 解析失败的文件必须留在树里并标红——静默消失会让人以为 git pull 把请求弄丢了
#[test]
fn broken_file_becomes_a_node_instead_of_failing_the_scan() {
    let (_dir, ws) = temp_workspace();

    write_yaml(
        &ws,
        "collections/正常.yaml",
        "name: 正常\nmethod: GET\nurl: /ok\n",
    );
    write_yaml(
        &ws,
        "collections/损坏.yaml",
        "name: [这不是合法的\n  yaml: {{{\n",
    );

    let tree = ws.scan().unwrap();
    assert_eq!(tree.len(), 2, "损坏的文件不应导致整次扫描失败");

    let broken = tree
        .iter()
        .find(|n| matches!(n, TreeNode::Broken { .. }))
        .expect("应当有一个 Broken 节点");
    let TreeNode::Broken { name, error, .. } = broken else {
        panic!()
    };
    assert_eq!(name, "损坏.yaml");
    assert!(!error.is_empty(), "应当带上解析错误供 UI 展示");
}

#[test]
fn ignores_non_yaml_and_hidden_files() {
    let (_dir, ws) = temp_workspace();

    write_yaml(&ws, "collections/真请求.yaml", "name: 真请求\nurl: /x\n");
    write_yaml(&ws, "collections/README.md", "# 说明\n");
    write_yaml(&ws, "collections/.DS_Store", "");

    assert_eq!(request_names(&ws.scan().unwrap()), vec!["真请求"]);
}

/// 往返保真是存储格式的底线：存进去什么，读出来必须一模一样
#[test]
fn request_round_trips_through_yaml() {
    let (_dir, ws) = temp_workspace();

    let original = HttpRequest {
        name: "登录".to_owned(),
        method: HttpMethod::Post,
        url: "{{baseUrl}}/auth/login".to_owned(),
        headers: vec![
            KeyValue {
                name: "Content-Type".to_owned(),
                value: "application/json".to_owned(),
                enabled: true,
                description: None,
            },
            KeyValue {
                name: "X-Debug".to_owned(),
                value: "1".to_owned(),
                enabled: false,
                description: Some("仅本地调试".to_owned()),
            },
        ],
        body: RequestBody::Json {
            content: "{\n  \"user\": \"admin\"\n}".to_owned(),
        },
        ..Default::default()
    };

    let path = ws.collections_path().join("登录.yaml");
    postkiddie_lib::storage::tree::write_request(&path, &original).unwrap();

    let loaded = postkiddie_lib::storage::tree::read_request(&path).unwrap();
    assert_eq!(loaded, original);

    // 多行 body 必须以 block scalar 落盘，否则 git diff 会退化成整行替换
    let raw = fs::read_to_string(&path).unwrap();
    assert!(
        raw.contains("content: |"),
        "body 未使用 block scalar：\n{raw}"
    );
    assert!(raw.contains("enabled: false"), "禁用状态应当落盘");
}

#[test]
fn environments_are_listed_and_broken_ones_skipped() {
    let (_dir, ws) = temp_workspace();

    write_yaml(
        &ws,
        "environments/预发.yaml",
        "name: 预发\nvariables:\n  - name: baseUrl\n    value: https://staging\n",
    );
    write_yaml(&ws, "environments/本地.yaml", "name: 本地\nvariables: []\n");
    write_yaml(&ws, "environments/坏掉的.yaml", "name: [不合法\n");

    let envs = ws.list_environments().unwrap();
    let names: Vec<_> = envs.iter().map(|e| e.name.as_str()).collect();

    assert_eq!(envs.len(), 2, "损坏的环境文件应被跳过而非中断加载");
    // 按名称排序，下拉列表的顺序才不会随文件系统的遍历顺序漂移
    assert_eq!(names, vec!["本地", "预发"]);
}

#[test]
fn secrets_are_stored_outside_git_tracked_files() {
    let (dir, ws) = temp_workspace();

    let mut store = ws.read_secrets().unwrap();
    store
        .environments
        .entry("预发".to_owned())
        .or_default()
        .insert("token".to_owned(), "super-secret".to_owned());
    ws.write_secrets(&store).unwrap();

    let secrets_path = dir.path().join(".postkiddie/secrets.yaml");
    assert!(secrets_path.is_file());
    assert!(
        fs::read_to_string(&secrets_path)
            .unwrap()
            .contains("super-secret")
    );

    let reloaded = ws.read_secrets().unwrap();
    assert_eq!(reloaded.environments["预发"]["token"], "super-secret");

    // 集合目录里不得出现密钥
    assert!(!ws.collections_path().join("secrets.yaml").exists());
}
