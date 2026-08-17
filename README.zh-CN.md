<div align="center">
  <img src="src-tauri/icons/128x128.png" width="72" alt="PostKiddie" />
  <h1>PostKiddie</h1>
  <p><strong>把 HTTP 请求当代码管。</strong><br />以纯文本 YAML 存在你自己的 Git 仓库里，用 <code>git push</code> 共享。</p>

[![CI](https://github.com/dc-orz/postkiddie/actions/workflows/ci.yml/badge.svg)](https://github.com/dc-orz/postkiddie/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#系统要求)

[English](README.md) · **简体中文**

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
| 冲突解决 | 平台策略 | 你本来就熟的 git 合并流程 |
| 权限控制 | 平台角色 | 仓库权限 |
| 离线可用 | 受限 | 完全可用 |

「用 git 做共享」不只是省掉一个后端，它顺带解决了协作类工具最难的几件事：
谁改的、改了什么、怎么回退、怎么评审、怎么控制权限——这些 git 已经解决了二十年。
于是接口调试自然获得了代码的工作方式：开分支试新接口、发 PR 评审接口变更、
`git blame` 查这个 header 是谁加的、`git revert` 回退一次误改。

## 特性

- **请求即文件**——一个请求一个 YAML 文件，**路径就是它的身份**。所以重命名与移动的语义
  天然正确，复制文件不撞 ID，两人各自新建也不会产生 UUID 冲突。
- **diff 是可读的**——多行 JSON body 用 YAML block scalar 原样落盘，零转义，
  `git diff` 能精确到 JSON 的某一行。
- **密钥不出本机**——标记为 `secret` 的环境变量，其值永不写进 git。
  团队共享的是「有哪些密钥要填」的契约，不是密钥本身。
- **内置真终端**——真 PTY，跑的是你自己的 shell，开在工作区根目录。补全、历史、别名、
  分页器、交互式命令（`git add -p`、`git rebase -i`）全都在。在里面 `git checkout`，
  界面会跟着变。
- **git 状态常驻可见**——分支与 ahead/behind 在状态栏；切分支、暂存、提交、
  逐文件 diff、推送拉取都在应用内完成。
- **登录态捕获**——用内置窗口正常登录，或直接粘贴 `Cookie` 头 / 整条 `curl`。
  PostKiddie 不会去读你浏览器的凭证库（[为什么](docs/architecture.md#cookie-与登录态同步)）。
- **永远没有云端**——依赖的只有文件系统和你机器上那个 `git`。

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

完整格式见 [docs/storage-format.md](docs/storage-format.md)。

## 系统要求

| 平台 | 最低版本 | 验证程度 |
|---|---|---|
| macOS | 14.5 | 开发与日常使用的平台 |
| Linux | WebKitGTK 2.44+ | CI 上编译通过、全部测试通过 |
| Windows | 10/11（WebView2 自动更新） | CI 上编译通过，**运行时未经验证** |

版本下限由 design token 使用的 CSS `light-dark()` 决定，
原因见 [docs/architecture.md](docs/architecture.md#5-系统要求)。

关于 Windows 说清楚一点：平台相关的代码路径都写了也编译得过，但测试二进制目前在那里
以 `0xc0000139`（`STATUS_ENTRYPOINT_NOT_FOUND`）启动失败——那是 DLL 加载阶段的错误，
发生在任何测试代码执行之前。所以现在的状态是「没有已知的坏，但也没有验证过的好」。
如果你在 Windows 上用并遇到问题，带上系统版本提个 issue 会很有帮助；
排查的切入点记在 [.github/workflows/ci.yml](.github/workflows/ci.yml) 的注释里。

## 快捷键

| 操作 | 快捷键 |
|---|---|
| 保存请求 | `⌘S` / `Ctrl+S` |
| 发送请求 | `⌘↩` / `Ctrl+Enter` |
| 提交（Git 面板内） | `⌘↩` / `Ctrl+Enter` |
| 开关终端 | `` ⌘` `` / `` Ctrl+` `` |
| 切换分支 | 点状态栏左侧的分支名 |
| 查看某个文件的差异 | 在 Git 面板里点文件名 |
| 调整面板 | 聚焦分割条后按方向键，`Shift` 加速，`Home`/`End` 到边界，双击恢复默认 |

## 一期范围

**已实现**

- 工作区：打开/初始化（目录不是 git 仓库时引导就地 `git init`）、最近打开、启动自动重开、
  标题栏随时切换（切换时请求、git 状态与终端会话一并作废，有未保存改动会先问一声）
- 集合：目录树、新建/重命名/删除请求与文件夹、拖拽排序（只改 `_folder.yaml` 一处）、
  损坏文件标红而非消失
- 请求：方法与 URL、查询参数与请求头（可逐条启用/禁用）、
  JSON/文本/XML/Form/Multipart/二进制/GraphQL 请求体、四种认证方式、
  超时与 TLS 校验等请求级设置
- 编辑器：CodeMirror 6 语法高亮、`{{变量}}` 高亮（未定义的标红波浪线）、JSON 格式化（保留变量）
- 响应：状态码/耗时/体积、语法高亮、JSON 美化开关、响应头表格、一键复制、另存为文件
- 环境：环境切换、变量插值、`secret` 变量不入库
- Cookie：按域查看与删除、粘贴导入（`Cookie` 头或整条 curl）、内置登录窗口捕获会话
- 历史：每次发送都记进 `.postkiddie/history.jsonl`，可回看请求与响应
- 导入：Postman Collection v2.x
- Git：状态栏常驻分支与 ahead/behind、分支切换与新建、变更列表（暂存/工作区分区）、
  暂存/取消暂存/丢弃、提交、推送拉取、逐文件差异对比、集合树上的文件状态标记
- 终端：内置真 PTY，就是你平时那个 shell（补全、历史、别名、分页、颜色、交互式命令都在），
  开在工作区根目录；跑完命令自动重扫集合树与 git 状态，所以 `git checkout` 之后界面会跟着变
- 布局：侧栏、请求区与终端可拖拽调整并持久化，键盘同样可操作

**尚未实现**

- gRPC / WebSocket
- 脚本与断言（pre-request / test）
- Mock Server
- 集合批量运行（Runner）、代码生成（导出成 curl / fetch 片段）
- 并排式差异对比（目前是行内 unified，与 `git diff` 一致）

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
| 终端 | portable-pty（真 PTY）+ xterm.js |
| 工程 | Biome（lint + format）· lefthook · rustfmt + clippy |

每一项的选择理由（以及被否掉的方案）见 [docs/architecture.md](docs/architecture.md)。

## 文档

- [架构与技术选型](docs/architecture.md) — 每个决策及其理由
- [Design Tokens](docs/design-tokens.md) — 设计系统
- [存储格式](docs/storage-format.md) — YAML schema
- [开发规范](docs/conventions.md) — 代码风格、提交约定、目录职责

## 参与贡献

欢迎提 issue 和 PR。先看 [CONTRIBUTING.md](CONTRIBUTING.md)，
里面写清了工具链、提交格式，以及 git hook 在你推送前会拦下什么。

## License

[MIT](LICENSE)
