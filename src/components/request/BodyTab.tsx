import { Wand2 } from "lucide-react";

import { FilePicker } from "@/components/request/FilePicker";
import { MultipartTable } from "@/components/request/MultipartTable";
import { CodeEditor, type CodeLanguage } from "@/components/ui/CodeEditor";
import { KeyValueTable } from "@/components/ui/KeyValueTable";
import { cn } from "@/lib/cn";
import { formatJsonWithVariables } from "@/lib/json-format";
import { useKnownVariables } from "@/stores/workspace";
import type { RequestBody } from "@/types/api";

type BodyType = RequestBody["type"];

const TYPE_LABELS: Record<BodyType, string> = {
  none: "无",
  json: "JSON",
  text: "文本",
  xml: "XML",
  "form-urlencoded": "Form",
  multipart: "Multipart",
  binary: "二进制",
  graphql: "GraphQL",
};

/** 按使用频率排列。类型本身由 Rust 的 `RequestBody` 决定，这里只管顺序。 */
const AVAILABLE: BodyType[] = [
  "none",
  "json",
  "text",
  "xml",
  "form-urlencoded",
  "multipart",
  "binary",
  "graphql",
];

/** 这些类型的内容都存在 `content` 字段里，互相切换时可以保留已输入的文本 */
const TEXTUAL: BodyType[] = ["json", "text", "xml"];

const LANGUAGE: Partial<Record<BodyType, CodeLanguage>> = {
  json: "json",
  xml: "xml",
  text: "text",
};

function textContentOf(body: RequestBody): string {
  if (body.type === "json" || body.type === "text" || body.type === "xml") return body.content;
  return "";
}

/** 切换类型时构造新的 body，尽量不丢用户已经打好的内容 */
function convert(from: RequestBody, to: BodyType): RequestBody {
  const carried = TEXTUAL.includes(to) && TEXTUAL.includes(from.type) ? textContentOf(from) : "";

  switch (to) {
    case "none":
      return { type: "none" };
    case "json":
      return { type: "json", content: carried };
    case "text":
      return { type: "text", content: carried };
    case "xml":
      return { type: "xml", content: carried };
    case "form-urlencoded":
      return {
        type: "form-urlencoded",
        // fields 可能整个缺席（Rust 不发空数组），空表兜底
        fields: from.type === "form-urlencoded" ? (from.fields ?? []) : [],
      };
    case "multipart":
      return {
        type: "multipart",
        // 从 form-urlencoded 切过来时把字段带上：这两种编码的字段语义一致，
        // 用户多半是发现要传文件才改的类型，不该让他重填一遍
        fields:
          from.type === "multipart"
            ? (from.fields ?? [])
            : from.type === "form-urlencoded"
              ? (from.fields ?? []).map((f) => ({
                  name: f.name,
                  value: f.value,
                  // 归一成 boolean：源字段的 enabled 可能整个缺席（Rust 不发默认值），
                  // 而 exactOptionalPropertyTypes 不允许把 undefined 显式传下去
                  enabled: f.enabled !== false,
                }))
              : [],
      };
    case "binary":
      return { type: "binary", file: from.type === "binary" ? from.file : "" };
    case "graphql":
      return {
        type: "graphql",
        query: from.type === "graphql" ? from.query : "",
        // 用 ?? 而非直接透传：tsconfig 开了 exactOptionalPropertyTypes，
        // 可选属性不接受显式的 undefined
        variables: from.type === "graphql" ? (from.variables ?? "") : "",
      };
    default:
      return { type: "none" };
  }
}

interface BodyTabProps {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
}

export function BodyTab({ body, onChange }: BodyTabProps) {
  const canFormat = body.type === "json" && body.content.trim().length > 0;

  function handleFormat() {
    if (body.type !== "json") return;
    const formatted = formatJsonWithVariables(body.content);
    if (formatted !== null) onChange({ type: "json", content: formatted });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 py-2">
        {AVAILABLE.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onChange(convert(body, type))}
            className={cn(
              "h-control-sm rounded-md px-2 text-xs transition-colors duration-fast",
              body.type === type
                ? "bg-accent-soft font-medium text-accent-fg"
                : "text-fg-muted hover:bg-hover hover:text-fg",
            )}
          >
            {TYPE_LABELS[type]}
          </button>
        ))}

        <div className="flex-1" />

        {body.type === "json" ? (
          <button
            type="button"
            onClick={handleFormat}
            disabled={!canFormat}
            title="格式化 JSON（保留 {{变量}}）"
            className={cn(
              "flex h-control-sm items-center gap-1 rounded-md px-2 text-xs",
              "text-fg-muted transition-colors duration-fast hover:bg-hover hover:text-fg",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <Wand2 size={11} strokeWidth={2} />
            格式化
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 px-3 pb-3">
        <BodyEditor body={body} onChange={onChange} />
      </div>
    </div>
  );
}

/** 每种请求体各自的编辑器。抽出来后上面的组件只管类型切换与工具栏。 */
function BodyEditor({ body, onChange }: BodyTabProps) {
  const variables = useKnownVariables();

  if (body.type === "none") {
    return <p className="text-sm text-fg-muted">该请求不发送请求体。</p>;
  }

  if (body.type === "form-urlencoded") {
    return (
      <KeyValueTable
        rows={body.fields ?? []}
        onChange={(fields) => onChange({ type: "form-urlencoded", fields })}
        namePlaceholder="字段名"
        emptyHint="以 application/x-www-form-urlencoded 编码发送"
      />
    );
  }

  if (body.type === "multipart") {
    return (
      <MultipartTable
        fields={body.fields ?? []}
        onChange={(fields) => onChange({ type: "multipart", fields })}
      />
    );
  }

  if (body.type === "binary") {
    return (
      <div className="flex flex-col gap-2">
        <FilePicker
          value={body.file}
          onChange={(file) => onChange({ ...body, file })}
          placeholder="未选择文件，将发送空请求体"
        />
        <p className="text-xs text-fg-subtle">
          文件内容原样作为请求体发送，Content-Type 按扩展名推断。
          路径相对工作区根，所以这个文件要放在工作区里才能跟着仓库一起共享。
        </p>
      </div>
    );
  }

  if (body.type === "graphql") {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-surface">
          <CodeEditor
            value={body.query}
            onChange={(query) => onChange({ ...body, query })}
            language="text"
            variables={variables}
            placeholder="query { user(id: 1) { name } }"
            ariaLabel="GraphQL 查询"
          />
        </div>
        <div className="h-24 shrink-0 overflow-hidden rounded-md border border-line bg-surface">
          <CodeEditor
            value={body.variables ?? ""}
            onChange={(vars) => onChange({ ...body, variables: vars })}
            language="json"
            variables={variables}
            placeholder='{ "id": 1 }'
            ariaLabel="GraphQL 变量"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden rounded-md border border-line bg-surface">
      <CodeEditor
        value={textContentOf(body)}
        onChange={(content) => onChange({ ...body, content } as RequestBody)}
        language={LANGUAGE[body.type] ?? "text"}
        variables={variables}
        placeholder={body.type === "json" ? '{\n  "key": "value"\n}' : "请求体内容"}
        ariaLabel="请求体"
      />
    </div>
  );
}
