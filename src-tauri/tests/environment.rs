//! 环境与密钥的集成测试。
//!
//! 这组测试盯的是整个项目唯一一条「可能把密钥写进 git」的路径。
//! 密钥一旦随 `git push` 出去就等于泄露且无法真正撤回，
//! 所以这里的断言不只看「读回来对不对」，更要逐条确认**磁盘上的公开文件里没有那个值**。

use std::fs;

use postkiddie_lib::{
    domain::model::{EnvVariable, Environment},
    storage::{Workspace, split_secrets},
};
use tempfile::TempDir;

fn temp_workspace() -> (TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("创建临时目录失败");
    let ws = Workspace::init(dir.path(), "测试工作区").expect("初始化工作区失败");
    (dir, ws)
}

fn var(name: &str, value: &str, secret: bool) -> EnvVariable {
    EnvVariable {
        name: name.to_owned(),
        value: value.to_owned(),
        secret,
        enabled: true,
        description: None,
    }
}

fn sample_env() -> Environment {
    Environment {
        name: "预发".to_owned(),
        variables: vec![
            var("baseUrl", "https://staging.example.com", false),
            var("token", "super-secret-token", true),
            var("apiKey", "ak_live_9911", true),
        ],
    }
}

/// 公开环境文件的原文。所有「密钥没泄露」的断言都基于它。
fn public_yaml(ws: &Workspace, name: &str) -> String {
    fs::read_to_string(ws.environment_path(name)).expect("读取环境文件失败")
}

#[test]
fn split_extracts_secret_values_and_blanks_them() {
    let (public, secrets) = split_secrets(sample_env());

    assert_eq!(secrets.len(), 2);
    assert_eq!(secrets["token"], "super-secret-token");
    assert_eq!(secrets["apiKey"], "ak_live_9911");

    // 公开部分保留变量声明（团队据此知道要填什么），但值必须为空
    let names: Vec<_> = public.variables.iter().map(|v| v.name.as_str()).collect();
    assert_eq!(names, vec!["baseUrl", "token", "apiKey"]);
    for v in public.variables.iter().filter(|v| v.secret) {
        assert!(v.value.is_empty(), "密钥值残留在公开部分：{}", v.name);
    }
    assert_eq!(public.variables[0].value, "https://staging.example.com");
}

#[test]
fn secret_values_never_reach_the_tracked_file() {
    let (_dir, ws) = temp_workspace();
    ws.save_environment("预发", sample_env()).unwrap();

    let yaml = public_yaml(&ws, "预发");
    assert!(
        !yaml.contains("super-secret-token"),
        "密钥进了 git 跟踪的文件：\n{yaml}"
    );
    assert!(
        !yaml.contains("ak_live_9911"),
        "密钥进了 git 跟踪的文件：\n{yaml}"
    );

    // 契约仍在：别人 clone 后能看到需要填哪些密钥
    assert!(yaml.contains("token"));
    assert!(yaml.contains("apiKey"));
    assert!(yaml.contains("secret: true"));
    assert!(yaml.contains("https://staging.example.com"));
}

#[test]
fn secret_values_land_in_the_private_store() {
    let (dir, ws) = temp_workspace();
    ws.save_environment("预发", sample_env()).unwrap();

    let secrets_file = dir.path().join(".postkiddie/secrets.yaml");
    let raw = fs::read_to_string(&secrets_file).unwrap();
    assert!(raw.contains("super-secret-token"));

    // 而 .postkiddie/ 必须是被忽略的
    let ignore = fs::read_to_string(dir.path().join(".gitignore")).unwrap();
    assert!(ignore.contains(".postkiddie/"));
}

#[test]
fn resolved_list_merges_secrets_back_for_the_ui() {
    let (_dir, ws) = temp_workspace();
    ws.save_environment("预发", sample_env()).unwrap();

    // 未合并的读取：密钥为空（磁盘原样）
    let plain = ws.list_environments().unwrap();
    let token = plain[0]
        .variables
        .iter()
        .find(|v| v.name == "token")
        .unwrap();
    assert!(token.value.is_empty());

    // 合并后的读取：UI 拿到真实值才能显示与编辑
    let resolved = ws.list_environments_resolved().unwrap();
    let token = resolved[0]
        .variables
        .iter()
        .find(|v| v.name == "token")
        .unwrap();
    assert_eq!(token.value, "super-secret-token");
}

/// 最关键的一条回归：UI 拿到的是合并后的完整对象，用户改了别的字段后原样保存，
/// 密钥**不能**因此被写进 git。这条路径一旦破，泄露是静默的。
#[test]
fn round_trip_through_ui_does_not_leak_secrets() {
    let (_dir, ws) = temp_workspace();
    ws.save_environment("预发", sample_env()).unwrap();

    // 模拟 UI：读出合并后的环境，改一个公开值，再整个存回去
    let mut loaded = ws.list_environments_resolved().unwrap().remove(0);
    loaded.variables[0].value = "https://staging2.example.com".to_owned();
    ws.save_environment("预发", loaded).unwrap();

    let yaml = public_yaml(&ws, "预发");
    assert!(
        !yaml.contains("super-secret-token"),
        "往返一次后密钥泄露了：\n{yaml}"
    );
    assert!(
        yaml.contains("https://staging2.example.com"),
        "公开值应当已更新"
    );

    // 密钥本身没丢
    let resolved = ws.list_environments_resolved().unwrap();
    let token = resolved[0]
        .variables
        .iter()
        .find(|v| v.name == "token")
        .unwrap();
    assert_eq!(token.value, "super-secret-token");
}

/// 把变量从 secret 改成非 secret，等于用户明确要求公开它，此时值应当进入 git 文件
#[test]
fn unmarking_secret_moves_value_into_the_tracked_file() {
    let (_dir, ws) = temp_workspace();
    ws.save_environment("预发", sample_env()).unwrap();

    let mut loaded = ws.list_environments_resolved().unwrap().remove(0);
    let token = loaded
        .variables
        .iter_mut()
        .find(|v| v.name == "token")
        .unwrap();
    token.secret = false;
    ws.save_environment("预发", loaded).unwrap();

    let yaml = public_yaml(&ws, "预发");
    assert!(
        yaml.contains("super-secret-token"),
        "取消 secret 标记后值应当入库"
    );

    // 同时它不该再留在本机密钥库里
    let secrets = ws.read_secrets().unwrap();
    assert!(!secrets.environments["预发"].contains_key("token"));
}

/// 反向：把公开变量标成 secret，值必须立刻从 git 文件里消失
#[test]
fn marking_secret_removes_value_from_the_tracked_file() {
    let (_dir, ws) = temp_workspace();
    ws.save_environment("预发", sample_env()).unwrap();

    let mut loaded = ws.list_environments_resolved().unwrap().remove(0);
    loaded.variables[0].secret = true;
    ws.save_environment("预发", loaded).unwrap();

    let yaml = public_yaml(&ws, "预发");
    assert!(
        !yaml.contains("https://staging.example.com"),
        "标记为密钥后值应当移出公开文件"
    );
    assert_eq!(
        ws.read_secrets().unwrap().environments["预发"]["baseUrl"],
        "https://staging.example.com"
    );
}

#[test]
fn environment_without_secrets_leaves_no_empty_bucket() {
    let (_dir, ws) = temp_workspace();

    ws.save_environment("预发", sample_env()).unwrap();
    assert!(ws.read_secrets().unwrap().environments.contains_key("预发"));

    // 去掉全部 secret 标记后，密钥库里不该留一个空条目
    let mut loaded = ws.list_environments_resolved().unwrap().remove(0);
    for v in &mut loaded.variables {
        v.secret = false;
    }
    ws.save_environment("预发", loaded).unwrap();

    assert!(!ws.read_secrets().unwrap().environments.contains_key("预发"));
}

#[test]
fn deleting_environment_also_drops_its_secrets() {
    let (dir, ws) = temp_workspace();
    ws.save_environment("预发", sample_env()).unwrap();
    ws.save_environment(
        "本地",
        Environment {
            name: "本地".to_owned(),
            variables: vec![var("token", "local-token", true)],
        },
    )
    .unwrap();

    ws.delete_environment("预发").unwrap();

    assert!(!ws.environment_path("预发").exists());
    let secrets = ws.read_secrets().unwrap();
    assert!(
        !secrets.environments.contains_key("预发"),
        "残留的密钥日后会被同名环境静默继承"
    );
    assert!(
        secrets.environments.contains_key("本地"),
        "不得误伤其他环境"
    );

    // 另一个环境的文件也应完好
    assert!(dir.path().join("environments/本地.yaml").exists());
}

#[test]
fn environment_names_with_cjk_and_spaces_round_trip() {
    let (_dir, ws) = temp_workspace();
    let name = "预发 环境";

    ws.save_environment(
        name,
        Environment {
            name: name.to_owned(),
            variables: vec![var("token", "t", true)],
        },
    )
    .unwrap();

    let resolved = ws.list_environments_resolved().unwrap();
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0].name, name);
    assert_eq!(resolved[0].variables[0].value, "t");
}
