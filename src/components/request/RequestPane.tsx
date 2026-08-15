import { Check, Loader2, MousePointerClick, Save, Send } from "lucide-react";
import { useState } from "react";

import { AuthTab } from "@/components/request/AuthTab";
import { BodyTab } from "@/components/request/BodyTab";
import { DEFAULT_SETTINGS, SettingsTab } from "@/components/request/SettingsTab";
import { Button } from "@/components/ui/Button";
import { KeyValueTable } from "@/components/ui/KeyValueTable";
import { cn } from "@/lib/cn";
import { showError } from "@/lib/dialog";
import { shortcut } from "@/lib/platform";
import { useIsDirty, useRequest } from "@/stores/request";
import { HTTP_METHODS, type HttpMethod, type HttpRequest, type KeyValue } from "@/types/api";

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
type Tab = (typeof TABS)[number];

export function RequestPane() {
  const draft = useRequest((s) => s.draft);
  const loading = useRequest((s) => s.loading);
  const sending = useRequest((s) => s.sending);
  const update = useRequest((s) => s.update);
  const save = useRequest((s) => s.save);
  const send = useRequest((s) => s.send);
  const dirty = useIsDirty();

  const [tab, setTab] = useState<Tab>("参数");
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <section className="flex h-full items-center justify-center">
        <Loader2 size={18} strokeWidth={1.75} className="animate-spin text-fg-subtle" />
      </section>
    );
  }

  if (!draft) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-2">
        <MousePointerClick size={24} strokeWidth={1.25} className="text-fg-subtle" />
        <p className="text-sm text-fg-muted">从左侧选择一个请求</p>
      </section>
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await save();
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* 名称行：请求名直接就地编辑，不必为改个名开一个对话框 */}
      <div className="flex h-toolbar shrink-0 items-center gap-1.5 px-3">
        <input
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
          aria-label="请求名称"
          placeholder="未命名请求"
          spellCheck={false}
          className={cn(
            "min-w-0 flex-1 rounded-sm bg-transparent px-1 py-0.5 text-md font-medium",
            "outline-none hover:bg-hover focus:bg-sunken",
          )}
        />

        {dirty ? (
          <span
            role="img"
            aria-label="有未保存的改动"
            title="有未保存的改动"
            className="size-1.5 shrink-0 rounded-full bg-git-modified"
          />
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          title={`保存 (${shortcut("S")})`}
        >
          {saving ? (
            <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          ) : dirty ? (
            <Save size={12} strokeWidth={2} />
          ) : (
            <Check size={12} strokeWidth={2} />
          )}
          {dirty ? "保存" : "已保存"}
        </Button>
      </div>

      {/* URL 栏：整个应用最高频的交互，做成一个视觉整体而非三个割裂控件 */}
      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
        <div className="flex h-control-lg flex-1 items-center rounded-md border border-line bg-surface focus-within:border-line-focus">
          <select
            value={draft.method}
            onChange={(e) => update({ method: e.target.value as HttpMethod })}
            aria-label="请求方法"
            className={cn(
              "h-full cursor-default appearance-none bg-transparent pr-1 pl-2.5",
              "font-mono text-xs font-semibold tracking-caps outline-none",
              METHOD_COLOR[draft.method],
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
            value={draft.url}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="{{baseUrl}}/api/v1/users"
            spellCheck={false}
            aria-label="请求 URL"
            className="h-full flex-1 bg-transparent px-2.5 font-mono text-base outline-none"
          />
        </div>

        <Button
          variant="primary"
          size="lg"
          onClick={() => void send()}
          disabled={sending}
          title={`发送 (${shortcut("↩")})`}
        >
          {sending ? (
            <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          ) : (
            <Send size={12} strokeWidth={2.25} />
          )}
          {sending ? "发送中" : "发送"}
        </Button>
      </div>

      {/* 分段标签。用底部 2px 指示条而非整块底色，是「靠边框而非填充划分区域」的一贯做法 */}
      <div className="flex h-tab shrink-0 items-center gap-0.5 border-b border-line-subtle px-3">
        {TABS.map((t) => {
          const badge = badgeOf(t, draft);
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "relative h-full px-2.5 text-sm transition-colors duration-fast",
                tab === t ? "font-medium text-fg" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              {t}
              {badge ? <span className="pk-tnum ml-1 text-2xs text-fg-subtle">{badge}</span> : null}
              {tab === t ? (
                <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-accent" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-sunken">
        <TabContent tab={tab} draft={draft} update={update} />
      </div>
    </section>
  );
}

interface TabContentProps {
  tab: Tab;
  draft: HttpRequest;
  update: (patch: Partial<HttpRequest>) => void;
}

/** 抽出来单独成组件，避免 RequestPane 因为一长串三元表达式而复杂度失控 */
function TabContent({ tab, draft, update }: TabContentProps) {
  switch (tab) {
    case "参数":
      return (
        <div className="p-3">
          <KeyValueTable
            rows={draft.params ?? []}
            onChange={(params) => update({ params })}
            namePlaceholder="参数名"
            emptyHint="这里的参数会与 URL 中已有的查询串合并"
          />
        </div>
      );

    case "请求头":
      return (
        <div className="p-3">
          <KeyValueTable
            rows={draft.headers ?? []}
            onChange={(headers) => update({ headers })}
            namePlaceholder="请求头"
            suggest="headers"
            emptyHint="未列出的请求头由上层文件夹与工作区的设置提供"
          />
        </div>
      );

    case "请求体":
      return (
        <BodyTab body={draft.body ?? { type: "none" }} onChange={(body) => update({ body })} />
      );

    case "认证":
      return (
        <AuthTab auth={draft.auth ?? { type: "inherit" }} onChange={(auth) => update({ auth })} />
      );

    default:
      return (
        <SettingsTab
          settings={draft.settings ?? DEFAULT_SETTINGS}
          onChange={(settings) => update({ settings })}
        />
      );
  }
}

/** 标签上的计数徽章：只统计**启用**的条目，禁用的不发送也就不该计入 */
function badgeOf(tab: Tab, draft: HttpRequest): string | null {
  const countEnabled = (rows: KeyValue[] | undefined) =>
    (rows ?? []).filter((r) => r.enabled !== false && r.name.trim()).length;

  switch (tab) {
    case "参数": {
      const n = countEnabled(draft.params);
      return n > 0 ? String(n) : null;
    }
    case "请求头": {
      const n = countEnabled(draft.headers);
      return n > 0 ? String(n) : null;
    }
    case "请求体":
      return draft.body && draft.body.type !== "none" ? "•" : null;
    case "认证":
      return draft.auth && draft.auth.type !== "inherit" && draft.auth.type !== "none" ? "•" : null;
    default:
      return null;
  }
}
