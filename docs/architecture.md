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

### Cookie 与登录态同步

需求是「把浏览器里已登录的会话拿进来调接口」。三条路：

| 方案 | 取舍 |
|---|---|
| **内置登录窗口** ✅ | 开一个属于本应用的 WebView 加载目标站点，用户在里面正常登录，cookie 天然属于这个 WebView，`cookies_for_url` 读出即可。无需任何特殊权限，三端一致，SSO/验证码/双因子全都照常工作 |
| **粘贴导入** ✅（兜底） | 接受 DevTools 的「Copy as cURL」或裸 Cookie 头。零门槛、永远可用 |
| 读浏览器的 Cookie 数据库 ❌ | 技术上做得到，但代价与风险都不成立 |

最后一条值得说清楚为什么不做。Chrome 的 cookie 存在 SQLite 里，值用 Keychain（macOS）
或 DPAPI（Windows）中的密钥加密；Safari 是私有二进制格式且需要完全磁盘访问权限。
即便逐个平台实现出来：

- Chrome 127+ 在 Windows 上加了 App-Bound Encryption，这条路基本被封死
- 每次读取都要弹系统授权，体验并不比「在我们的窗口里登录一次」更好
- **「扫描用户的浏览器凭证库」正是 infostealer 的典型行为**，杀软会直接报毒——
  一个 API 调试工具不该要求用户在这种事情上替它做信任判断

匹配规则严格按 RFC 6265 实现并单测覆盖（`domain/cookie.rs`），
因为这里的每一条边界都对应过真实的越权事故：域后缀必须落在点边界上，
否则 `example.com` 的会话会被发给 `notexample.com`。

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

**类型双写（已解决）。** 曾经 `src/types/api.ts` 是 Rust 模型的手工镜像，
预设的触发条件是「出现第一次因漂移导致的问题」。实际触发了两次：

1. `RequestSettings` 漏了 `rename_all`，后端写 `timeout_ms`、前端读 `timeoutMs`，
   用户改的超时与 TLS 开关每次保存后悄悄变回默认值。
2. `Environment.variables` 带着 `skip_serializing_if`，空环境发到前端缺这个字段，
   `.some()` 抛异常、React 卸掉整棵子树，表现为「点开环境管理是一片黑」。

现在类型与命令签名都由 `tauri-specta` 从 Rust 生成到 `src/types/bindings.ts`
（勿手改），`types/api.ts` 退化成别名层，`lib/ipc.ts` 只负责把生成的
`{ status: "ok" | "error" }` 摊平成「返回值 / 抛异常」并保留 `IpcCallError`。

**生成的类型带 `_Serialize` / `_Deserialize` 两个方向**，这不是噪声而是要害：
`skip_serializing_if` 让同一个结构在两个方向上形状不同（出去时省略默认值，
进来时缺字段用默认值），specta 直接拒绝把它们合并成一个类型。上面两个 bug
都源于把两者当成一回事。前端视角是反的——**收到**的是 `_Serialize`，
**发出**的是 `_Deserialize`；日常用 `types/api.ts` 里的无后缀别名即可。

引入它还顺带逼出了三处本就该改的东西：`ErrorKind` 从 `&'static str` 变成
真正的枚举（match 穷尽性替代了「记得同步维护」的注释，且导出为字面量联合）；
IPC 边界上的 `u64`/`usize` 收窄为 `u32`（JS 的 number 装不下 64 位整数，
`usize` 的宽度还随平台变）；`SettingsTab` 的入参改成 `Required<RequestSettings>`，
残缺对象再也传不进去。

**代价**：`tauri-specta` 2.x 至今仍是 release candidate（当前 `2.0.0-rc.25`），
rc 之间有过破坏性改动。接受它是因为替代品更差——手写已经被证明会静默出错，
而自己写生成器是重复造轮子。CI 里有一步 `git diff --exit-code src/types/bindings.ts`：
改了 Rust 模型却没提交重新生成的绑定，构建会红。

**不保留用户手写的 YAML 注释。** 序列化走 serde，往返一次会丢掉注释。
要保留需换成基于 AST 的 YAML 库（如 `yaml_rust2`）并自行维护节点映射，
一期不值得。UI 上会对「外部编辑过的文件」给出提示。

**单工作区。** 多工作区通过多开窗口实现，这样每个窗口的 git 分支上下文彼此独立。

**一期不做的**：gRPC/WebSocket、脚本与断言（pre-request / test）、Mock Server。

**请求历史**落在 `.postkiddie/history.jsonl`，与 secrets / cookies 同处
被 gitignore 的目录：历史带着实际发出的 URL 与响应内容，那是「我这台机器上
发生过什么」，不是团队要共享的契约。响应体按 256KB 截断并标记，
二进制不留内容，攒到 750 条压缩回 500。

**Postman 导入**支持 Collection v2.x。查询串会从 URL 上摘下来放进 params——
Postman 的 `raw` 里已经带着启用的 query，照搬又填 params 会让参数发两遍。
认不出的方法与认证类型一律降级（GET / Inherit）而非丢弃整条请求。

## 5. 系统要求

design token 使用了 CSS 原生 `light-dark()`，这决定了下限：

| 平台 | 最低版本 | 原因 |
|---|---|---|
| macOS | 14.5 | Safari 17.5 起支持 `light-dark()` |
| Windows | WebView2（自动更新） | Chromium 123+，实际用户均已满足 |
| Linux | WebKitGTK 2.44+ | 同上 |

若必须支持更老的系统，替代方案是把 `light-dark()` 拆成
`@media (prefers-color-scheme)` + `[data-theme]` 两套声明——代价是 token 定义翻倍。
