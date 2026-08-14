import { describe, expect, it } from "vitest";

import { formatJsonWithVariables } from "./json-format";

describe("formatJsonWithVariables", () => {
  it("格式化普通 JSON", () => {
    expect(formatJsonWithVariables('{"a":1,"b":[2,3]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
    );
  });

  /** 请求体里带变量是常态，直接 JSON.parse 会失败 */
  it("保留字符串内的变量", () => {
    const formatted = formatJsonWithVariables('{"token":"Bearer {{token}}","id":"{{userId}}"}');
    expect(formatted).toContain('"Bearer {{token}}"');
    expect(formatted).toContain('"{{userId}}"');
  });

  it("保留同一个变量的多次出现", () => {
    const formatted = formatJsonWithVariables('{"a":"{{x}}","b":"{{x}}","c":"{{y}}"}');
    expect(formatted?.match(/\{\{x\}\}/g)).toHaveLength(2);
    expect(formatted).toContain("{{y}}");
  });

  it("变量名含空格时原样保留", () => {
    expect(formatJsonWithVariables('{"a":"{{ token }}"}')).toContain("{{ token }}");
  });

  it("非法 JSON 返回 null", () => {
    expect(formatJsonWithVariables("{这不是 json")).toBeNull();
    expect(formatJsonWithVariables("")).toBeNull();
  });

  /** 已知限制：变量独立作为值时无法格式化，应当明确返回 null 而不是产出坏内容 */
  it("变量独立作为值时返回 null", () => {
    expect(formatJsonWithVariables('{"count": {{n}}}')).toBeNull();
  });
});
