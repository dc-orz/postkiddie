import type { DropPosition } from "@/components/sidebar/CollectionTree";
import type { TreeNode } from "@/types/api";

/**
 * 拖拽落点的换算。
 *
 * 抽成纯函数而不是留在组件里：这里的索引调整是这类功能最容易出错的地方，
 * 而它完全不依赖 DOM，值得被直接单测覆盖。
 */

export interface Location {
  /** 所在目录的 id；null 表示集合根 */
  parent: string | null;
  /** 在该目录中的下标 */
  index: number;
}

/** 在树里定位一个节点 */
export function locate(
  nodes: TreeNode[],
  id: string,
  parent: string | null = null,
): Location | null {
  const index = nodes.findIndex((n) => n.id === id);
  if (index >= 0) return { parent, index };

  for (const node of nodes) {
    if (node.kind === "folder") {
      const found = locate(node.children, id, node.id);
      if (found) return found;
    }
  }
  return null;
}

/** 移动的目标位置。`index` 为 null 表示追加到末尾。 */
export interface MoveTarget {
  parent: string | null;
  index: number | null;
}

/**
 * 把「拖到某节点的 before/after/inside」换算成「目标目录 + 插入下标」。
 *
 * 关键在于同目录内向后拖的修正：后端会先把源项从顺序里摘掉再插入，
 * 所以其后所有位置都整体前移一位。漏掉这一步的表现是「往下拖一格没反应」——
 * 它精确地落回了原处。
 */
export function resolveDropTarget(
  tree: TreeNode[],
  sourceId: string,
  targetId: string,
  position: DropPosition,
): MoveTarget | null {
  if (sourceId === targetId) return null;

  // 落在文件夹身上 = 移入其中，追加在末尾
  if (position === "inside") {
    return { parent: targetId, index: null };
  }

  const target = locate(tree, targetId);
  if (!target) return null;

  let index = position === "before" ? target.index : target.index + 1;

  const source = locate(tree, sourceId);
  if (source && source.parent === target.parent && source.index < index) {
    index -= 1;
  }

  return { parent: target.parent, index };
}

/** 把请求拖进它自己所在的文件夹里是无意义的，UI 可用它提前拦掉 */
export function isNoopMove(tree: TreeNode[], sourceId: string, target: MoveTarget): boolean {
  const source = locate(tree, sourceId);
  if (!source) return false;
  return source.parent === target.parent && target.index === source.index;
}
