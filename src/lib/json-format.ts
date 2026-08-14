/**
 * 格式化可能含 `{{变量}}` 的 JSON。
 *
 * 直接 `JSON.parse` 会被变量占位符噎住——而请求体里带变量恰恰是常态
 * （`"password": "{{pwd}}"`）。这里先把变量换成不含特殊字符的占位标记，
 * 格式化后再原样换回。
 *
 * 已知限制：变量独立作为**值**出现时（`{"n": {{count}}}`）替换后仍不是合法 JSON，
 * 此时返回 null，由调用方提示用户。这种写法在实践中很少见，
 * 为它引入一个完整的容错 JSON 解析器不划算。
 *
 * @returns 格式化后的文本；无法解析时返回 null
 */
export function formatJsonWithVariables(source: string, indent = 2): string | null {
  const placeholders: string[] = [];

  const masked = source.replace(/\{\{[^{}]*\}\}/g, (match) => {
    placeholders.push(match);
    return `__PK_VAR_${placeholders.length - 1}__`;
  });

  try {
    const formatted = JSON.stringify(JSON.parse(masked), null, indent);
    return formatted.replace(/__PK_VAR_(\d+)__/g, (_, index) => placeholders[Number(index)] ?? "");
  } catch {
    return null;
  }
}
