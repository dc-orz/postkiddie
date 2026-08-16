import type { ITheme } from "@xterm/xterm";

/**
 * 把 design token 里的终端调色板读成 xterm 的 theme 对象。
 *
 * ## 为什么要在 JS 里读一遍
 *
 * xterm 把颜色写进 canvas 与行内样式，拿不到 CSS 变量，必须喂它具体的值。
 * 但颜色的**定义**仍然只有 `tokens.css` 一处——这里只是求值，不是第二份配色。
 * 因此主题一变（用户切换，或跟随模式下系统变了）就要重读一次，见 `TerminalPanel`。
 *
 * ## 为什么不能直接 getPropertyValue
 *
 * 自定义属性的计算值只做到「把 `var()` 替换掉」为止。`--pk-term-bg` 的值是
 * `light-dark(浅, 深)`，而 `light-dark()` 要到**使用**它的那条声明上才求值——
 * 直接读变量拿到的是这串函数本身的文本，不是颜色。
 *
 * 所以走两步：先把它用在一个探针元素的 `color` 上，让浏览器按当前
 * `color-scheme` 挑出那一半；再借 canvas 的 `fillStyle` 归一化成
 * `#rrggbb` / `rgba(…)`——xterm 的颜色解析器只认这类写法，
 * 而浏览器求值后给出的可能是 `oklch(…)`。
 */

/** token 名 → xterm ITheme 字段。左边这些都定义在 tokens.css 的「内置终端」一节。 */
const MAP = {
  background: "term-bg",
  foreground: "term-fg",
  cursor: "term-cursor",
  cursorAccent: "term-bg",
  selectionBackground: "term-selection",

  black: "term-black",
  red: "term-red",
  green: "term-green",
  yellow: "term-yellow",
  blue: "term-blue",
  magenta: "term-magenta",
  cyan: "term-cyan",
  white: "term-white",

  brightBlack: "term-bright-black",
  brightRed: "term-bright-red",
  brightGreen: "term-bright-green",
  brightYellow: "term-bright-yellow",
  brightBlue: "term-bright-blue",
  brightMagenta: "term-bright-magenta",
  brightCyan: "term-bright-cyan",
  brightWhite: "term-bright-white",
} as const satisfies Record<string, string>;

/**
 * 归一化成 xterm 认得的颜色写法。
 *
 * canvas 的 `fillStyle` setter 接受任何合法 CSS 颜色，getter 则一律吐出
 * `#rrggbb`（不透明）或 `rgba(r, g, b, a)`（半透明）。借它做转换，
 * 省掉自己写一个 oklch → sRGB 的实现。
 */
function normalize(color: string, ctx: CanvasRenderingContext2D | null): string | null {
  if (!ctx) return null;

  // 先写一个哨兵值：fillStyle 对无法解析的输入是「保持原样」而非报错，
  // 不设哨兵就分不清「解析成功」和「解析失败留下了上一次的值」
  ctx.fillStyle = "#000000";
  ctx.fillStyle = color;
  const result = ctx.fillStyle;

  return typeof result === "string" ? result : null;
}

export function readTerminalTheme(): ITheme {
  // 探针必须真的在文档里，否则 color-scheme 与 data-theme 都继承不到，
  // light-dark() 会一律按浅色求值
  const probe = document.createElement("div");
  probe.style.display = "none";
  document.body.append(probe);

  const ctx = document.createElement("canvas").getContext("2d");
  const theme: Record<string, string> = {};

  try {
    for (const [field, token] of Object.entries(MAP)) {
      probe.style.color = `var(--pk-${token})`;
      const resolved = normalize(getComputedStyle(probe).color, ctx);
      // 解析不出来就整条跳过，让 xterm 用它自己的默认值——
      // 塞空字符串进去会被当成透明，那一档颜色会直接消失
      if (resolved) theme[field] = resolved;
    }
  } finally {
    probe.remove();
  }

  return theme;
}
