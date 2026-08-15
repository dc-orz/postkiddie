import { describe, expect, it } from "vitest";
import type { TreeNode } from "@/types/api";
import { isNoopMove, locate, resolveDropTarget } from "./tree-move";

function req(id: string, name: string): TreeNode {
  return { kind: "request", id, name, method: "GET", url: "/x" };
}

/**
 * collections/
 *   A/  a1 a2 a3
 *   B/  b1
 *   顶层还有一个 root.yaml
 */
const TREE: TreeNode[] = [
  {
    kind: "folder",
    id: "collections/A",
    name: "A",
    children: [
      req("collections/A/a1.yaml", "a1"),
      req("collections/A/a2.yaml", "a2"),
      req("collections/A/a3.yaml", "a3"),
    ],
  },
  {
    kind: "folder",
    id: "collections/B",
    name: "B",
    children: [req("collections/B/b1.yaml", "b1")],
  },
  req("collections/root.yaml", "root"),
];

describe("locate", () => {
  it("找到嵌套节点及其所在目录与下标", () => {
    expect(locate(TREE, "collections/A/a2.yaml")).toEqual({
      parent: "collections/A",
      index: 1,
    });
  });

  it("顶层节点的父目录是 null（即集合根）", () => {
    // 顶层有两个文件夹在前，root.yaml 排在下标 2
    expect(locate(TREE, "collections/root.yaml")).toEqual({ parent: null, index: 2 });
  });

  it("找不到时返回 null", () => {
    expect(locate(TREE, "collections/不存在.yaml")).toBeNull();
  });
});

describe("resolveDropTarget", () => {
  /**
   * 回归测试：后端会先把源项从顺序里摘掉再插入，所以同目录内向后拖时
   * 目标位置整体前移一位。不做这个修正的表现是「往下拖一格没反应」。
   */
  it("同目录向后拖时下标要减一", () => {
    // a1(0) 拖到 a3(2) 之后：朴素算法给 3，正确答案是 2
    expect(
      resolveDropTarget(TREE, "collections/A/a1.yaml", "collections/A/a3.yaml", "after"),
    ).toEqual({ parent: "collections/A", index: 2 });
  });

  it("同目录向前拖时不需要修正", () => {
    // a3(2) 拖到 a1(0) 之前
    expect(
      resolveDropTarget(TREE, "collections/A/a3.yaml", "collections/A/a1.yaml", "before"),
    ).toEqual({ parent: "collections/A", index: 0 });
  });

  it("向后拖一格：a1 拖到 a2 之后应落在下标 1", () => {
    expect(
      resolveDropTarget(TREE, "collections/A/a1.yaml", "collections/A/a2.yaml", "after"),
    ).toEqual({ parent: "collections/A", index: 1 });
  });

  /** 跨目录时源项不在目标目录里，不该做减一修正 */
  it("跨目录拖动不做下标修正", () => {
    expect(
      resolveDropTarget(TREE, "collections/A/a1.yaml", "collections/B/b1.yaml", "after"),
    ).toEqual({ parent: "collections/B", index: 1 });
    expect(
      resolveDropTarget(TREE, "collections/A/a1.yaml", "collections/B/b1.yaml", "before"),
    ).toEqual({ parent: "collections/B", index: 0 });
  });

  it("落在文件夹身上表示移入，追加到末尾", () => {
    expect(resolveDropTarget(TREE, "collections/A/a1.yaml", "collections/B", "inside")).toEqual({
      parent: "collections/B",
      index: null,
    });
  });

  it("拖到自己身上返回 null", () => {
    expect(
      resolveDropTarget(TREE, "collections/A/a1.yaml", "collections/A/a1.yaml", "after"),
    ).toBeNull();
  });

  it("目标不存在时返回 null", () => {
    expect(
      resolveDropTarget(TREE, "collections/A/a1.yaml", "collections/幽灵.yaml", "after"),
    ).toBeNull();
  });

  it("拖到顶层节点时父目录为 null", () => {
    expect(
      resolveDropTarget(TREE, "collections/A/a1.yaml", "collections/root.yaml", "before"),
    ).toEqual({ parent: null, index: 2 });
  });
});

describe("isNoopMove", () => {
  it("原地不动的移动被识别出来", () => {
    // a2 拖到 a2 原来的位置
    expect(isNoopMove(TREE, "collections/A/a2.yaml", { parent: "collections/A", index: 1 })).toBe(
      true,
    );
  });

  it("换了位置就不是空操作", () => {
    expect(isNoopMove(TREE, "collections/A/a2.yaml", { parent: "collections/A", index: 0 })).toBe(
      false,
    );
    expect(isNoopMove(TREE, "collections/A/a2.yaml", { parent: "collections/B", index: 1 })).toBe(
      false,
    );
  });
});
