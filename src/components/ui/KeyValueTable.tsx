import { Trash2 } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/cn";
import type { KeyValue } from "@/types/api";

/** 常见请求头，作为名称列的输入建议 */
const HEADER_SUGGESTIONS = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "Cookie",
  "If-None-Match",
  "Origin",
  "Referer",
  "User-Agent",
  "X-Request-Id",
];

interface KeyValueTableProps {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  namePlaceholder?: string;
  valuePlaceholder?: string;
  /** 为名称列提供输入建议，`headers` 会补上常见请求头 */
  suggest?: "headers";
  emptyHint?: string;
}

const BLANK: KeyValue = { name: "", value: "", enabled: true };

/**
 * 键值编辑表格，用于查询参数、请求头与表单字段。
 *
 * 两个刻意的行为：
 *
 * 1. **末尾常驻一个空行**，在里面打字即新增一条。这样「加一条」不需要先点按钮，
 *    连续录入多条时手不用离开键盘——这是这类工具里最高频的操作。
 * 2. **禁用不等于删除**。取消勾选只是不发送，值仍留在文件里。
 *    调试用的 header 可以一直留着随时开关，不必反复重打。
 */
export function KeyValueTable({
  rows,
  onChange,
  namePlaceholder = "名称",
  valuePlaceholder = "值",
  suggest,
  emptyHint,
}: KeyValueTableProps) {
  const listId = useId();

  // 末尾追加一个虚拟空行；它不在数据里，只在用户输入时才实体化
  const displayed = [...rows, BLANK];

  function patchRow(index: number, patch: Partial<KeyValue>) {
    if (index === rows.length) {
      onChange([...rows, { ...BLANK, ...patch }]);
    } else {
      onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    }
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  const cellInput = cn(
    "h-full w-full bg-transparent px-2 font-mono text-base outline-none",
    "placeholder:font-sans placeholder:text-fg-subtle",
  );

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      {suggest === "headers" ? (
        <datalist id={listId}>
          {HEADER_SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}

      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-8" />
          <col className="w-2/5" />
          <col />
          <col className="w-8" />
        </colgroup>

        <thead>
          <tr className="border-b border-line-subtle bg-inset text-2xs text-fg-muted">
            <th className="pk-sr-only">启用</th>
            <th className="px-2 py-1 text-left font-medium tracking-wide">{namePlaceholder}</th>
            <th className="px-2 py-1 text-left font-medium tracking-wide">{valuePlaceholder}</th>
            <th className="pk-sr-only">删除</th>
          </tr>
        </thead>

        <tbody>
          {displayed.map((row, index) => {
            const isBlank = index === rows.length;
            return (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: 行由位置定义，名称可空且允许重复，没有比下标更稳定的 key
                key={index}
                className={cn(
                  "h-control-md border-b border-line-subtle last:border-b-0",
                  // 禁用行整体压暗，一眼能看出它不会被发送
                  !isBlank && row.enabled === false && "opacity-45",
                )}
              >
                <td className="text-center align-middle">
                  {isBlank ? null : (
                    <input
                      type="checkbox"
                      checked={row.enabled !== false}
                      onChange={(e) => patchRow(index, { enabled: e.target.checked })}
                      aria-label={`启用 ${row.name || "该条目"}`}
                      className="size-3 cursor-default accent-[var(--pk-accent-bg)]"
                    />
                  )}
                </td>

                <td className="align-middle">
                  <input
                    value={row.name}
                    onChange={(e) => patchRow(index, { name: e.target.value })}
                    placeholder={isBlank ? namePlaceholder : ""}
                    spellCheck={false}
                    autoComplete="off"
                    list={suggest === "headers" ? listId : undefined}
                    aria-label={namePlaceholder}
                    className={cellInput}
                  />
                </td>

                <td className="align-middle">
                  <input
                    value={row.value}
                    onChange={(e) => patchRow(index, { value: e.target.value })}
                    placeholder={isBlank ? valuePlaceholder : ""}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={valuePlaceholder}
                    className={cellInput}
                  />
                </td>

                <td className="text-center align-middle">
                  {isBlank ? null : (
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      aria-label={`删除 ${row.name || "该条目"}`}
                      title="删除"
                      className={cn(
                        "flex size-5 items-center justify-center rounded-sm text-fg-subtle",
                        "transition-colors duration-fast hover:bg-danger-soft hover:text-danger",
                      )}
                    >
                      <Trash2 size={11} strokeWidth={2} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rows.length === 0 && emptyHint ? (
        <p className="border-t border-line-subtle px-2 py-1.5 text-xs text-fg-subtle">
          {emptyHint}
        </p>
      ) : null}
    </div>
  );
}
