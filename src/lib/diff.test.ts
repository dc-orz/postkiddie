import { describe, expect, it } from "vitest";

import { type DiffLine, parseUnifiedDiff } from "./diff";

/** 取某一类行的文本，断言时比逐个索引读得清楚 */
function textsOf(lines: DiffLine[], kind: DiffLine["kind"]): string[] {
  return lines.filter((l) => l.kind === kind).map((l) => l.text);
}

describe("parseUnifiedDiff", () => {
  it("空输入不产生任何行", () => {
    const diff = parseUnifiedDiff("");
    expect(diff.lines).toEqual([]);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it("丢掉文件头，只留内容", () => {
    const raw = [
      "diff --git a/collections/登录.yaml b/collections/登录.yaml",
      "index 1234567..89abcde 100644",
      "--- a/collections/登录.yaml",
      "+++ b/collections/登录.yaml",
      "@@ -1,3 +1,3 @@",
      " name: 用户登录",
      "-method: GET",
      "+method: POST",
      "",
    ].join("\n");

    const diff = parseUnifiedDiff(raw);

    expect(diff.lines.map((l) => l.kind)).toEqual(["hunk", "context", "del", "add"]);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
  });

  it("按 hunk 头给出正确的新旧行号", () => {
    const raw = [
      "@@ -10,4 +20,5 @@",
      " context-a",
      "-gone",
      "+added-1",
      "+added-2",
      " context-b",
    ].join("\n");

    const diff = parseUnifiedDiff(raw);

    // 旧文件：10=context-a, 11=gone, 12=context-b
    // 新文件：20=context-a, 21=added-1, 22=added-2, 23=context-b
    expect(diff.lines).toEqual([
      { kind: "hunk", text: "@@ -10,4 +20,5 @@" },
      { kind: "context", text: "context-a", oldNo: 10, newNo: 20 },
      { kind: "del", text: "gone", oldNo: 11 },
      { kind: "add", text: "added-1", newNo: 21 },
      { kind: "add", text: "added-2", newNo: 22 },
      { kind: "context", text: "context-b", oldNo: 12, newNo: 23 },
    ]);
  });

  it("多个 hunk 各自重置行号", () => {
    const raw = ["@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -50,2 +50,2 @@", " x", "-y", "+Y"].join(
      "\n",
    );

    const diff = parseUnifiedDiff(raw);
    const dels = diff.lines.filter((l) => l.kind === "del");

    expect(dels.map((l) => l.oldNo)).toEqual([2, 51]);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(2);
  });

  it("前导空格被吃掉的空行仍按上下文计数，后续行号不错位", () => {
    // 原文里的空行在 diff 中本应是 " "，但常常只剩一个空字符串。
    // 如果这里跳过它，后面所有行号都会少 1——而画面上看不出任何异常。
    const raw = ["@@ -1,4 +1,4 @@", " first", "", " third", "-fourth", "+FOURTH"].join("\n");

    const diff = parseUnifiedDiff(raw);
    const del = diff.lines.find((l) => l.kind === "del");

    expect(textsOf(diff.lines, "context")).toEqual(["first", "", "third"]);
    expect(del?.oldNo).toBe(4);
  });

  it("hunk 内以 --- 开头的正文不会被当成文件头丢掉", () => {
    // YAML 的文档分隔符正好长这样，这是本项目里非常可能出现的内容
    const raw = ["@@ -1,2 +1,2 @@", " ---", "-name: a", "+name: b"].join("\n");

    const diff = parseUnifiedDiff(raw);

    expect(textsOf(diff.lines, "context")).toEqual(["---"]);
  });

  it("标出二进制文件", () => {
    const diff = parseUnifiedDiff(
      "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n",
    );

    expect(diff.binary).toBe(true);
    expect(diff.added).toBe(0);
  });

  it("「无末尾换行」记为旁注，不占行号", () => {
    const raw = ["@@ -1,1 +1,1 @@", "-a", "\\ No newline at end of file", "+a", ""].join("\n");

    const diff = parseUnifiedDiff(raw);
    const add = diff.lines.find((l) => l.kind === "add");

    expect(textsOf(diff.lines, "note")).toEqual(["\\ No newline at end of file"]);
    expect(add?.newNo).toBe(1);
  });

  it("只改文件模式时留一行说明", () => {
    const raw = ["diff --git a/run.sh b/run.sh", "old mode 100644", "new mode 100755", ""].join(
      "\n",
    );

    const diff = parseUnifiedDiff(raw);

    expect(textsOf(diff.lines, "note")).toEqual(["old mode 100644", "new mode 100755"]);
    expect(diff.added + diff.removed).toBe(0);
  });
});
