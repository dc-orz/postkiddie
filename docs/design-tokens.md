# Design Tokens

设计风格定位：**清爽简约的桌面工具**。三条原则贯穿整套 token：

1. **靠边框与明度层次划分区域，不靠阴影和色块。** 阴影只留给真正浮起的元素
   （菜单、弹层、模态）。平面内的分隔一律用 1px 边框。
2. **信息密度优先。** 基准字号 12px、控件高度 28px、树行高 26px，
   比网页小一档——工具应用一屏能看到的东西越多越好用。
3. **颜色即语义。** 全应用只有一个强调色；其余彩色一律承担语义
   （HTTP 方法、状态码、git 状态），不作装饰。

## 文件分工

| 文件 | 职责 |
|---|---|
| `src/styles/tokens.css` | token 定义。**唯一的真相来源** |
| `src/styles/theme.css` | 把语义 token 桥接成 Tailwind 工具类 |
| `src/styles/global.css` | 引入顺序 + 无法用工具类表达的全局行为 |

## 三层结构

```
Primitive   --pk-gray-500 / --pk-green-600      原始色阶，不随主题变化
    ↓                                            ⛔ UI 代码禁止直接引用
Semantic    --pk-bg-surface / --pk-text-muted   按用途命名，主题在此层切换
    ↓                                            ✅ 组件默认用这层
Component   --pk-method-get / --pk-status-2xx   领域专用
```

单向依赖。语义层引用原始层，组件层引用语义层或原始层，反向引用一律禁止。

**要加新颜色，去 tokens.css 加语义 token，不要在组件里写字面色值。**
`theme.css` 里用 `--color-*: initial` 清空了 Tailwind 内置调色板，
`bg-blue-500` 这类写法会直接失效——这是编译期的护栏，不是靠自觉。

## 主题机制

用 CSS 原生 `light-dark()`，亮暗两个值写在同一行：

```css
--pk-bg-surface: light-dark(var(--pk-gray-0), var(--pk-gray-950));
```

取哪个由 `color-scheme` 决定：

| 模式 | `color-scheme` | 触发方式 |
|---|---|---|
| 跟随系统 | `light dark` | `:root` 默认 |
| 强制亮色 | `light` | `<html data-theme="light">` |
| 强制暗色 | `dark` | `<html data-theme="dark">` |

相比传统的「`@media (prefers-color-scheme)` + `[data-theme]` 两套声明」，这套做法：

- token 只定义一份，不会出现改了亮色忘了改暗色
- 切换零 JS 参与，不闪烁、不重排（`stores/theme.ts` 只负责写 `data-theme` 属性）
- 滚动条、原生 `input`/`select` 等系统控件自动跟随，无需额外样式

代价是最低系统要求提高到 macOS 14.5 / WebKitGTK 2.44，见
[architecture.md](./architecture.md#5-系统要求)。

### `light-dark()` 只能包颜色

它是**颜色函数**，两个参数都必须是 `<color>`。拿它去包一整条复合值，
CSS 会判定整个属性无效并静默丢弃——不报错，只是那条声明从此不存在：

```css
/* 错：整条 box-shadow 被当成参数，结果是 box-shadow: none */
--pk-shadow-overlay: light-dark(0 16px 48px oklch(0% 0 0 / .18), 0 16px 48px oklch(0% 0 0 / .65));

/* 对：偏移与模糊半径留在外面，只有颜色交给它 */
--pk-shadow-overlay: 0 16px 48px -12px light-dark(oklch(0% 0 0 / .18), oklch(0% 0 0 / .65));
```

这条曾让项目里**全部五个阴影 token 长期无声失效**：写法看着合理、构建不报错、
lint 也查不出，只有去读计算值才会发现 `box-shadow` 一直是 `none`。
`border`、`background`、`transition` 等复合属性同理。

## Tailwind 类名映射

`bg-*`、`text-*`、`border-*` 在 Tailwind 4 中**共用** `--color-*` 一个命名空间，
因此类名必须整体无歧义。约定的前缀：

| 用途 | 前缀 | 示例 |
|---|---|---|
| 背景 | 无 | `bg-surface` `bg-hover` `bg-sunken` `bg-selected` |
| 前景 | `fg-` | `text-fg` `text-fg-muted` `text-fg-subtle` |
| 描边 | `line-` | `border-line` `border-line-subtle` `border-line-strong` |
| 强调 | `accent` | `bg-accent` `text-accent-fg` `bg-accent-soft` |
| 状态 | 语义名 | `text-danger` `bg-warning-soft` `border-success-line` |

布局尺寸注册在 `--spacing-*` 下（Tailwind 4 没有 `--height-*` 命名空间），
所以 `h-titlebar`、`h-control-md`、`w-sidebar` 这些类是可用的。

## 色板

中性色是带冷调的灰（OKLCH hue 264）。用 OKLCH 而非 HSL 是因为它感知均匀：
同一 lightness 下不同色相的视觉权重一致——这是「一列 method 徽章排开时
没有哪个颜色显得特别跳」的前提。

### HTTP Method

侧边栏里出现频率最高的元素。只用文字色不加底色（几十行列表里每行一个色块太吵），
固定 52px 宽右对齐，让请求名垂直对齐。

| 方法 | 色相 | token |
|---|---|---|
| GET | 绿 152 | `--pk-method-get` |
| POST | 琥珀 78 | `--pk-method-post` |
| PUT | 蓝 235 | `--pk-method-put` |
| PATCH | 紫 300 | `--pk-method-patch` |
| DELETE | 红 25 | `--pk-method-delete` |
| HEAD | 青 195 | `--pk-method-head` |
| OPTIONS | 灰 | `--pk-method-options` |

### 状态码与 Git

状态码按首位取色：2xx 绿、3xx 蓝、4xx 琥珀、5xx 红、1xx 灰。

Git 状态复用同一套色相：added 绿、modified 琥珀、deleted 红、renamed 蓝、
untracked 灰、conflicted 红（更亮一档以示紧急）。
侧边栏用单字符标记（`A`/`M`/`D`/`R`/`U`/`!`）而非色块，密集列表里更安静。

## 尺寸

**字号**（基准比网页小一档）

| token | 值 | 用途 |
|---|---|---|
| `text-2xs` | 10px | 角标、git 标记 |
| `text-xs` | 11px | 辅助说明、时间戳 |
| `text-sm` | 12px | **默认 UI 文本** |
| `text-base` | 13px | 编辑器、表格正文 |
| `text-md` | 14px | 输入框 |
| `text-lg` / `text-xl` / `text-2xl` | 16/20/24px | 标题、空状态 |

**布局高度**

`h-titlebar` 36px · `h-toolbar` 36px · `h-tab` 32px · `h-statusbar` 24px ·
`h-row` 26px · `h-control-sm/md/lg` 24/28/32px · `w-sidebar` 260px

### 上表的 px 都是 rem 写的，这是界面缩放的前提

尺寸类 token 一律用 `rem` 表达（`h-row: 1.625rem` 而非 `26px`），
于是整个界面的缩放就是根字号一个变量的事：

```css
html { font-size: calc(100% * var(--pk-ui-scale, 1)); }
```

`stores/settings.ts` 只写 `--pk-ui-scale`，字号、行高、控件高度、侧栏宽度、
滚动条粗细、CodeMirror 内部排版会一起等比变化，**没有任何组件需要感知缩放的存在**。
基准取 `100%` 而不是 `16px`，这样用户在系统层面调过的默认字号仍然被尊重。

新增尺寸 token 时写 px 不会报错，但那一处会在缩放时纹丝不动，
在放大到 125% 的界面里格外扎眼。

默认档位是「自动」，按 `screen.width` 推断（≥2560 → 125%，≥1920 → 110%）。
判据只看逻辑宽度、不掺 `devicePixelRatio`：系统的显示缩放已经把 DPI 归一化了，
27" 1080p 与 27" 4K@2x 的逻辑宽度都是 1920，而它们摆在桌上一样大。
阈值是经验值不是测量结果，用户可以固定一档覆盖它。

**圆角**：默认 `rounded-md` = 6px。桌面工具用小圆角显得精准，
大圆角显得像消费级 App。模态框用 12px。

**动效**：上限 260ms，绝大多数交互落在 **120ms**（`duration-fast`）。
桌面应用的动画必须比网页更快，否则直接被感知为「卡」。
`prefers-reduced-motion` 下全部归零。

## 可访问性

- 焦点环用 `:focus-visible`（键盘导航才显示），任何情况下不得 `outline: none` 了事
- 单字符 git 标记带 `role="img"` + `aria-label`，读屏时读出「已修改」而不是字母 M
- 数值列一律加 `pk-tnum`（等宽数字），避免连续请求时数字宽度变化导致行内抖动

### 对比度是被检查的，不是被声称的

```bash
pnpm run check:contrast
```

`scripts/check-contrast.mjs` 解析 `tokens.css`，把 OKLCH 转成 sRGB 按 WCAG 2.1
计算对比度，覆盖**亮暗各 129 组**前景/背景组合（每个 method / 状态码 / git 状态色
× 每种可能压在其下的背景）。低于阈值即 exit 1。

已接入 `pnpm check`、CI，以及 `tokens.css` 变动时的 pre-commit hook。

| 类别 | 阈值 |
|---|---|
| 正文、method、状态码、git 状态 | 4.5:1（AA） |
| `text-fg-subtle`（占位符、纯装饰） | 2.8:1 |

**这个脚本不是形式主义。** 简约风格依赖细微的色彩层次，而「层次细微」和「看不清」
只隔一条线，凭肉眼调必然出偏差。初版实测就抓出三处不达标，其中主按钮的白字
只有 3.63:1——这是最显眼、最该达标的一个元素：

| 问题 | 调整 |
|---|---|
| 暗色主按钮白字 3.63:1 | `--pk-accent-bg` 暗色不再用更亮的 500，与亮色统一为 600；hover/active 走「更深」而非「更亮」 |
| 亮色 `text-muted` 4.02:1 | 新增 `gray-550`，muted 亮色改用它 |
| 亮色 `text-subtle` 2.26:1 | 新增 `gray-450`，subtle 亮暗与 muted 恰好对调 |
| PATCH 紫压在选中态上 3.73:1 | 新增 `violet-400`，暗色 method-patch 改用它 |

当前最低值 2.87:1（亮色 `text-subtle` on `bg-hover`，属装饰级），
其余全部 ≥ 4.54:1。

## 新增 token 的检查清单

1. 语义层能表达吗？能就别加组件层 token
2. 名字描述**用途**还是**外观**？`--pk-danger-fg` ✅，`--pk-red-text` ❌
3. 亮暗两个值都给了吗？`light-dark()` 缺一半会导致某个主题下不可读
4. 加进 `theme.css` 的 `@theme inline` 了吗？否则生成不出工具类
5. 是前景色吗？把它加进 `scripts/check-contrast.mjs` 的 `FOREGROUNDS`
