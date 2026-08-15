# 存储格式

工作区 = 一个 git 仓库目录。**目录结构即业务结构**，没有数据库、没有索引文件。
用户在 IDE 里直接改文件、或 `git pull` 拉到别人的改动后，重新扫描即得到正确状态。

## 目录布局

```text
my-api-workspace/            ← git 仓库根 = 工作区根
├── .git/
├── .gitignore               ← 首次打开时自动补入 .postkiddie/
├── postkiddie.yaml          ← 工作区标记与全局配置
├── collections/             ← 集合根
│   └── 用户中心/             ← 目录 = 文件夹
│       ├── _folder.yaml     ← 目录元信息（可选）
│       ├── 登录.yaml         ← 文件 = 请求
│       └── 查询资料.yaml
├── environments/
│   ├── 本地.yaml
│   └── 预发.yaml
└── .postkiddie/             ← 本机私有，已 gitignore
    ├── secrets.yaml         ← secret 变量真实值，永不入库
    └── history/             ← 请求历史，纯本地
```

文件名可以直接用中文和空格——现代文件系统与 git 都能正确处理，
可读性远胜转拼音。只有在任一主流平台上非法的字符
（`/ \ : * ? " < > |` 和控制字符）会被替换成 `-`。

## 请求文件

```yaml
name: 用户登录
method: POST
url: "{{baseUrl}}/auth/login"
description: 返回 JWT，有效期 2 小时

params:
  - name: verbose
    value: "1"
    enabled: false          # 保留但不发送，等价于取消勾选

headers:
  - name: Content-Type
    value: application/json
  - name: X-Request-Id
    value: "{{$uuid}}"

body:
  type: json
  content: |
    {
      "username": "admin",
      "password": "{{password}}"
    }

auth:
  type: bearer
  token: "{{token}}"

settings:
  timeoutMs: 5000
  verifyTls: false          # 内网自签证书
```

### 为什么是这个形状

**多行内容用 block scalar（`|`）。** JSON body 原文逐行落盘、零转义，
`git diff` 能精确到 JSON 的某一行。这是选 YAML 而非 JSON 的核心理由——
后者会把 body 转义成一整行，diff 完全不可读。

**只落盘偏离默认的字段。** 一个最简请求就是三行：

```yaml
name: 获取用户
method: GET
url: "{{baseUrl}}/users/1"
```

`settings` 全默认时不写、`enabled: true` 不写、`body.type: none` 不写。
新建请求的文件足够短，diff 里只出现真正的改动。

**header/param 用列表而非字典。** HTTP 允许重名，且顺序对 diff 稳定性至关重要
（字典的序列化顺序不可靠）。列表虽然更冗长，但冗长在 diff 场景下是优点。

**没有 `id` 字段。** 请求的身份就是它相对工作区根的路径。这样：
重命名/移动的语义天然正确、复制文件不会撞 ID、
两个人各自新建请求也不会产生 UUID 冲突。

**未知字段被忽略而非报错。** 团队成员的客户端版本必然参差不齐，
老版本必须能打开新版本写的文件。代价是拼错的字段会被静默丢弃。

### body 类型

| `type` | 字段 | 说明 |
|---|---|---|
| `none` | — | 默认，不落盘 |
| `json` | `content` | 自动设 `application/json` |
| `text` | `content`, `contentType?` | 默认 `text/plain; charset=utf-8` |
| `xml` | `content` | 自动设 `application/xml` |
| `form-urlencoded` | `fields[]` | |
| `multipart` | `fields[]` | 字段可含 `file`（相对工作区根的路径） |
| `binary` | `file`, `contentType?` | |
| `graphql` | `query`, `variables?`, `operationName?` | 打包成标准 GraphQL POST |

`file` 一律是**相对工作区根**的路径，保证仓库在别人机器上也能用。
路径经过越界校验，`../` 会被拒绝。

### auth 类型

`inherit`（默认）· `none` · `basic` · `bearer` · `api-key`

`inherit` 表示沿用父文件夹 → 工作区的设置。这是最常用的情形：
整个集合共用一套 token，不该在每个请求里重复。

## `_folder.yaml`

```yaml
name: 用户中心               # 覆盖目录名作为显示名
description: 账号相关接口

order:                      # 显示顺序
  - 登录.yaml
  - 查询资料.yaml
  - 子目录名

headers:                    # 本目录下所有请求继承
  - name: X-Tenant
    value: "{{tenantId}}"

auth:
  type: bearer
  token: "{{token}}"
```

**`order` 是这里最关键的设计。** 树的显示顺序集中记录在一个文件里，
而不是在每个请求里写 `seq` 序号——拖拽重排只产生一处 diff，
而不是几十个文件的序号集体位移。

`order` 允许不完整：未列出的条目按「文件夹优先、再按名称」排在其后。
外部新建的文件不会消失，也不强制立刻维护顺序。

## 环境与密钥

```yaml
# environments/预发.yaml
name: 预发
variables:
  - name: baseUrl
    value: https://staging.example.com
  - name: token
    value: ""                # secret 的值不入库
    secret: true
    description: 从 SSO 获取
```

`secret: true` 的变量，其 `value` **不会写入 git 跟踪的文件**——
落盘时清空，真实值存在工作区内被 gitignore 的 `.postkiddie/secrets.yaml`：

```yaml
# .postkiddie/secrets.yaml（本机私有）
environments:
  预发:
    token: eyJhbGciOiJIUzI1NiJ9...
```

这样团队通过 git 共享的是「有哪些密钥要填」的契约，而不是密钥本身。
新成员 clone 后会看到需要填哪些值，但拿不到别人的凭证。

在界面上，标题栏右侧的齿轮按钮打开「环境管理」，密钥值在那里填写：
输入框默认打码，可点眼睛临时显示。读取时 Rust 侧会把本机的值合并回来供编辑，
保存时再重新分离——这条往返路径有专门的回归测试
（`src-tauri/tests/environment.rs::round_trip_through_ui_does_not_leak_secrets`），
因为它一旦破，泄露是静默的。

**保护措施**：每次打开工作区都检查 `.gitignore` 是否包含 `.postkiddie/`，
缺失就自动补上。`git pull` 到别人建的仓库、或有人手工改过 `.gitignore`
都可能让这行丢失，而它一旦丢失，本地密钥就会在下一次提交时被推到远端。

## Cookie 与登录态

Cookie 存在 `.postkiddie/cookies.yaml`，与密钥同级、同样被 gitignore。
**这一点没有商量余地**：cookie 就是登录凭证，推到远端等同于把账号交出去，
而 git 历史里的东西撤不干净。

```yaml
cookies:
  - name: sid
    value: abc123...
    domain: example.com      # 不含前导点
    path: /
    hostOnly: true           # 缺省 Domain 属性时只匹配该主机，不下发给子域
    secure: true
    expires: 2026-10-21T07:28:00Z
```

发请求时按 RFC 6265 匹配：域要落在点边界上（`example.com` 的 cookie 不会发给
`notexample.com`）、路径要落在段边界上（`/api` 不匹配 `/apirandom`）、
`secure` 的不随明文 HTTP 发出、过期的不发。响应里的 `Set-Cookie` 会自动回存，
所以「先调登录接口、再调业务接口」这条链路天然成立。

请求设置里的**携带 Cookie** 开关关闭后是完整隔离：既不附带已存的，
也不保存响应返回的——否则「以未登录身份做对照」反而会污染真实会话。

### 三种获取方式

1. **内置登录窗口**（标题栏的 Cookie 按钮）：填入站点地址、点「打开登录」，
   在弹出的窗口里正常登录（SSO、验证码、双因子都可以，那就是个真浏览器），
   回来点「收取」。
2. **粘贴导入**：浏览器 DevTools 里右键请求「Copy as cURL」，整条粘进来即可，
   也接受裸的 `sid=abc; csrf=xyz`。
3. **自动回存**：调用登录接口后，响应的 `Set-Cookie` 自动进罐子。

**不支持直接读取浏览器的 Cookie 数据库**，这是有意的，理由见
[architecture.md](./architecture.md#cookie-与登录态同步)。

## 变量插值

`{{name}}` 语法。优先级由低到高：

```
工作区全局 → 环境公开值 → 本机密钥（.postkiddie/secrets.yaml）
```

密钥最后合并，因此本机的值总能覆盖 git 里那份被清空的占位值。

支持嵌套（`{{baseUrl}}` = `{{scheme}}://{{domain}}`），展开深度上限 10 层，
超过判定为循环引用并报错。

**未定义的变量会报错，不会静默留空。** 发出一个 URL 里带着字面
`{{baseUrl}}` 的请求，排查成本远高于当场报错。
UI 侧另有 `request_check_variables` 命令可在发送前做静态提示。

未闭合的 `{{` 按字面量处理——GraphQL 和模板类 body 里它是合法内容。

## 已知限制

**不保留用户手写的 YAML 注释。** 序列化走 serde，往返一次会丢注释。
要保留需换成基于 AST 的 YAML 库并自行维护节点映射，一期不做。
在 UI 里手工编辑并保存会重写整个文件；纯用外部编辑器改则不受影响。

**字段顺序由 Rust 结构体决定。** 手工调整 YAML 里的字段顺序，
在 UI 保存后会被规整回标准顺序。
