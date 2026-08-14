#!/usr/bin/env node
/**
 * Design Token 对比度回归检查。
 *
 * 直接解析 `src/styles/tokens.css`，把 OKLCH 转成 sRGB 并按 WCAG 2.1 计算对比度，
 * 校验前景/背景的所有真实组合。无需浏览器，可在 CI 跑。
 *
 * 为什么值得单独做一个脚本：简约风格依赖细微的色彩层次，而「层次细微」与
 * 「看不清」只隔一条线。调 token 时凭肉眼判断必然会有偏差——本项目在初版就实测出
 * 三处低于 AA 的组合（主按钮白字仅 3.63:1）。有了这个脚本，改 token 会立刻反馈。
 *
 * 运行：pnpm run check:contrast
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS_FILE = resolve(ROOT, "src/styles/tokens.css");

/** 普通文本的 WCAG AA 阈值 */
const AA = 4.5;
/** 装饰性文本（占位符等）的放宽阈值 */
const AA_DECORATIVE = 2.8;

// ---------------------------------------------------------------------------
// 颜色转换
// ---------------------------------------------------------------------------

/** OKLCH → 线性 sRGB。系数取自 Björn Ottosson 的 Oklab 定义。 */
function oklchToLinearRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** WCAG 相对亮度。先裁剪到 sRGB 色域，与浏览器的实际呈现保持一致。 */
function relativeLuminance([r, g, b]) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

function contrast(colorA, colorB) {
  const [hi, lo] = [relativeLuminance(colorA), relativeLuminance(colorB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// tokens.css 解析
// ---------------------------------------------------------------------------

/** 抽取所有 `--pk-*: <value>;` 声明。同名后出现的覆盖先出现的，与 CSS 一致。 */
function parseTokens(css) {
  // 去掉注释，避免示例代码里的声明被误采
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map();

  for (const match of stripped.matchAll(/(--pk-[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

/** 按逗号切分，但忽略括号内部的逗号 */
function splitTopLevel(input) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const ch of input) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;

    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * 把 token 值解析成线性 sRGB。
 * 支持 `oklch(...)`、`var(--x)`、`light-dark(亮, 暗)`，其余返回 null（非颜色 token）。
 */
function resolveColor(value, tokens, theme, depth = 0) {
  if (depth > 12) return null;
  const v = value.trim();

  const varMatch = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (varMatch) {
    const target = tokens.get(varMatch[1]);
    return target ? resolveColor(target, tokens, theme, depth + 1) : null;
  }

  if (v.startsWith("light-dark(")) {
    const args = splitTopLevel(v.slice("light-dark(".length, -1));
    const picked = theme === "dark" ? args[1] : args[0];
    return picked ? resolveColor(picked, tokens, theme, depth + 1) : null;
  }

  const oklch = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+\s*)?\)$/);
  if (oklch) {
    const [, lRaw, pct, c, h] = oklch;
    const L = pct === "%" ? Number(lRaw) / 100 : Number(lRaw);
    return oklchToLinearRgb(L, Number(c), Number(h));
  }

  return null;
}

// ---------------------------------------------------------------------------
// 检查矩阵
// ---------------------------------------------------------------------------

/** 前景 token 可能出现在哪些背景之上 */
const BACKGROUNDS = ["surface", "canvas", "sunken", "hover", "selected"].map((n) => `--pk-bg-${n}`);

const FOREGROUNDS = [
  ...["get", "post", "put", "patch", "delete", "head", "options"].map((m) => `--pk-method-${m}`),
  ...["1xx", "2xx", "3xx", "4xx", "5xx"].map((s) => `--pk-status-${s}`),
  ...["added", "modified", "deleted", "renamed", "untracked", "conflicted", "ahead", "behind"].map(
    (g) => `--pk-git-${g}`,
  ),
  "--pk-text-primary",
  "--pk-text-secondary",
  "--pk-text-muted",
];

/** 装饰性前景：阈值放宽 */
const DECORATIVE_FOREGROUNDS = ["--pk-text-subtle"];

/** 固定搭配，不与通用背景做笛卡尔积 */
const PAIRS = [
  ["--pk-text-on-accent", "--pk-accent-bg"],
  ["--pk-text-on-accent", "--pk-accent-bg-hover"],
  ["--pk-text-on-accent", "--pk-accent-bg-active"],
  ["--pk-text-on-accent", "--pk-danger-solid"],
  ["--pk-accent-fg", "--pk-accent-bg-subtle"],
  ...["danger", "success", "warning", "info"].map((s) => [`--pk-${s}-fg`, `--pk-${s}-bg`]),
];

function buildChecks() {
  const checks = [];
  for (const fg of FOREGROUNDS) {
    for (const bg of BACKGROUNDS) checks.push({ fg, bg, threshold: AA });
  }
  for (const fg of DECORATIVE_FOREGROUNDS) {
    for (const bg of BACKGROUNDS) checks.push({ fg, bg, threshold: AA_DECORATIVE });
  }
  for (const [fg, bg] of PAIRS) checks.push({ fg, bg, threshold: AA });
  return checks;
}

// ---------------------------------------------------------------------------

/**
 * 测量单组前景/背景。
 * 返回 `{ record }`，或在任一侧解析不出颜色时返回 `{ missing: [...] }`。
 */
function measure(tokens, theme, { fg, bg, threshold }) {
  const fgColor = resolveColor(tokens.get(fg) ?? "", tokens, theme);
  const bgColor = resolveColor(tokens.get(bg) ?? "", tokens, theme);

  const missing = [];
  if (!fgColor) missing.push(fg);
  if (!bgColor) missing.push(bg);
  if (missing.length > 0) return { missing };

  return {
    record: { theme, fg, bg, threshold, ratio: Number(contrast(fgColor, bgColor).toFixed(2)) },
  };
}

/** 在两种主题下跑完整个检查矩阵 */
function evaluate(tokens, checks) {
  const records = [];
  const unresolved = new Set();

  for (const theme of ["light", "dark"]) {
    for (const check of checks) {
      const { record, missing } = measure(tokens, theme, check);
      if (record) records.push(record);
      else for (const name of missing) unresolved.add(name);
    }
  }

  return {
    unresolved,
    evaluated: records.length,
    failures: records.filter((r) => r.ratio < r.threshold),
    lowest: records.reduce((min, r) => (r.ratio < min.ratio ? r : min), {
      ratio: Number.POSITIVE_INFINITY,
    }),
  };
}

function report({ failures, unresolved, lowest, evaluated }, checkCount) {
  if (unresolved.size > 0) {
    console.error("✗ 以下 token 无法解析成颜色，请检查是否拼写错误：");
    for (const name of unresolved) console.error(`    ${name}`);
    return 1;
  }

  if (failures.length > 0) {
    console.error(`✗ ${failures.length} 组配色低于对比度要求：\n`);
    for (const f of failures) {
      console.error(`    [${f.theme}] ${f.fg} on ${f.bg}`);
      console.error(`        实测 ${f.ratio}:1，要求 ≥ ${f.threshold}:1`);
    }
    console.error(`\n  请调整 ${TOKENS_FILE.replace(`${ROOT}/`, "")} 中对应的色阶。`);
    return 1;
  }

  console.log(`✓ 对比度检查通过：${evaluated} 组配色（亮/暗各 ${checkCount} 组）全部达标`);
  console.log(`  最低值 ${lowest.ratio}:1 — [${lowest.theme}] ${lowest.fg} on ${lowest.bg}`);
  return 0;
}

const checks = buildChecks();
const tokens = parseTokens(readFileSync(TOKENS_FILE, "utf8"));
process.exit(report(evaluate(tokens, checks), checks.length));
