# 安全策略

## 报告漏洞

**请不要用公开 issue 报告安全问题。** 用 GitHub 的
[私密漏洞报告](https://github.com/dc-orz/postkiddie/security/advisories/new) 提交，
或发邮件到仓库所有者的 GitHub 公开邮箱。

报告里请尽量包含：受影响的版本与平台、复现步骤、你判断的影响面。
我会在收到后尽快确认，并在修复发布前与你同步进度。

## 这个应用会碰到哪些敏感数据

PostKiddie 是纯本地应用，没有服务端，也不向任何第三方发送遥测。但它确实会接触到凭证，
以下是它的处理方式——如果你发现实际行为与此不符，那就是一个安全问题：

| 数据 | 存放位置 | 是否进 git |
|---|---|---|
| 标记为 `secret` 的环境变量值 | 工作区内 `.postkiddie/secrets.yaml` | **否**，该目录被自动写入 `.gitignore` |
| Cookie / 登录态 | 工作区内 `.postkiddie/cookies.yaml` | **否**，同上 |
| 请求历史（含实际发出的 URL 与响应内容） | 工作区内 `.postkiddie/history.jsonl` | **否**，同上 |
| 请求定义、环境变量的**名字** | `collections/`、`environments/` | 是——这是要共享的契约 |

git 凭证不由本应用管理：所有 git 操作都调用系统 `git` CLI，复用你已配置的
SSH key、credential helper 与 GPG 设置。PostKiddie 不读也不存储它们。

## 两条有意为之的设计约束

**不读浏览器的 cookie 数据库。** 技术上做得到，但「扫描用户的浏览器凭证库」正是
infostealer 的典型行为，一个 API 调试工具不该要求用户在这种事上替它做信任判断。
登录态通过内置登录窗口或手工粘贴获得。完整论证见
[docs/architecture.md](docs/architecture.md#cookie-与登录态同步)。

**路径不可逃逸工作区。** 工作区文件可能由他人编写并通过 `git pull` 进入本机，
因此所有来自文件内容或前端的路径都视为不可信输入，必须经
`storage::paths::resolve_within` 校验（拒绝绝对路径、盘符前缀和任何 `..` 分量）。
如果你找到一条绕过它的路径，那是高优先级漏洞。

Cookie 的域匹配严格按 RFC 6265 实现并有单测覆盖，因为域后缀必须落在点边界上——
否则 `example.com` 的会话会被发给 `notexample.com`。

## 支持范围

项目仍处于一期开发阶段，只有 `main` 分支会收到安全修复。
