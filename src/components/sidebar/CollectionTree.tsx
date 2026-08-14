import { ChevronDown, ChevronRight, FileWarning, Folder, FolderOpen } from "lucide-react";
import { useState } from "react";

import { MethodBadge } from "@/components/ui/MethodBadge";
import { cn } from "@/lib/cn";
import type { FileState, TreeNode } from "@/types/api";

/** git 状态 → 单字符标记。用字符而非色块，在密集列表里更安静且能表意。 */
const GIT_MARK: Record<FileState, { char: string; className: string; label: string }> = {
  added: { char: "A", className: "text-git-added", label: "新增" },
  modified: { char: "M", className: "text-git-modified", label: "已修改" },
  deleted: { char: "D", className: "text-git-deleted", label: "已删除" },
  renamed: { char: "R", className: "text-git-renamed", label: "已重命名" },
  copied: { char: "C", className: "text-git-renamed", label: "已复制" },
  untracked: { char: "U", className: "text-git-untracked", label: "未跟踪" },
  ignored: { char: "·", className: "text-fg-subtle", label: "已忽略" },
  conflicted: { char: "!", className: "text-git-conflicted", label: "冲突" },
};

interface CollectionTreeProps {
  nodes: TreeNode[];
  /** 请求路径 → git 状态 */
  gitStates: Record<string, FileState>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CollectionTree({ nodes, gitStates, selectedId, onSelect }: CollectionTreeProps) {
  return (
    <ul className="py-1">
      {nodes.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          gitStates={gitStates}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

interface TreeItemProps extends Omit<CollectionTreeProps, "nodes"> {
  node: TreeNode;
  depth: number;
}

function TreeItem({ node, depth, gitStates, selectedId, onSelect }: TreeItemProps) {
  const [expanded, setExpanded] = useState(depth === 0);

  // 缩进用 padding 而非嵌套 margin，这样整行的 hover 高亮能铺满侧栏宽度
  const indent = {
    paddingLeft: `calc(${depth} * var(--pk-indent-tree) + 0.375rem)`,
  };
  const selected = selectedId === node.id;

  const rowClass = cn(
    "flex h-row w-full items-center gap-1.5 pr-2 text-left",
    "transition-colors duration-[120ms]",
    selected ? "bg-selected text-fg" : "text-fg-secondary hover:bg-hover",
  );

  if (node.kind === "folder") {
    const Chevron = expanded ? ChevronDown : ChevronRight;
    const FolderIcon = expanded ? FolderOpen : Folder;

    return (
      <li>
        <button
          type="button"
          className={rowClass}
          style={indent}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <Chevron size={12} strokeWidth={2} className="text-fg-subtle" />
          <FolderIcon size={13} strokeWidth={1.75} className="text-fg-muted" />
          <span className="pk-truncate text-sm">{node.name}</span>
        </button>

        {expanded ? (
          <ul>
            {node.children.map((child) => (
              <TreeItem
                key={child.id}
                node={child}
                depth={depth + 1}
                gitStates={gitStates}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  if (node.kind === "broken") {
    return (
      <li>
        <button type="button" className={rowClass} style={indent} title={node.error}>
          <FileWarning size={13} strokeWidth={1.75} className="ml-3.5 text-danger" />
          <span className="pk-truncate text-sm text-danger">{node.name}</span>
        </button>
      </li>
    );
  }

  // 先取出再判断：tsconfig 开了 noUncheckedIndexedAccess，
  // 索引签名的取值带 undefined，重复索引无法收窄
  const gitState = gitStates[node.id];
  const mark = gitState ? GIT_MARK[gitState] : null;

  return (
    <li>
      <button type="button" className={rowClass} style={indent} onClick={() => onSelect(node.id)}>
        <MethodBadge method={node.method} />
        <span className="pk-truncate flex-1 text-sm">{node.name}</span>
        {mark ? (
          // role="img" + aria-label：单字符标记对视觉用户是图形，
          // 对读屏用户则应读出「已修改」而不是字母 M
          <span
            role="img"
            aria-label={mark.label}
            title={mark.label}
            className={cn("font-mono text-2xs font-bold", mark.className)}
          >
            {mark.char}
          </span>
        ) : null}
      </button>
    </li>
  );
}
