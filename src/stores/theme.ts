import { create } from "zustand";

/**
 * 主题模式。
 *
 * 实际的颜色切换由 CSS 的 `light-dark()` + `color-scheme` 完成（见 tokens.css），
 * 这里只负责把用户选择写到 `<html data-theme>` 上并持久化。
 * 没有 JS 参与配色计算，也就不存在切换时的闪烁或重排。
 */
export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "postkiddie.theme";

function readStored(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function apply(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.dataset.theme = mode;
  }
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  mode: readStored(),
  setMode: (mode) => {
    apply(mode);
    localStorage.setItem(STORAGE_KEY, mode);
    set({ mode });
  },
}));

/** 在 React 挂载前同步应用，避免首帧闪一下默认主题 */
export function initTheme(): void {
  apply(readStored());
}
