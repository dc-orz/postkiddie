import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { RotateCw, TerminalIcon, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { terminal as ipc } from "@/lib/ipc";
import { readTerminalTheme } from "@/lib/terminal-theme";
import { useGit } from "@/stores/git";
import { useLayout } from "@/stores/layout";
import { useTheme } from "@/stores/theme";
import { useWorkspace } from "@/stores/workspace";
// xterm 自己的布局样式（光标、选区、行盒）。配色不在这里，由 theme 对象注入。
import "@xterm/xterm/css/xterm.css";

/**
 * 跑完一条命令后多久去刷新 git 状态与集合树。
 *
 * PTY 里发生了什么我们是不知道的——用户可能敲了 `git checkout`、`git pull`，
 * 也可能只是 `ls`。与其猜，不如在输出安静下来之后统一重扫一次：
 * 磁盘本来就是唯一事实来源，重扫是幂等的。
 */
const RESCAN_IDLE_MS = 400;

/**
 * 内置终端。
 *
 * 是一个**真 PTY**，不是「输入命令 → 跑一次 → 打印结果」的伪终端：
 * `git log` 的分页、`git add -p` 的逐块询问、`git rebase -i` 的编辑器、
 * push 的进度条，都要靠 tty 才成立。理由写在 Rust 侧 `terminal/mod.rs` 的模块注释里。
 *
 * 面板关掉时组件不卸载，只是被父级藏起来（见 `Workbench`）：
 * shell 进程与滚动缓冲都留着，再打开还是刚才那个会话。
 */
export function TerminalPanel({ visible }: { visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** 当前会话 id。放 ref 里因为事件回调要读它的最新值，而它们只注册一次。 */
  const sessionRef = useRef<string | null>(null);
  const rescanTimerRef = useRef<number | undefined>(undefined);

  const closeTerminal = useLayout((s) => s.setTerminalOpen);
  const workspaceRoot = useWorkspace((s) => s.info?.root);
  const themeMode = useTheme((s) => s.mode);

  const [exited, setExited] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  /** 用来强制重建会话：递增它会让下面的 effect 重跑 */
  const [generation, setGeneration] = useState(0);

  /** 把当前尺寸同步给 PTY。尺寸不同步的话，子进程会按旧列数换行，输出全乱。 */
  const syncSize = useCallback(() => {
    const term = termRef.current;
    const id = sessionRef.current;
    if (!term || !id) return;

    fitRef.current?.fit();
    void ipc.resize(id, term.cols, term.rows).catch(() => {
      // 会话可能刚退出，这时 resize 失败是正常的
    });
  }, []);

  // --- 建终端实例。整个组件生命周期里只跑一次。 ---
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement)
        .getPropertyValue("--pk-font-mono")
        .trim(),
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      // 10000 行足够回看一次完整的 CI 输出，再多就只是在吃内存
      scrollback: 10000,
      theme: readTerminalTheme(),
      // macOS 上 Option 要能打出 ESC 前缀，否则 Alt+B / Alt+F 这类行编辑键失效
      macOptionIsMeta: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    // 中日韩字符占两列。不装这个插件，git log 里的中文提交信息会与后面的内容错位。
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    const onData = term.onData((data) => {
      const id = sessionRef.current;
      if (id) void ipc.write(id, data).catch(() => {});
    });

    return () => {
      onData.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // --- 订阅后端事件。也只注册一次，靠 sessionRef 过滤出属于自己的那条流。 ---
  useEffect(() => {
    const unlisten = [
      ipc.onOutput((id, data) => {
        if (id !== sessionRef.current) return;

        // base64 → 字节。必须按字节喂给 xterm：一批的末尾可能正卡在某个
        // 多字节字符中间，xterm 的解码器会跨批次把它拼起来，而先转成
        // 字符串就已经把那半个字符毁成 � 了。
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        termRef.current?.write(bytes);

        // 输出安静下来就重扫一次。用户很可能刚 checkout 了别的分支。
        window.clearTimeout(rescanTimerRef.current);
        rescanTimerRef.current = window.setTimeout(() => {
          void useGit.getState().refresh();
          void useWorkspace.getState().refresh();
        }, RESCAN_IDLE_MS);
      }),

      ipc.onExit((id, code) => {
        if (id !== sessionRef.current) return;
        sessionRef.current = null;
        setExited(code);
      }),
    ];

    return () => {
      window.clearTimeout(rescanTimerRef.current);
      // listen() 返回的是 Promise<UnlistenFn>，取消要等它落地
      for (const pending of unlisten) void pending.then((off) => off());
    };
  }, []);

  // --- 起会话。换工作区（后端会连带关掉旧会话）或点重启时重来一次。 ---
  // biome-ignore lint/correctness/useExhaustiveDependencies: generation 不参与计算，它就是「重来一次」这个信号本身——递增它正是为了让这个 effect 重跑
  useEffect(() => {
    const term = termRef.current;
    if (!term || !workspaceRoot) return;

    let cancelled = false;
    setExited(null);
    setStartError(null);
    term.reset();

    // 先量一次尺寸再开会话，免得 shell 按默认的 80×24 画完提示符才被改尺寸
    fitRef.current?.fit();

    void ipc
      .open(term.cols, term.rows)
      .then((id) => {
        if (cancelled) {
          // 组件已经不要这个会话了（比如又切了一次工作区），别让它在后台留着
          void ipc.close(id).catch(() => {});
          return;
        }
        sessionRef.current = id;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStartError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) void ipc.close(id).catch(() => {});
    };
  }, [workspaceRoot, generation]);

  // --- 主题联动。切换后重新求值一次 token。 ---
  // biome-ignore lint/correctness/useExhaustiveDependencies: themeMode 的值用不上，需要的只是「它变了」——变了就得重新求值一遍 CSS 变量
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    function apply() {
      const t = termRef.current;
      if (t) t.options.theme = readTerminalTheme();
    }

    apply();

    // 跟随系统时，主题变化不经过 store，只能靠 media query
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  // --- 尺寸联动：容器变化、以及从隐藏切回显示。 ---
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !visible) return;

    // 藏着的时候容器高度是 0，xterm 会缩成 1 行；重新显示后必须再量一次。
    // 用 rAF 等这一帧的布局落定，否则量到的还是旧尺寸。
    const raf = requestAnimationFrame(syncSize);

    const observer = new ResizeObserver(syncSize);
    observer.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [visible, syncSize]);

  // 面板一显示就把焦点给终端，省掉一次「点一下才能打字」
  useEffect(() => {
    if (visible) termRef.current?.focus();
  }, [visible]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-toolbar shrink-0 items-center gap-0.5 border-b border-line-subtle px-2 pl-3">
        <TerminalIcon size={12} strokeWidth={1.75} className="mr-1.5 shrink-0 text-fg-muted" />
        <span className="flex-1 text-xs font-medium tracking-wide text-fg-muted">
          终端
          {exited !== null ? (
            <span className="ml-1.5 text-fg-subtle">
              已退出{exited === 0 ? "" : `（代码 ${exited}）`}
            </span>
          ) : null}
        </span>

        <IconButton label="重启会话" onClick={() => setGeneration((n) => n + 1)}>
          <RotateCw size={12} strokeWidth={2} />
        </IconButton>
        <IconButton label="关闭面板" onClick={() => closeTerminal(false)}>
          <X size={13} strokeWidth={2} />
        </IconButton>
      </div>

      {startError ? (
        <div className="shrink-0 border-b border-line-subtle bg-danger-soft px-3 py-2">
          <p className="text-xs text-danger">
            终端启动失败：<span className="pk-selectable">{startError}</span>
          </p>
        </div>
      ) : null}

      {/*
        xterm 会往这个元素里塞自己的 DOM 并按它的尺寸排版，
        所以这里除了背景色什么都不要加，padding 会让它算错列数。
      */}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden bg-term" />

      {exited !== null ? (
        <button
          type="button"
          onClick={() => setGeneration((n) => n + 1)}
          className={cn(
            "shrink-0 border-t border-line-subtle py-1.5 text-xs text-fg-link",
            "transition-colors duration-fast hover:bg-hover",
          )}
        >
          会话已结束，点此重新启动
        </button>
      ) : null}
    </section>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle",
        "transition-colors duration-fast hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
