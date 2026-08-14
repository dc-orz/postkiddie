<div align="center">
  <img src="src-tauri/icons/128x128.png" width="72" alt="PostKiddie" />
  <h1>PostKiddie</h1>
  <p>把 HTTP 请求当代码管：本地 Git 目录持久化，<code>git push</code> 共享。</p>
</div>

---

## 这是什么

一个轻量的 HTTP 客户端桌面应用。请求以纯文本 YAML 存放在你的 git 仓库里，
版本管理和团队共享直接用 git——没有账号，没有云端，没有后端。

|  | Postman | PostKiddie |
|---|---|---|
| 数据存放 | 云端 + 本地缓存 | 本地 git 仓库，纯文本 |
| 共享方式 | 账号 / 团队工作区 | `git push` / `git pull` |
| 版本管理 | 平台内置历史 | git 本身（分支、diff、blame、revert） |
| 权限控制 | 平台角色 | 仓库权限 |
| 离线可用 | 受限 | 完全可用 |

于是接口调试自然获得了代码的工作方式：开分支试新接口、发 PR 评审接口变更、
`git blame` 查这个 header 是谁加的、`git revert` 回退一次误改。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Tauri 2（系统 WebView，安装包 ~10 MB） |
| 前端 | React 19 · TypeScript 7 · Vite 8 · Tailwind 4 |
| 状态 | Zustand 5 |
| 编辑器 | CodeMirror 6 |
| 后端 | Rust 2024 · tokio · reqwest（rustls + 系统根证书） |
| 存储 | YAML（`serde_norway`），一请求一文件 |
| Git | 调用系统 `git` CLI，复用用户已有的凭证与配置 |
| 工程 | Biome（lint + format）· lefthook · rustfmt + clippy |

选型理由见 [docs/architecture.md](docs/architecture.md)。

## 快速开始

需要 Node ≥ 22、pnpm、Rust stable、git，以及各平台的 Tauri 系统依赖
（见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)）。

```bash
pnpm install
pnpm app:dev
```

常用命令：

| 命令 | 作用 |
|---|---|
| `pnpm app:dev` | 启动桌面应用（含热更新） |
| `pnpm dev` | 只启动前端，浏览器里调 UI |
| `pnpm app:build` | 打包安装程序 |
| `pnpm check` | 全量检查：lint + 类型 + 对比度 + rustfmt + clippy |
| `pnpm test` / `pnpm rs:test` | 前端 / Rust 单元测试 |
| `pnpm lint:fix` | 自动修复格式与可修的 lint |
| `pnpm check:contrast` | 校验 design token 的 WCAG 对比度 |

## 工作区长什么样

```text
my-api-workspace/            ← 你的 git 仓库
├── postkiddie.yaml
├── collections/
│   └── 用户中心/
│       ├── _folder.yaml     ← 显示顺序、目录级 header/auth
│       └── 登录.yaml
├── environments/
│   └── 本地.yaml
└── .postkiddie/             ← 本机私有，自动 gitignore
    └── secrets.yaml         ← 密钥真实值，永不入库
```

一个请求就是一个文件：

```yaml
name: 用户登录
method: POST
url: "{{baseUrl}}/auth/login"
headers:
  - name: Content-Type
    value: application/json
body:
  type: json
  content: |
    {
      "username": "admin",
      "password": "{{password}}"
    }
```

多行 body 用 YAML block scalar 原样落盘，零转义——`git diff` 能精确到 JSON 的某一行。

标记为 `secret` 的环境变量，其值不会写进 git，只存在本机的 `.postkiddie/secrets.yaml`。
团队共享的是「有哪些密钥要填」的契约，不是密钥本身。

完整格式见 [docs/storage-format.md](docs/storage-format.md)。

## 系统要求

| 平台 | 最低版本 |
|---|---|
| macOS | 14.5 |
| Windows | 10/11（WebView2 自动更新） |
| Linux | WebKitGTK 2.44+ |

下限由 design token 使用的 CSS `light-dark()` 决定，
原因见 [docs/architecture.md](docs/architecture.md#5-系统要求)。

## 文档

- [架构与技术选型](docs/architecture.md) — 每个决策及其理由
- [Design Tokens](docs/design-tokens.md) — 设计系统
- [存储格式](docs/storage-format.md) — YAML schema
- [开发规范](docs/conventions.md) — 代码风格、提交约定、目录职责

## 快捷键

| 操作 | 快捷键 |
|---|---|
| 保存请求 | `⌘S` / `Ctrl+S` |
| 发送请求 | `⌘↩` / `Ctrl+Enter` |
| 提交（Git 面板内） | `⌘↩` / `Ctrl+Enter` |
| 调整面板 | 聚焦分割条后按方向键，`Shift` 加速，`Home`/`End` 到边界，双击恢复默认 |

## 一期范围

**已实现**

- 工作区：打开/初始化（目录不是 git 仓库时引导就地 `git init`）、最近打开、启动自动重开
- 集合：目录树、新建请求/文件夹、`_folder.yaml` 控制显示顺序、损坏文件标红而非消失
- 请求：方法与 URL、查询参数与请求头（可逐条启用/禁用）、JSON/文本/XML/Form/GraphQL 请求体、
  四种认证方式、超时与 TLS 校验等请求级设置
- 编辑器：CodeMirror 6 语法高亮、`{{变量}}` 高亮（未定义的标红波浪线）、JSON 格式化（保留变量）
- 响应：状态码/耗时/体积、语法高亮、JSON 美化开关、响应头表格、一键复制
- 环境：环境切换、变量插值、`secret` 变量不入库
- Git：状态栏常驻分支与 ahead/behind、变更列表（暂存/工作区分区）、暂存/取消暂存/丢弃、
  提交、推送拉取、集合树上的文件状态标记
- 布局：侧栏与请求区可拖拽调整并持久化，键盘同样可操作

**尚未实现**

- 请求重命名与拖拽排序、multipart/binary 请求体、Cookie 视图、响应另存为
- 差异对比视图、分支切换 UI、历史记录
- gRPC/WebSocket、脚本与断言、Mock Server、Postman 集合导入（导入最可能优先补上）

## License

[MIT](LICENSE)
