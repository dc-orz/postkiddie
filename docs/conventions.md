# 开发规范

规范的目的是**减少决策**，不是增加约束。凡是能由工具自动执行的，都不写进文档靠人记。

## 工具链

| 工具 | 负责 | 配置 |
|---|---|---|
| Biome 2 | JS/TS/JSON/CSS 的 lint + format + import 排序 | `biome.json` |
| rustfmt | Rust 格式化 | `src-tauri/rustfmt.toml` |
| clippy | Rust lint | `src-tauri/clippy.toml` |
| lefthook | git hooks | `lefthook.yml` |
| EditorConfig | 编辑器基础行为 | `.editorconfig` |

**为什么是 Biome 而不是 ESLint + Prettier**：一个二进制搞定 lint、format、
import 排序三件事，比后者快一到两个数量级，且没有插件版本互相打架的问题。
对一个刚起步、要长期迭代的项目，少三个配置文件和一堆 peer dependency 是实打实的收益。

## Git hooks 的分工

| 时机 | 做什么 | 为什么 |
|---|---|---|
| `pre-commit` | 格式化 + 可自动修的 lint（仅暂存文件） | 快且能自动修，控制在 1 秒内 |
| `pre-push` | 类型检查 + clippy + 全部测试 | 慢但必须拦住 |
| `commit-msg` | Conventional Commits 校验 | |

**pre-commit 绝不放类型检查和测试。** 提交速度直接影响提交频率，
而频繁小步提交正是这个项目想鼓励的工作方式。

绕过（仅限紧急情况）：`git commit --no-verify`。

## 提交信息

[Conventional Commits](https://www.conventionalcommits.org/)，由
`scripts/check-commit-msg.sh` 校验（40 行脚本，不引入 commitlint 全家桶）。

```
<type>(<scope>): <描述>
```

类型：`feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`

范围（可选）：`git` `http` `storage` `ui` `tokens` `domain` …

标题上限 72 字符——超过会在 `git log --oneline` 和 GitHub 列表里被截断。

```
feat(git): 状态栏展示 ahead/behind 计数
fix(http): 修正 multipart 上传时的文件名编码
refactor(storage)!: 集合改用目录结构存放
```

## 目录职责

### Rust（`src-tauri/src/`）

```
commands/    Tauri IPC 边界：解参数、转错误，不含业务规则
http/        请求执行与变量插值
git/         GitBackend trait 及其 CLI 实现
storage/     工作区扫描、YAML 读写、路径安全
terminal/    内置终端的 PTY 会话管理
domain/      纯数据与规则
error.rs     统一错误类型
```

依赖严格自上而下。**`domain/` 里不允许出现 `use tauri::*` 或 `use reqwest::*`**——
保持它能被单元测试直接覆盖，不需要拉起运行时。

### 前端（`src/`）

```
app/          应用组装
components/   纯展示组件，只接收 props
  ui/         无领域概念的基础件（Button、Badge）
  layout/     骨架（TitleBar、StatusBar）
  <domain>/   领域组件（sidebar、request、response、git、terminal）
features/     领域功能组合
stores/       Zustand 全局状态
lib/          工具与 IPC 封装
types/        与 Rust 对应的类型定义
styles/       design tokens 与全局样式
```

**组件不直接 `invoke`**，一律走 `lib/ipc.ts`——那是唯一的 IPC 出口，
便于统一处理类型、错误规整与日志。

## 命名

| 对象 | 约定 | 例 |
|---|---|---|
| 组件文件 | PascalCase | `MethodBadge.tsx` |
| 其他 TS 文件 | kebab-case | `ipc.ts`、`check-commit-msg.sh` |
| Tauri 命令 | `<领域>_<动作>` | `git_status`、`request_send` |
| CSS token | `--pk-<层>-<用途>` | `--pk-bg-surface` |
| Rust 模块 | snake_case，单数 | `storage`、`git` |

文件名规范由 Biome 的 `useFilenamingConvention` 强制，不靠自觉。

## 类型与错误

**Rust 内部**用 `thiserror` 定义具名错误，`?` 向上传播，中间层不 `unwrap`。
跨 IPC 边界时序列化成 `{ kind, message }`。

**前端**按 `kind` 分支（`no-workspace` 引导选目录、`unresolved-variable` 弹变量面板），
**不要靠匹配 message 文本做逻辑判断**——那会在改文案时静默失效。

**类型与命令签名单向从 Rust 生成**：`tauri-specta` 产出 `src/types/bindings.ts`
（**勿手改**），`src/types/api.ts` 只是它的别名层——起顺手的名字、补纯前端常量。
改了 Rust 侧模型跑 `pnpm rs:test` 重新生成。导出做成 `#[cfg(test)]` 而不是 build.rs，
是为了让绑定过期表现成「工作区里多出未提交的改动」，而不是每次编译都重写文件；
CI 里 `git diff --exit-code src/types/bindings.ts` 兜住忘记提交的情况。
没有这道拦截，前端会照旧类型编译通过，直到运行时才拿到对不上的数据。

生成的类型带 `_Serialize` / `_Deserialize` 两个方向，这不是噪声：`skip_serializing_if`
让同一个结构在两个方向上形状不同（出去时省略默认值，进来时缺字段用默认值），
一个类型描述不了两者。**前端的视角是反的**——**收到**的是 `_Serialize`，
**发出**的是 `_Deserialize`；日常用 `api.ts` 里的无后缀别名即可。
这套方案换掉了什么、代价是什么，见 [architecture.md](./architecture.md#4-已知取舍与后续演进)。

## 样式

只用 design token 生成的语义类，**不写字面色值**。
`theme.css` 里清空了 Tailwind 内置调色板，`bg-blue-500` 会直接失效。

需要新颜色 → 去 `tokens.css` 加语义 token。详见 [design-tokens.md](./design-tokens.md)。

## 测试

**Rust**：与实现同文件的 `#[cfg(test)] mod tests`。重点覆盖解析与转换逻辑——
git 输出解析、YAML 序列化、变量插值、路径安全，这些是回归风险最集中的地方。

**前端**：`*.test.ts(x)`，与被测文件同目录，Vitest + jsdom。

写测试的判断标准：**这段逻辑出错时，会不会静默地产生错误结果？**
会的话就写。git status 解析错了不会报错，只会让 UI 显示错的文件状态——这种必须有测试。

## tsconfig 的严格项

除 `strict` 外还开了：

| 选项 | 挡住什么 |
|---|---|
| `noUncheckedIndexedAccess` | 索引签名取值忘记判空 |
| `exactOptionalPropertyTypes` | 给可选属性显式赋 `undefined` |
| `noUnusedLocals` / `noUnusedParameters` | 死代码 |
| `verbatimModuleSyntax` | 类型导入未标 `type`，导致运行时残留 |
| `erasableSyntaxOnly` | 用了不能被单纯擦除的 TS 语法（如 enum） |

这些会让写代码时多几次调整，但每一条都对应一类线上会出现的问题。

## 新增依赖

加之前先问：**能不能用标准库或已有依赖做到？**

已经拒绝过的：commitlint 全家桶（40 行脚本替代）、
Pillow（图标生成用标准库 zlib 手写 PNG）、ESLint + Prettier（Biome 替代）。

确实需要时，在 PR 描述里写清替代方案和选择理由。
Rust 侧新增依赖注意 feature 收敛，`default-features = false` 起步。
