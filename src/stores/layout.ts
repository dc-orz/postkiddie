import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 面板尺寸。
 *
 * 单独成一个 store 并持久化：布局是用户按自己习惯调出来的，
 * 每次启动都重置回默认值会很烦人。用像素而非比例存储——
 * 窗口变大时用户通常希望侧栏保持原宽、内容区变宽，而不是等比放大。
 */
export const SIDEBAR_DEFAULT = 260;
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;

export const REQUEST_PANE_DEFAULT = 320;
/** 请求区最小高度：URL 栏 + 标签栏 + 一行内容 */
export const REQUEST_PANE_MIN = 132;
/** 响应区要保留的最小高度，用于反推请求区的可拖动上限 */
export const RESPONSE_PANE_MIN = 120;

export const GIT_PANEL_DEFAULT = 260;
/** git 面板最小高度：提交框 + 一行文件 */
export const GIT_PANEL_MIN = 140;
/** 集合树要保留的最小高度，用于反推 git 面板的可拖动上限 */
export const TREE_MIN = 100;

export const TERMINAL_DEFAULT = 240;
/** 终端最小高度：标题栏 + 大约 6 行输出。再矮就只能看见提示符本身了。 */
export const TERMINAL_MIN = 120;
/** 终端之上要留给主区的最小高度，用于反推终端的可拖动上限 */
export const WORKBENCH_MIN = 200;

interface LayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  requestPaneHeight: number;
  gitPanelOpen: boolean;
  gitPanelHeight: number;
  terminalOpen: boolean;
  terminalHeight: number;

  setSidebarWidth: (width: number) => void;
  resetSidebarWidth: () => void;
  toggleSidebar: () => void;

  setRequestPaneHeight: (height: number) => void;
  resetRequestPaneHeight: () => void;

  toggleGitPanel: () => void;
  setGitPanelHeight: (height: number) => void;
  resetGitPanelHeight: () => void;

  toggleTerminal: () => void;
  setTerminalOpen: (open: boolean) => void;
  setTerminalHeight: (height: number) => void;
  resetTerminalHeight: () => void;
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarWidth: SIDEBAR_DEFAULT,
      sidebarCollapsed: false,
      requestPaneHeight: REQUEST_PANE_DEFAULT,
      gitPanelOpen: false,
      gitPanelHeight: GIT_PANEL_DEFAULT,
      terminalOpen: false,
      terminalHeight: TERMINAL_DEFAULT,

      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      resetSidebarWidth: () => set({ sidebarWidth: SIDEBAR_DEFAULT }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      setRequestPaneHeight: (requestPaneHeight) => set({ requestPaneHeight }),
      resetRequestPaneHeight: () => set({ requestPaneHeight: REQUEST_PANE_DEFAULT }),

      toggleGitPanel: () => set((s) => ({ gitPanelOpen: !s.gitPanelOpen })),
      setGitPanelHeight: (gitPanelHeight) => set({ gitPanelHeight }),
      resetGitPanelHeight: () => set({ gitPanelHeight: GIT_PANEL_DEFAULT }),

      toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
      setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
      setTerminalHeight: (terminalHeight) => set({ terminalHeight }),
      resetTerminalHeight: () => set({ terminalHeight: TERMINAL_DEFAULT }),
    }),
    {
      name: "postkiddie.layout",
      // 新增字段不要动 version：persist 默认做浅合并，存量里没有的键会用初始值补齐。
      // 而改了 version 又没给 migrate，整份持久化状态会被丢弃——
      // 用户调好的侧栏宽度与面板高度会在升级后无故复位。
      version: 1,
    },
  ),
);
