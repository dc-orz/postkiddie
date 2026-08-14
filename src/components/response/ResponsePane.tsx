import { Inbox } from "lucide-react";
import { useState } from "react";

import { Metric, StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import type { HttpResponse } from "@/types/api";

const TABS = ["响应体", "响应头", "Cookie"] as const;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ResponsePane({ response }: { response: HttpResponse | null }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("响应体");

  if (!response) {
    return (
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 border-t border-line-subtle bg-canvas">
        <Inbox size={28} strokeWidth={1.25} className="text-fg-subtle" />
        <p className="text-sm text-fg-muted">发送请求后在此查看响应</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col border-t border-line-subtle">
      <div className="flex h-tab shrink-0 items-center gap-3 border-b border-line-subtle px-3">
        <div className="flex items-center gap-0.5">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "relative h-tab px-2.5 text-sm transition-colors duration-[120ms]",
                tab === t ? "font-medium text-fg" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              {t}
              {tab === t ? (
                <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-accent" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* 三个指标右对齐并用等宽数字，连续发送时数值不会左右抖动 */}
        <StatusBadge status={response.status} statusText={response.statusText} />
        <Metric label="耗时" value={`${response.elapsedMs} ms`} />
        <Metric label="大小" value={formatSize(response.sizeBytes)} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-sunken">
        {response.body.kind === "text" ? (
          <pre className="pk-selectable p-3 font-mono text-base leading-code whitespace-pre-wrap">
            {response.body.content}
          </pre>
        ) : response.body.kind === "binary" ? (
          <p className="p-3 text-sm text-fg-muted">
            二进制内容（{formatSize(response.sizeBytes)}），可另存为文件查看
          </p>
        ) : (
          <p className="p-3 text-sm text-fg-muted">响应体为空</p>
        )}
      </div>
    </section>
  );
}
