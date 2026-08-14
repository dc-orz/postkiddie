import { Send } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { HTTP_METHODS, type HttpMethod, type HttpRequest } from "@/types/api";

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  PATCH: "text-method-patch",
  DELETE: "text-method-delete",
  HEAD: "text-method-head",
  OPTIONS: "text-method-options",
};

const TABS = ["参数", "请求头", "请求体", "认证", "设置"] as const;

interface RequestPaneProps {
  request: HttpRequest;
  sending: boolean;
  onChange: (patch: Partial<HttpRequest>) => void;
  onSend: () => void;
}

export function RequestPane({ request, sending, onChange, onSend }: RequestPaneProps) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("参数");

  return (
    // flex-1 让请求区与响应区默认各占一半；后续接入可拖拽分割条来调整比例
    <section className="flex min-h-0 flex-1 flex-col">
      {/* URL 栏：整个应用最高频的交互，做成一个视觉整体而非三个割裂控件 */}
      <div className="flex items-center gap-1.5 px-3 py-2">
        <div className="flex h-control-lg flex-1 items-center rounded-md border border-line bg-surface focus-within:border-line-focus">
          <select
            value={request.method}
            onChange={(e) => onChange({ method: e.target.value as HttpMethod })}
            aria-label="请求方法"
            className={cn(
              "h-full cursor-default appearance-none bg-transparent pr-1 pl-2.5",
              "font-mono text-xs font-semibold tracking-caps outline-none",
              METHOD_COLOR[request.method],
            )}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <span className="h-4 w-px bg-line" />

          <input
            value={request.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="{{baseUrl}}/api/v1/users"
            spellCheck={false}
            aria-label="请求 URL"
            className="h-full flex-1 bg-transparent px-2.5 font-mono text-base outline-none"
          />
        </div>

        <Button variant="primary" size="lg" onClick={onSend} disabled={sending}>
          <Send size={12} strokeWidth={2.25} />
          {sending ? "发送中" : "发送"}
        </Button>
      </div>

      {/* 分段标签。用底部 2px 指示条而非整块底色，是「靠边框而非填充划分区域」的一贯做法 */}
      <div className="flex h-tab shrink-0 items-center gap-0.5 border-b border-line-subtle px-3">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "relative h-full px-2.5 text-sm transition-colors duration-[120ms]",
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

      <div className="min-h-0 flex-1 overflow-auto bg-sunken p-3">
        <p className="text-sm text-fg-muted">
          {tab} 编辑器占位 —— 后续接入 CodeMirror 6 与键值表格。
        </p>
      </div>
    </section>
  );
}
