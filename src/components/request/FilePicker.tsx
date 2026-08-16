import { FileUp, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { pickFile, showError } from "@/lib/dialog";
import { file as fileIpc } from "@/lib/ipc";

/**
 * 选一个工作区内的文件，回填它相对工作区根的路径。
 *
 * 换算交给 Rust（`file_workspace_relative`）而不是在前端裁字符串：
 * 规则得和实际读文件时的 `resolve_within` 完全一致，两处各写一份迟早会分叉。
 * 顺带，「文件不在工作区内」这个必然会遇到的情况也由那边给出带路径的说明。
 */
export function FilePicker({
  value,
  onChange,
  placeholder = "未选择文件",
  compact,
}: {
  /** 相对工作区根的路径 */
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  /** 表格行内使用的紧凑版 */
  compact?: boolean;
}) {
  async function handlePick() {
    try {
      const absolute = await pickFile("选择文件");
      if (!absolute) return;
      onChange(await fileIpc.toWorkspaceRelative(absolute));
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "选择文件失败");
    }
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-1", compact ? "h-row" : "h-control-md")}>
      <button
        type="button"
        onClick={() => void handlePick()}
        title="选择工作区内的文件"
        className={cn(
          "flex h-control-sm shrink-0 items-center gap-1 rounded-md border border-line px-2",
          "text-xs text-fg-secondary transition-colors duration-fast hover:bg-hover hover:text-fg",
        )}
      >
        <FileUp size={11} strokeWidth={2} />
        选择
      </button>

      <span
        className={cn("pk-truncate min-w-0 flex-1 font-mono text-xs", !value && "text-fg-subtle")}
        title={value || placeholder}
      >
        {value || placeholder}
      </span>

      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="清除所选文件"
          title="清除"
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-subtle",
            "transition-colors duration-fast hover:bg-hover hover:text-fg",
          )}
        >
          <X size={11} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
