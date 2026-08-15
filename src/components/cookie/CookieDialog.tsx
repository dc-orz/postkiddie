import {
  ClipboardPaste,
  Cookie as CookieIcon,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { confirmAction, showError } from "@/lib/dialog";
import { cookie as ipc } from "@/lib/ipc";
import type { Cookie, CookieGroup } from "@/types/api";

interface CookieDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CookieDialog({ open, onClose }: CookieDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [groups, setGroups] = useState<CookieGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await ipc.list();
      setGroups(next);
      setSelected((prev) =>
        prev && next.some((g) => g.domain === prev) ? prev : (next[0]?.domain ?? null),
      );
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "读取 Cookie 失败");
    }
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (open) void reload();
    else setNotice(null);
  }, [open, reload]);

  const current = groups.find((g) => g.domain === selected) ?? null;

  /** 统一的忙碌包装：这些操作都会改动本机凭证，失败必须让用户看见 */
  async function run(action: () => Promise<void>, title: string) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), title);
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenLogin() {
    const url = loginUrl.trim();
    if (!url) return;
    await run(async () => {
      await ipc.loginOpen(url);
      setNotice("已打开登录窗口。在其中完成登录后，回到这里点「收取」。");
    }, "打开登录窗口失败");
  }

  async function handleCapture() {
    const url = loginUrl.trim();
    if (!url) return;
    await run(async () => {
      const count = await ipc.capture(url, true);
      await reload();
      setNotice(
        count > 0
          ? `已收取 ${count} 条 Cookie。`
          : "没有收到 Cookie——确认已在登录窗口中完成登录，且地址与目标站点一致。",
      );
    }, "收取 Cookie 失败");
  }

  async function handleClearDomain(domain: string) {
    const ok = await confirmAction(`将清除 ${domain} 及其子域的全部 Cookie，等同于退出登录。`, {
      title: "清除 Cookie",
      okLabel: "清除",
    });
    if (!ok) return;
    await run(async () => {
      await ipc.clearDomain(domain);
      await reload();
      setNotice(`已清除 ${domain} 的 Cookie。`);
    }, "清除失败");
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: onClick 仅用于「点遮罩关闭」，键盘侧由原生 dialog 的 ESC 承担
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className={cn(
        "pk-dialog m-auto w-[52rem] max-w-[92vw] rounded-xl border border-line bg-raised p-0",
        "text-fg shadow-overlay",
      )}
    >
      <div className="flex h-[30rem] max-h-[85vh] flex-col">
        <header className="flex h-toolbar shrink-0 items-center gap-2 border-b border-line-subtle px-3">
          <CookieIcon size={14} strokeWidth={1.75} className="text-fg-muted" />
          <h2 className="flex-1 text-md font-medium">Cookie 管理</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </header>

        <LoginBar
          url={loginUrl}
          busy={busy}
          onUrlChange={setLoginUrl}
          onOpen={() => void handleOpenLogin()}
          onCapture={() => void handleCapture()}
          onTogglePaste={() => setPasteOpen((v) => !v)}
          pasteOpen={pasteOpen}
        />

        {pasteOpen ? (
          <PasteImport
            defaultUrl={loginUrl}
            onDone={async (count, url) => {
              await reload();
              setPasteOpen(false);
              setNotice(`已从粘贴内容导入 ${count} 条 Cookie（${url}）。`);
            }}
          />
        ) : null}

        {notice ? (
          <p className="shrink-0 border-b border-line-subtle bg-accent-soft px-3 py-1.5 text-xs text-accent-fg">
            {notice}
          </p>
        ) : null}

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-52 shrink-0 flex-col border-r border-line-subtle">
            <ul className="min-h-0 flex-1 overflow-auto py-1">
              {groups.map((group) => (
                <li key={group.domain} className="group/d flex items-center">
                  <button
                    type="button"
                    onClick={() => setSelected(group.domain)}
                    className={cn(
                      "flex h-row min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left text-sm",
                      "transition-colors duration-fast",
                      selected === group.domain
                        ? "bg-selected text-fg"
                        : "text-fg-secondary hover:bg-hover",
                    )}
                  >
                    <span className="pk-truncate flex-1 font-mono text-xs">{group.domain}</span>
                    <span className="pk-tnum shrink-0 text-2xs text-fg-subtle">
                      {group.cookies.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleClearDomain(group.domain)}
                    aria-label={`清除 ${group.domain} 的 Cookie`}
                    title="清除该域的全部 Cookie"
                    className={cn(
                      "mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm",
                      "text-fg-subtle opacity-0 transition-opacity duration-fast",
                      "hover:bg-hover hover:text-danger group-hover/d:opacity-100 focus-visible:opacity-100",
                    )}
                  >
                    <Trash2 size={11} strokeWidth={2} />
                  </button>
                </li>
              ))}
              {groups.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-fg-muted">还没有 Cookie</li>
              ) : null}
            </ul>
          </nav>

          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            {current ? (
              <CookieTable
                group={current}
                onDelete={(c) =>
                  void run(async () => {
                    await ipc.remove(c.name, c.domain, c.path);
                    await reload();
                  }, "删除 Cookie 失败")
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center px-8 text-center">
                <p className="text-sm text-fg-muted">
                  还没有保存任何 Cookie。用上方的登录窗口获取，或粘贴导入。
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 与密钥面板同样的常驻声明：用户必须始终清楚凭证存在哪 */}
        <p className="flex shrink-0 items-center gap-1.5 border-t border-line-subtle px-3 py-2 text-xs text-fg-muted">
          <CookieIcon size={11} strokeWidth={2} className="shrink-0" />
          Cookie 只保存在本机 .postkiddie/cookies.yaml，不会提交到 git。
        </p>
      </div>
    </dialog>
  );
}

function LoginBar({
  url,
  busy,
  pasteOpen,
  onUrlChange,
  onOpen,
  onCapture,
  onTogglePaste,
}: {
  url: string;
  busy: boolean;
  pasteOpen: boolean;
  onUrlChange: (v: string) => void;
  onOpen: () => void;
  onCapture: () => void;
  onTogglePaste: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-line-subtle px-3 py-2">
      <div className="flex items-center gap-1.5">
        <input
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://example.com —— 要登录的站点地址"
          spellCheck={false}
          aria-label="登录站点地址"
          className={cn(
            "h-control-md flex-1 rounded-md border border-line bg-surface px-2.5",
            "font-mono text-xs outline-none focus:border-line-focus",
          )}
        />
        <Button size="md" onClick={onOpen} disabled={busy || !url.trim()}>
          <ExternalLink size={12} strokeWidth={2} />
          打开登录
        </Button>
        <Button variant="primary" size="md" onClick={onCapture} disabled={busy || !url.trim()}>
          {busy ? (
            <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          ) : (
            <Download size={12} strokeWidth={2} />
          )}
          收取
        </Button>
        <Button
          size="md"
          variant={pasteOpen ? "default" : "ghost"}
          onClick={onTogglePaste}
          title="从 DevTools 复制的 Cookie 头或 curl 命令导入"
        >
          <ClipboardPaste size={12} strokeWidth={2} />
        </Button>
      </div>
      <p className="mt-1 text-2xs text-fg-subtle">
        在弹出的窗口里正常登录（SSO、验证码、双因子都可以），完成后回来点「收取」。
      </p>
    </div>
  );
}

function PasteImport({
  defaultUrl,
  onDone,
}: {
  defaultUrl: string;
  onDone: (count: number, url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(defaultUrl);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleImport() {
    const target = url.trim();
    if (!target || !raw.trim()) return;

    setBusy(true);
    try {
      const count = await ipc.import(target, raw);
      setRaw("");
      await onDone(count, target);
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "导入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 space-y-1.5 border-b border-line-subtle bg-sunken px-3 py-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com —— 这些 Cookie 属于哪个站点"
        spellCheck={false}
        aria-label="Cookie 归属站点"
        className="h-control-sm w-full rounded-md border border-line bg-surface px-2 font-mono text-xs outline-none focus:border-line-focus"
      />
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={3}
        spellCheck={false}
        aria-label="粘贴内容"
        placeholder={"粘贴 Cookie 头，或浏览器「Copy as cURL」的整条命令\nsid=abc123; csrf=xyz"}
        className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs outline-none focus:border-line-focus"
      />
      <div className="flex justify-end">
        <Button size="sm" variant="primary" onClick={() => void handleImport()} disabled={busy}>
          {busy ? <Loader2 size={11} strokeWidth={2} className="animate-spin" /> : null}
          导入
        </Button>
      </div>
    </div>
  );
}

function CookieTable({
  group,
  onDelete,
}: {
  group: CookieGroup;
  onDelete: (cookie: Cookie) => void;
}) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const toggle = (name: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <table className="w-full border-collapse text-base">
      <thead className="sticky top-0 bg-surface">
        <tr className="border-b border-line-subtle text-xs text-fg-muted">
          <th className="px-2 py-1.5 text-left font-medium">名称</th>
          <th className="px-2 py-1.5 text-left font-medium">值</th>
          <th className="w-24 px-2 py-1.5 text-left font-medium">路径</th>
          <th className="w-20 px-2 py-1.5 text-left font-medium">属性</th>
          <th className="w-8" />
        </tr>
      </thead>
      <tbody>
        {group.cookies.map((c) => {
          const masked = !revealed.has(c.name);
          return (
            <tr key={`${c.name}:${c.path}`} className="group/c border-b border-line-subtle">
              <td className="px-2 py-1 font-mono text-fg-secondary">{c.name}</td>
              <td className="px-2 py-1">
                <div className="flex items-center gap-1">
                  {/* 默认打码：录屏或结对时不该把会话 token 直接摊在屏幕上 */}
                  <span className="pk-truncate max-w-[16rem] font-mono">
                    {masked ? "•".repeat(Math.min(c.value.length, 24)) : c.value}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(c.name)}
                    aria-label={masked ? "显示值" : "隐藏值"}
                    className="flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg"
                  >
                    {masked ? (
                      <Eye size={11} strokeWidth={2} />
                    ) : (
                      <EyeOff size={11} strokeWidth={2} />
                    )}
                  </button>
                </div>
              </td>
              <td className="px-2 py-1 font-mono text-xs text-fg-muted">{c.path}</td>
              <td className="px-2 py-1">
                <span className="flex gap-1 text-2xs text-fg-subtle">
                  {c.secure ? <span title="仅 HTTPS">Secure</span> : null}
                  {c.httpOnly ? <span title="HttpOnly">HttpOnly</span> : null}
                  {c.hostOnly ? <span title="不下发给子域">HostOnly</span> : null}
                </span>
              </td>
              <td className="text-center">
                <button
                  type="button"
                  onClick={() => onDelete(c)}
                  aria-label={`删除 ${c.name}`}
                  className={cn(
                    "flex size-5 items-center justify-center rounded-sm text-fg-subtle",
                    "opacity-0 transition-opacity duration-fast",
                    "hover:bg-hover hover:text-danger group-hover/c:opacity-100 focus-visible:opacity-100",
                  )}
                >
                  <X size={11} strokeWidth={2} />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
