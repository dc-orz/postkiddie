import { Plus, Trash2 } from "lucide-react";

import { FilePicker } from "@/components/request/FilePicker";
import { cn } from "@/lib/cn";
import type { MultipartField } from "@/types/api";

/**
 * multipart/form-data 的字段表。
 *
 * 没有复用 `KeyValueTable`：这里每一行要在「文本值」和「文件」之间切换，
 * 而那个组件的整个模型就是一对字符串。硬塞进去只会让两边都变难读。
 *
 * 文件字段存的是**相对工作区根的路径**（见 `FilePicker`），这样上传用的
 * 测试夹具可以跟着请求一起提交进仓库，同事拉下来就能直接发。
 */
/**
 * 这一行是文件字段吗。
 *
 * `file` 有三种「没有」：键不存在、值为 null、空字符串。前两种是「这是文本字段」，
 * 第三种是「这是文件字段，但还没选文件」——后者必须留在文件模式，
 * 否则用户点了「文件」还没来得及选，这一行就自己跳回文本了。
 */
function isFileField(field: MultipartField): boolean {
  return field.file !== undefined && field.file !== null;
}

export function MultipartTable({
  fields,
  onChange,
}: {
  fields: MultipartField[];
  onChange: (fields: MultipartField[]) => void;
}) {
  function update(index: number, patch: Partial<MultipartField>) {
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function remove(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...fields, { name: "", value: "", enabled: true }]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {fields.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-fg-subtle">
            以 multipart/form-data 编码发送，可混合文本字段与文件
          </p>
        ) : (
          <ul>
            {fields.map((field, index) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: 行由位置定义，字段名可空且允许重复，没有比下标更稳定的 key
                key={index}
                className="flex items-center gap-1.5 border-b border-line-subtle py-1"
              >
                <input
                  type="checkbox"
                  checked={field.enabled !== false}
                  onChange={(e) => update(index, { enabled: e.target.checked })}
                  aria-label={`启用字段 ${field.name || index + 1}`}
                  className="shrink-0 accent-accent"
                />

                <input
                  value={field.name}
                  onChange={(e) => update(index, { name: e.target.value })}
                  placeholder="字段名"
                  aria-label="字段名"
                  className={cn(
                    "h-control-sm w-32 shrink-0 rounded-sm bg-transparent px-1.5 text-xs outline-none",
                    "focus:bg-sunken placeholder:text-fg-subtle",
                  )}
                />

                {/* 一行只能是文本或文件之一，两个字段同时有值时后端的行为是「文件优先」，
                    与其让用户去猜，不如在这里就只让他选一种。
                    用 null 而不是 undefined 清掉另一边：tsconfig 开了
                    exactOptionalPropertyTypes，给可选属性显式赋 undefined 是不合法的；
                    而 null 在 Rust 侧同样反序列化成 None，语义一致。 */}
                <select
                  value={isFileField(field) ? "file" : "text"}
                  onChange={(e) =>
                    update(
                      index,
                      e.target.value === "file"
                        ? { file: "", value: null }
                        : { file: null, value: "" },
                    )
                  }
                  aria-label="字段类型"
                  className="h-control-sm shrink-0 cursor-default rounded-sm bg-transparent text-xs outline-none"
                >
                  <option value="text">文本</option>
                  <option value="file">文件</option>
                </select>

                <div className="min-w-0 flex-1">
                  {!isFileField(field) ? (
                    <input
                      value={field.value ?? ""}
                      onChange={(e) => update(index, { value: e.target.value })}
                      placeholder="值"
                      aria-label="字段值"
                      className={cn(
                        "h-control-sm w-full rounded-sm bg-transparent px-1.5 text-xs outline-none",
                        "focus:bg-sunken placeholder:text-fg-subtle",
                      )}
                    />
                  ) : (
                    <FilePicker
                      compact
                      value={field.file ?? ""}
                      onChange={(path) => update(index, { file: path })}
                    />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`删除字段 ${field.name || index + 1}`}
                  title="删除"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-subtle",
                    "transition-colors duration-fast hover:bg-danger-soft hover:text-danger",
                  )}
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={add}
        className={cn(
          "mt-1.5 flex h-control-sm shrink-0 items-center gap-1 self-start rounded-md px-2",
          "text-xs text-fg-muted transition-colors duration-fast hover:bg-hover hover:text-fg",
        )}
      >
        <Plus size={11} strokeWidth={2} />
        添加字段
      </button>
    </div>
  );
}
