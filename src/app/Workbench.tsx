import { useEffect, useState } from "react";

import { StatusBar } from "@/components/layout/StatusBar";
import { TitleBar } from "@/components/layout/TitleBar";
import { RequestPane } from "@/components/request/RequestPane";
import { ResponsePane } from "@/components/response/ResponsePane";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import { Splitter } from "@/components/ui/Splitter";
import { cn } from "@/lib/cn";
import { useElementSize } from "@/lib/use-element-size";
import { useGit } from "@/stores/git";
import {
  REQUEST_PANE_MIN,
  RESPONSE_PANE_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  TERMINAL_MIN,
  useLayout,
  WORKBENCH_MIN,
} from "@/stores/layout";
import { useRequest } from "@/stores/request";
import { useWorkspace } from "@/stores/workspace";

/** git 状态轮询间隔。请求集合仓库通常很小，5 秒的开销可以忽略。 */
const GIT_POLL_MS = 5000;

export function Workbench() {
  const workspaceRoot = useWorkspace((s) => s.info?.root);
  const {
    sidebarWidth,
    setSidebarWidth,
    resetSidebarWidth,
    requestPaneHeight,
    setRequestPaneHeight,
    resetRequestPaneHeight,
    terminalOpen,
    terminalHeight,
    setTerminalHeight,
    resetTerminalHeight,
    toggleTerminal,
  } = useLayout();

  // 主区高度决定请求区能拖到多高，窗口缩放时上限要跟着变
  const [mainRef, mainSize] = useElementSize<HTMLElement>();
  const requestPaneMax = Math.max(REQUEST_PANE_MIN, mainSize.height - RESPONSE_PANE_MIN);

  // 终端与它上方的主区共享这块高度，用于反推终端能拖到多高
  const [bodyRef, bodySize] = useElementSize<HTMLDivElement>();
  const available = Math.max(bodySize.height, WORKBENCH_MIN + TERMINAL_MIN);
  const terminalMax = available - WORKBENCH_MIN;

  /**
   * 终端一旦起过就常驻 DOM，关掉面板只是把它藏起来。
   *
   * 条件渲染会连 shell 进程和滚动缓冲一起销毁——那意味着每次收起面板，
   * 正在跑的命令被杀、刚才的输出全部消失。而首次挂载又推迟到真的用了终端为止，
   * 从不打开终端的用户就不会平白多一个 shell 进程。
   */
  const [terminalMounted, setTerminalMounted] = useState(terminalOpen);
  useEffect(() => {
    if (terminalOpen) setTerminalMounted(true);
  }, [terminalOpen]);

  /**
   * 轮询 git 状态。
   *
   * 需要轮询而非只在自身操作后刷新：用户完全可能在终端里 commit、切分支，
   * 或者被 IDE 的 git 插件改了工作区。状态栏显示的分支必须是真的。
   */
  useEffect(() => {
    if (!workspaceRoot) return;

    const { refresh } = useGit.getState();
    void refresh();

    const timer = window.setInterval(() => void refresh(), GIT_POLL_MS);
    // 窗口重新获得焦点时立刻刷一次——用户多半刚从终端切回来
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [workspaceRoot]);

  // 全局快捷键：保存与发送是最高频的两个动作，不该只能用鼠标
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key === "s") {
        event.preventDefault();
        void useRequest.getState().save();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void useRequest.getState().send();
      } else if (event.key === "`") {
        // 与 VS Code 一致。终端里的按键会被 xterm 吃掉，所以这个开关必须
        // 带 mod 键——否则打开之后就再也关不掉了。
        event.preventDefault();
        toggleTerminal();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleTerminal]);

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <TitleBar />

      {/* 终端横跨整个宽度，压在侧栏与主区之下——它服务的是整个工作区，不属于某一栏 */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {/* 侧栏内部的上下分割（集合树 / Git 面板）由 Sidebar 自己管理 */}
          <aside
            style={{ width: sidebarWidth }}
            className="flex shrink-0 flex-col border-r border-line-subtle bg-surface"
          >
            <Sidebar />
          </aside>

          <Splitter
            orientation="vertical"
            label="调整侧边栏宽度"
            value={sidebarWidth}
            min={SIDEBAR_MIN}
            max={SIDEBAR_MAX}
            onChange={setSidebarWidth}
            onReset={resetSidebarWidth}
          />

          <main ref={mainRef} className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
            <div
              style={{ height: Math.min(requestPaneHeight, requestPaneMax) }}
              className="min-h-0 shrink-0"
            >
              <RequestPane />
            </div>

            <Splitter
              orientation="horizontal"
              label="调整请求区高度"
              value={requestPaneHeight}
              min={REQUEST_PANE_MIN}
              max={requestPaneMax}
              onChange={setRequestPaneHeight}
              onReset={resetRequestPaneHeight}
            />

            <div className="min-h-0 flex-1">
              <ResponsePane />
            </div>
          </main>
        </div>

        {terminalMounted ? (
          <div className={cn("flex shrink-0 flex-col", !terminalOpen && "hidden")}>
            <Splitter
              orientation="horizontal"
              label="调整终端高度"
              value={available - terminalHeight}
              min={WORKBENCH_MIN}
              max={available - TERMINAL_MIN}
              onChange={(topHeight) => setTerminalHeight(available - topHeight)}
              onReset={resetTerminalHeight}
            />
            <div style={{ height: Math.min(terminalHeight, terminalMax) }} className="min-h-0">
              <TerminalPanel visible={terminalOpen} />
            </div>
          </div>
        ) : null}
      </div>

      <StatusBar />
    </div>
  );
}
