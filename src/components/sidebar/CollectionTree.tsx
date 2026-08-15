import { ChevronDown, ChevronRight, FileWarning, Folder, FolderOpen } from "lucide-react";
import { useRef, useState } from "react";

import { MethodBadge } from "@/components/ui/MethodBadge";
import { cn } from "@/lib/cn";
import type { FileState, TreeNode } from "@/types/api";

/**
 * 内联重命名输入框。
 *
 * 提交时机取三个：Enter、失焦。Esc 取消。失焦也提交是刻意的——
 * 用户改完名字直接去点别的地方是最自然的动作，此时丢掉输入会很挫败。
 */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  // 用 ref 记住是否已经收尾，避免 Enter 提交后 blur 再触发一次
  const settled = useRef(false);

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    const name = value.trim();
    if (name && name !== initial) onCommit(name);
    else onCancel();
  };

  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: 进入重命名态的唯一目的就是马上输入，不自动聚焦等于每次都要多点一下
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          settled.current = true;
          onCancel();
        }
        // 方向键等不该冒泡到树的键盘导航
        e.stopPropagation();
      }}
      aria-label="重命名请求"
      className="min-w-0 flex-1 rounded-sm border border-line-focus bg-surface px-1 text-sm outline-none"
    />
  );
}

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
  /** 正在重命名的节点 id；为 null 表示无 */
  renamingId: string | null;
  onRenameStart: (id: string) => void;
  onRenameCommit: (id: string, name: string) => void;
  onRenameCancel: () => void;
}

export function CollectionTree({ nodes, ...rest }: CollectionTreeProps) {
  return (
    <ul className="py-1">
      {nodes.map((node) => (
        <TreeItem key={node.id} node={node} depth={0} {...rest} />
      ))}
    </ul>
  );
}

interface TreeItemProps extends Omit<CollectionTreeProps, "nodes"> {
  node: TreeNode;
  depth: number;
}

function TreeItem({ node, depth, ...rest }: TreeItemProps) {
  // 保留 rest 整体以便原样透传给子节点，省去每加一个回调就要改三处
  const {
    gitStates,
    selectedId,
    onSelect,
    renamingId,
    onRenameStart,
    onRenameCommit,
    onRenameCancel,
  } = rest;
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
              <TreeItem key={child.id} node={child} depth={depth + 1} {...rest} />
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

  if (renamingId === node.id) {
    return (
      <li>
        <div className={cn(rowClass, "bg-selected")} style={indent}>
          <MethodBadge method={node.method} />
          <RenameInput
            initial={node.name}
            onCommit={(name) => onRenameCommit(node.id, name)}
            onCancel={onRenameCancel}
          />
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className={rowClass}
        style={indent}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => onRenameStart(node.id)}
        title="双击重命名"
      >
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
