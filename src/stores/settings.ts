import { create } from "zustand";

/**
 * 界面设置。
 *
 * 目前只有「界面缩放」一项，但独立成 store 而非塞进 theme：
 * 主题是配色，缩放是尺寸，两者的持久化键、生效方式、未来的扩展方向都不同。
 *
 * 缩放的实现要点：tokens.css 里所有字号与布局尺寸都用 rem 表达，
 * 所以只要改根元素的 font-size，整个界面（含 CodeMirror、滚动条、行高）
 * 会等比放大，无需任何组件感知缩放的存在。
 */

/** `auto` 表示按屏幕尺寸推断，其余是相对默认值的倍率 */
export type UiScale = "auto" | number;

const STORAGE_KEY = "postkiddie.uiScale";

/** 手动档位。跨度取 10% 上下，再小的差别在这个字号区间里几乎看不出来。 */
export const SCALE_STEPS = [0.9, 1, 1.1, 1.25, 1.5] as const;

/**
 * 按屏幕的逻辑宽度推断合适的缩放。
 *
 * 判据只用 `screen.width` 而不掺 devicePixelRatio，因为系统的显示缩放
 * 已经把 DPI 归一化了：27" 1080p 与 27" 4K@2x 的逻辑宽度都是 1920，
 * 而它们摆在桌上是一样大的——逻辑宽度才是「这块屏能舒服地容纳多少 UI」。
 *
 * 阈值是经验值，不是测量结果：设计基准是 1512pt 的 14" 笔记本内屏。
 * 猜错了也不要紧，用户可以在设置里固定一档。
 */
export function autoScale(width = window.screen.width): number {
  if (width >= 2560) return 1.25;
  if (width >= 1920) return 1.1;
  return 1;
}

/** 把设置换算成真正生效的倍率 */
export function resolveScale(scale: UiScale): number {
  return scale === "auto" ? autoScale() : scale;
}

function readStored(): UiScale {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === "auto") return "auto";
  const parsed = Number(raw);
  // 只认识预设档位，避免旧版本或手改 localStorage 留下的怪值把界面撑坏
  return SCALE_STEPS.includes(parsed as (typeof SCALE_STEPS)[number]) ? parsed : "auto";
}

/**
 * 写入生效。
 *
 * 只设一个自定义属性，实际的 font-size 由 global.css 里的
 * `calc(100% * var(--pk-ui-scale))` 计算——这样根字号仍以浏览器默认值为基准，
 * 尊重用户在系统层面调过的字体大小，而不是被我们硬编码成 16px。
 */
function apply(scale: UiScale): void {
  document.documentElement.style.setProperty("--pk-ui-scale", String(resolveScale(scale)));
}

interface SettingsState {
  uiScale: UiScale;
  setUiScale: (scale: UiScale) => void;
}

export const useSettings = create<SettingsState>((set) => ({
  uiScale: readStored(),
  setUiScale: (scale) => {
    apply(scale);
    localStorage.setItem(STORAGE_KEY, String(scale));
    set({ uiScale: scale });
  },
}));

/**
 * 在 React 挂载前落定缩放，避免首帧按默认大小排完版再跳一次。
 *
 * 同时在 auto 模式下跟随屏幕变化重算：把窗口拖到另一块显示器时
 * 没有专门的事件可听，resize 与 focus 是覆盖面最广又最便宜的两个近似。
 */
export function initUiScale(): void {
  apply(readStored());

  const recompute = () => {
    const { uiScale } = useSettings.getState();
    if (uiScale === "auto") apply("auto");
  };
  window.addEventListener("resize", recompute);
  window.addEventListener("focus", recompute);
}
