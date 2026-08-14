# 架构与技术选型

本文记录一期的关键决策**及其理由**。理由比结论重要——将来推翻某个决定时，
先确认它当初成立的前提是否已经变化。

## 1. 出发点

Postman 卡顿的根因不在 Electron 本身，而在它是一个**装在桌面壳里的云产品**：
账号体系、团队同步、Mock Server、监控告警全都常驻，冷启动要加载几十 MB 的
JS bundle，一个本地接口调试要经过一整套云端状态机。

PostKiddie 反过来：**没有账号、没有云、没有后端**。持久化交给文件系统，
共享交给 git，这两样目标用户本来就每天在用。

| | Postman | PostKiddie |
|---|---|---|
| 数据存放 | 云端 + 本地缓存 | 本地 git 仓库，纯文本 |
| 共享方式 | 账号 / 团队工作区 | `git push` / `git pull` |
| 版本管理 | 平台内置历史 | git 本身（分支、diff、blame、revert） |
| 冲突解决 | 平台策略 | 用户熟悉的 git 合并流程 |
| 权限控制 | 平台角色 | 仓库权限 |
| 离线可用 | 受限 | 完全可用 |

「用 git 做共享」不只是省掉一个后端，它顺带解决了协作类工具最难的几件事：
谁改的、改了什么、怎么回退、怎么评审、怎么控制权限——这些 git 已经解决了二十年。

## 2. 技术选型

### 桌面框架：Tauri 2

| 方案 | 取舍 |
|---|---|
| **Tauri 2** ✅ | 系统 WebView，安装包 ~10 MB、内存占用低一个数量级；Rust 侧发请求可绕开 CORS、可控 TLS 校验 |
| Electron | 生态最成熟，但每个应用自带一份 Chromium，正是要规避的东西 |
| Wails | 与 Tauri 定位接近，Go 生态；Rust 在 HTTP/TLS/解析类库上更对口 |
| 原生（SwiftUI/WinUI） | 观感最好，但要写三套 |

代价是各平台 WebView 内核不同（macOS WebKit / Windows Chromium / Linux WebKitGTK），
CSS 特性需按最低版本取交集，见下方「系统要求」。

### 前端：React 19 + TypeScript 7 + Vite 8

选 React 不是因为它最快，而是因为这类工具重度依赖成熟组件：
CodeMirror 6（编辑器）、TanStack Virtual（万级历史记录虚拟滚动）、
Ark UI（无样式可访问组件）、dnd-kit（拖拽排序）——React 版本都是一等公民。

性能靠架构而非框架保证：虚拟滚动、请求执行放 Rust 侧、避免大对象进 React state。

TypeScript 7 是原生 Go 编译的正式版，类型检查比 5.x 快约一个数量级，
`pnpm typecheck` 从「泡杯咖啡」变成「眨个眼」，这对提交前检查的实际执行率影响很大。

### 样式：Tailwind 4 + CSS 变量三层 token

见 [design-tokens.md](./design-tokens.md)。要点是 `@theme inline` 桥接 + 清空内置调色板，
让偏离设计系统的写法在编译期失效。

### 存储：YAML，一请求一文件

| 方案 | 取舍 |
|---|---|
| **YAML** ✅ | diff 逐行干净；多行 JSON body 用 block scalar 原样落盘；支持注释；`serde_norway` 零 parser 开发量 |
| JSON | 实现最省事，但 body 被转义挤成单行，git diff 几乎不可读——与项目核心诉求直接冲突 |
| `.http` 格式 | 对后端最直观、IDE 可直接打开，但脚本/断言/认证等结构化元数据在纯文本格式里表达笨拙 |
| 自定义 DSL（如 Bruno `.bru`） | 可读性与结构性兼顾，但要自研并长期维护 parser |

**请求没有 `id` 字段**，身份就是它相对工作区根的路径。这样重命名/移动语义天然正确、
复制文件不撞 ID、两人各自新建也不会产生 UUID 冲突。

**显示顺序集中在 `_folder.yaml` 的 `order` 数组里**，而不是每个请求写 `seq` 序号。
拖拽重排只产生一处 diff，而非几十个文件的序号集体位移。

详细格式见 [storage-format.md](./storage-format.md)。

### Git：调用系统 `git` CLI

| 方案 | 取舍 |
|---|---|
| **系统 git CLI** ✅ | 直接复用用户已配好的 SSH key、credential helper、GPG 签名、代理、`insteadOf` 规则——推送认证这个最大的坑直接消失 |
| git2-rs (libgit2) | API 结构化，但读不到 `credential.helper` 与 gpg 配置，私有仓库推送体验打折 |
| gitoxide (gix) | 纯 Rust、无 C 依赖，但写操作 API 仍在演进 |

代价是要解析命令行输出，因此全部收敛到 `GitBackend` trait 之后
（`src-tauri/src/git/mod.rs`），将来换实现只需新增一个 impl。

CLI 实现里有两个必须处理的坑，都写在 `git/cli.rs` 的注释里：

1. **`GIT_TERMINAL_PROMPT=0`**。GUI 进程没有 tty，凭证提示会让子进程永久等待输入，
   表现为整个应用卡死。
2. **显式查找 git 可执行文件**。macOS 上从 Finder 启动的应用继承 launchd 的精简 PATH，
   拿不到 Homebrew 路径——这是「终端里好好的，打包成 app 就找不到 git」的根因。

### HTTP：reqwest + rustls（native-roots）

用 `rustls-tls-native-roots` 而非纯 rustls：读取系统根证书，
企业自签 CA 装在钥匙串里时才能直接工作。

## 3. 分层

```
commands/          Tauri IPC 边界：解参数、转错误，不含业务规则
    ↓
http/ git/ storage/   副作用层：网络、子进程、文件系统
    ↓
domain/            纯数据与规则，可脱离 Tauri 单元测试
```

依赖严格自上而下。`domain/` 里不允许出现 `use tauri::*` 或 `use reqwest::*`。

前端对应：

```
components/   纯展示，只接收 props
    ↓
features/     领域功能组合
    ↓
stores/       Zustand 全局状态
    ↓
lib/ipc.ts    唯一的 IPC 出口
```

组件不直接 `invoke`，一律走 `lib/ipc.ts`，以便统一处理类型、错误规整与日志。

## 4. 已知取舍与后续演进

**类型双写。** `src/types/api.ts` 是 Rust 模型的手工镜像，存在漂移风险。
一期刻意不引入代码生成，是为了让新贡献者读两个文件就能看懂整条数据链路。
**触发条件**：当模型字段数翻倍、或出现第一次因漂移导致的线上问题时，引入
`tauri-specta` 从 Rust 自动生成。

**不保留用户手写的 YAML 注释。** 序列化走 serde，往返一次会丢掉注释。
要保留需换成基于 AST 的 YAML 库（如 `yaml_rust2`）并自行维护节点映射，
一期不值得。UI 上会对「外部编辑过的文件」给出提示。

**单工作区。** 多工作区通过多开窗口实现，这样每个窗口的 git 分支上下文彼此独立。

**一期不做的**：gRPC/WebSocket、脚本与断言（pre-request / test）、
Mock Server、Postman 集合导入。导入是最可能被优先补上的一项。

## 5. 系统要求

design token 使用了 CSS 原生 `light-dark()`，这决定了下限：

| 平台 | 最低版本 | 原因 |
|---|---|---|
| macOS | 14.5 | Safari 17.5 起支持 `light-dark()` |
| Windows | WebView2（自动更新） | Chromium 123+，实际用户均已满足 |
| Linux | WebKitGTK 2.44+ | 同上 |

若必须支持更老的系统，替代方案是把 `light-dark()` 拆成
`@media (prefers-color-scheme)` + `[data-theme]` 两套声明——代价是 token 定义翻倍。
