import { History, Inbox, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CodeEditor, type CodeLanguage } from "@/components/ui/CodeEditor";
import { Dialog } from "@/components/ui/Dialog";
import { MethodBadge } from "@/components/ui/MethodBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import { confirmAction, showError } from "@/lib/dialog";
import { mimeOf } from "@/lib/filename";
import { history as ipc } from "@/lib/ipc";
import type { HistoryEntry } from "@/types/api";

/** 相对时间。列表里「3 分钟前」比一串时间戳好扫，精确时刻交给 title。 */
function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function languageOf(contentType: string | null | undefined): CodeLanguage {
  const mime = mimeOf(contentType ?? undefined);
  if (mime.includes("json")) return "json";
  if (mime.includes("xml") || mime.includes("html")) return "xml";
  return "text";
}

interface HistoryDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HistoryDialog({ open, onClose }: HistoryDialogProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selected, setSelected] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  // 打开的瞬间取一次「现在」并固定住：每次渲染都调 Date.now()
  // 会让相对时间在无关的重渲染里跳动
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await ipc.list());
      setNow(Date.now());
      setSelected(0);
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "读取历史失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  async function handleClear() {
    if (
      !(await confirmAction("将清空全部请求历史，此操作不可撤销。", {
        title: "清空历史",
        okLabel: "清空",
      }))
    ) {
      return;
    }
    try {
      await ipc.clear();
      setEntries([]);
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "清空失败");
    }
  }

  const current = entries[selected] ?? null;

  return (
    <Dialog open={open} onClose={onClose} label="请求历史" className="w-[58rem] max-w-[92vw]">
      <div className="flex h-[32rem] max-h-[85vh] flex-col">
        <header className="flex h-toolbar shrink-0 items-center gap-2 border-b border-line-subtle px-3">
          <History size={14} strokeWidth={1.75} className="text-fg-muted" />
          <h2 className="flex-1 text-md font-medium">请求历史</h2>
          {entries.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => void handleClear()}>
              <Trash2 size={11} strokeWidth={2} />
              清空
            </Button>
          ) : null}
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-fg-subtle" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <Inbox size={22} strokeWidth={1.25} className="text-fg-subtle" />
            <p className="text-sm text-fg-muted">还没有发送记录</p>
            <p className="text-xs text-fg-subtle">历史只存在本机，不会提交到 git</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <ul className="min-h-0 w-72 shrink-0 overflow-auto border-r border-line-subtle py-1">
              {/* key 用 at：它是纳秒精度的时间戳，本身就唯一 */}
              {entries.map((entry, index) => (
                <li key={entry.at}>
                  <button
                    type="button"
                    onClick={() => setSelected(index)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left",
                      "transition-colors duration-fast",
                      index === selected ? "bg-selected" : "hover:bg-hover",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <MethodBadge method={entry.method} />
                      <span className="pk-truncate flex-1 text-sm text-fg">{entry.name}</span>
                      <StatusBadge status={entry.status} />
                    </span>
                    <span className="flex items-center gap-1.5 text-2xs text-fg-subtle">
                      <span title={entry.at}>{relativeTime(entry.at, now)}</span>
                      <span className="pk-tnum">{entry.elapsedMs} ms</span>
                      {entry.environment ? (
                        <span className="pk-truncate">{entry.environment}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {current ? <EntryDetail entry={current} /> : null}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function EntryDetail({ entry }: { entry: HistoryEntry }) {
  return (
    <>
      <div className="shrink-0 border-b border-line-subtle px-3 py-2">
        {/* 存的是插值后的真实 URL：回看时想知道的是实际打到了哪儿，
            而不是 {{baseUrl}}/users 这种还原不出上下文的模板 */}
        <p className="pk-selectable font-mono text-xs break-all text-fg-secondary">{entry.url}</p>
      </div>

      <div className="min-h-0 flex-1">
        {entry.body.kind === "text" ? (
          <CodeEditor
            value={entry.body.content}
            language={languageOf(entry.contentType)}
            readOnly
            onChange={() => {}}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-fg-muted">
              {entry.body.kind === "binary" ? "二进制响应，历史不保留内容" : "响应体为空"}
            </p>
          </div>
        )}
      </div>

      {entry.body.kind === "text" && entry.body.truncated ? (
        // 必须显式说明，否则用户会以为服务端就返回了这么多
        <p className="shrink-0 border-t border-line-subtle px-3 py-1.5 text-xs text-warning">
          内容过长，历史中只保留了开头部分。
        </p>
      ) : null}
    </>
  );
}
