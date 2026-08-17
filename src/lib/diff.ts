/**
 * unified diff 解析。
 *
 * 输入是 `git diff` 的原文，输出是可直接渲染的行序列。放在前端而非 Rust 侧，
 * 是因为这纯粹是展示层的事——同一份 diff 文本，换个视图（并排/行内）解析方式就不同，
 * 没必要为此跨一次 IPC 边界。
 *
 * 这段逻辑值得单测：解析错了不会抛异常，只会让某几行的行号偏移或颜色标反，
 * 而「diff 看着对、其实错位」比直接报错危险得多。
 */

export type DiffLine =
  /** `@@ -1,4 +1,5 @@` 段落分隔 */
  | { kind: "hunk"; text: string }
  | { kind: "add"; text: string; newNo: number }
  | { kind: "del"; text: string; oldNo: number }
  | { kind: "context"; text: string; oldNo: number; newNo: number }
  /** git 的旁注，如 `\ No newline at end of file`、模式变更 */
  | { kind: "note"; text: string };

export interface FileDiff {
  lines: DiffLine[];
  /** 二进制文件：git 只给一句「differ」，没有逐行内容可展示 */
  binary: boolean;
  added: number;
  removed: number;
}

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@ [上下文标题]` */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** 模式变更值得留一行说明：它是一次真实的改动，但没有任何内容差异 */
const MODE_CHANGE = /^(old|new) mode /;

function isBinaryMarker(line: string): boolean {
  return line.startsWith("Binary files ") || line.startsWith("GIT binary patch");
}

/** 一行解析结果，连同它对新旧行号的推进量 */
interface ParsedLine {
  line: DiffLine;
  oldStep: number;
  newStep: number;
}

/**
 * 解析 hunk **内部**的一行。
 *
 * 只在 hunk 内调用这点很要紧：`--- ` 既是文件头的形式，也可能是正文
 * （YAML 的文档分隔符就长这样）。靠位置区分，而不是靠猜前缀。
 */
function parseHunkLine(line: string, oldNo: number, newNo: number): ParsedLine {
  // `\ No newline at end of file`：它描述的是上一行，自身不占行号
  if (line.startsWith("\\")) {
    return { line: { kind: "note", text: line }, oldStep: 0, newStep: 0 };
  }

  if (line.startsWith("+")) {
    return { line: { kind: "add", text: line.slice(1), newNo }, oldStep: 0, newStep: 1 };
  }

  if (line.startsWith("-")) {
    return { line: { kind: "del", text: line.slice(1), oldNo }, oldStep: 1, newStep: 0 };
  }

  // 上下文行以一个空格开头。但**原文的空行**在 diff 里可能就是一个完全空的行——
  // 不少工具（以及被复制粘贴过的 diff）会把那个前导空格吃掉。
  // 按空行处理而不是跳过，否则前后行号会从这里开始一路错位。
  const text = line.startsWith(" ") ? line.slice(1) : line;
  return { line: { kind: "context", text, oldNo, newNo }, oldStep: 1, newStep: 1 };
}

export function parseUnifiedDiff(raw: string): FileDiff {
  const lines: DiffLine[] = [];
  let binary = false;
  let added = 0;
  let removed = 0;

  // hunk 之外的行没有行号可言，进入第一个 hunk 后才开始计数
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  // 末尾的空字符串来自结尾换行，不是内容
  const source = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  if (source.length === 0) return { lines, binary, added, removed };

  for (const line of source.split("\n")) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      lines.push({ kind: "hunk", text: line });
      continue;
    }

    if (isBinaryMarker(line)) {
      binary = true;
      lines.push({ kind: "note", text: line });
      continue;
    }

    // 第一个 hunk 之前全是文件头。除了模式变更，它们都不进结果——
    // 文件名在 UI 上已经单独显示了，再把 `a/x` `b/x` 混进内容里只会干扰阅读。
    if (!inHunk) {
      if (MODE_CHANGE.test(line)) lines.push({ kind: "note", text: line });
      continue;
    }

    const parsed = parseHunkLine(line, oldNo, newNo);
    lines.push(parsed.line);
    oldNo += parsed.oldStep;
    newNo += parsed.newStep;
    if (parsed.line.kind === "add") added++;
    if (parsed.line.kind === "del") removed++;
  }

  return { lines, binary, added, removed };
}
