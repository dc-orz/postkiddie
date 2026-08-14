import { Check, Copy, Inbox, Loader2, TriangleAlert, WrapText } from "lucide-react";
import { useMemo, useState } from "react";

import { CodeEditor, type CodeLanguage } from "@/components/ui/CodeEditor";
import { Metric, StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import { formatJsonWithVariables } from "@/lib/json-format";
import { useRequest } from "@/stores/request";
import type { HttpResponse, KeyValue } from "@/types/api";

const TABS = ["响应体", "响应头"] as const;
type Tab = (typeof TABS)[number];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function headerValue(headers: KeyValue[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name)?.value;
}

/** 按 content-type 选语法高亮。服务端不给或给错时退回纯文本，不猜。 */
function languageOf(contentType: string | undefined): CodeLanguage {
  if (!contentType) return "text";
  const ct = contentType.toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("xml") || ct.includes("html")) return "xml";
  return "text";
}

export function ResponsePane() {
  const response = useRequest((s) => s.response);
  const sending = useRequest((s) => s.sending);
  const sendError = useRequest((s) => s.sendError);
  const missingVariables = useRequest((s) => s.missingVariables);

  const [tab, setTab] = useState<Tab>("响应体");

  if (sending) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-2 bg-canvas">
        <Loader2 size={22} strokeWidth={1.5} className="animate-spin text-fg-subtle" />
        <p className="text-sm text-fg-muted">请求发送中…</p>
      </section>
    );
  }

  if (sendError) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 bg-canvas px-8">
        <TriangleAlert size={24} strokeWidth={1.5} className="text-danger" />
        <p className="max-w-lg text-center text-sm text-fg-secondary">{sendError.message}</p>

        {missingVariables.length > 0 ? (
          <div className="rounded-md border border-warning-line bg-warning-soft px-3 py-2">
            <p className="text-xs text-warning">
              以下变量在当前环境中未定义：
              <span className="ml-1 font-mono">{missingVariables.join("、")}</span>
            </p>
          </div>
        ) : null}
      </section>
    );
  }

  if (!response) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-2 bg-canvas">
        <Inbox size={24} strokeWidth={1.25} className="text-fg-subtle" />
        <p className="text-sm text-fg-muted">发送请求后在此查看响应</p>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex h-tab shrink-0 items-center gap-3 border-b border-line-subtle px-3">
        <div className="flex items-center gap-0.5">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "relative h-tab px-2.5 text-sm transition-colors duration-fast",
                tab === t ? "font-medium text-fg" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              {t}
              {t === "响应头" && response.headers.length > 0 ? (
                <span className="pk-tnum ml-1 text-2xs text-fg-subtle">
                  {response.headers.length}
                </span>
              ) : null}
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

      <div className="min-h-0 flex-1">
        {tab === "响应头" ? (
          <HeadersView headers={response.headers} />
        ) : (
          <BodyView response={response} />
        )}
      </div>
    </section>
  );
}

function HeadersView({ headers }: { headers: KeyValue[] }) {
  return (
    <div className="h-full overflow-auto bg-sunken">
      <table className="w-full text-base">
        <tbody>
          {headers.map((header) => (
            <tr key={`${header.name}:${header.value}`} className="border-b border-line-subtle">
              <td className="w-1/3 px-3 py-1 align-top font-mono text-fg-secondary">
                {header.name}
              </td>
              <td className="pk-selectable px-3 py-1 align-top font-mono break-all">
                {header.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BodyView({ response }: { response: HttpResponse }) {
  const [pretty, setPretty] = useState(true);
  const [copied, setCopied] = useState(false);

  const contentType = headerValue(response.headers, "content-type");
  const language = languageOf(contentType);

  const raw = response.body.kind === "text" ? response.body.content : "";

  /**
   * 默认美化 JSON。服务端返回的 JSON 多半是压缩过的一整行，
   * 直接看等于看不了；但保留开关，因为「原样是什么」有时才是要查的东西。
   */
  const shown = useMemo(() => {
    if (!pretty || language !== "json") return raw;
    return formatJsonWithVariables(raw) ?? raw;
  }, [raw, pretty, language]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用（无权限）时静默——复制失败不值得打断用户
    }
  }

  if (response.body.kind === "empty") {
    return (
      <div className="flex h-full items-center justify-center bg-sunken">
        <p className="text-sm text-fg-muted">响应体为空</p>
      </div>
    );
  }

  if (response.body.kind === "binary") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-sunken">
        <p className="text-sm text-fg-muted">
          二进制内容（{contentType ?? "未知类型"}，{formatSize(response.sizeBytes)}）
        </p>
        <p className="text-xs text-fg-subtle">预览与另存为待接入</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sunken">
      <div className="flex shrink-0 items-center gap-1 border-b border-line-subtle px-2 py-1">
        {language === "json" ? (
          <button
            type="button"
            onClick={() => setPretty((v) => !v)}
            aria-pressed={pretty}
            title={pretty ? "显示原始响应" : "美化 JSON"}
            className={cn(
              "flex h-control-sm items-center gap-1 rounded-md px-2 text-xs transition-colors duration-fast",
              pretty
                ? "bg-accent-soft text-accent-fg"
                : "text-fg-muted hover:bg-hover hover:text-fg",
            )}
          >
            <WrapText size={11} strokeWidth={2} />
            美化
          </button>
        ) : null}

        <div className="flex-1" />

        {contentType ? (
          <span className="pk-truncate max-w-xs font-mono text-2xs text-fg-subtle">
            {contentType}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => void handleCopy()}
          title="复制响应体"
          className={cn(
            "flex h-control-sm items-center gap-1 rounded-md px-2 text-xs",
            "text-fg-muted transition-colors duration-fast hover:bg-hover hover:text-fg",
          )}
        >
          {copied ? (
            <Check size={11} strokeWidth={2} className="text-success" />
          ) : (
            <Copy size={11} strokeWidth={2} />
          )}
          {copied ? "已复制" : "复制"}
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {/* 只读的 CodeEditor 而非 <pre>：白得了语法高亮、搜索、折叠与大文档的虚拟滚动 */}
        <CodeEditor value={shown} language={language} readOnly ariaLabel="响应体" />
      </div>
    </div>
  );
}
