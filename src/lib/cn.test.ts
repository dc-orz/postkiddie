import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("拼接多个类名", () => {
    expect(cn("flex", "items-center")).toBe("flex items-center");
  });

  it("过滤假值，支持条件表达式", () => {
    expect(cn("flex", false && "hidden", null, undefined, "gap-2")).toBe("flex gap-2");
  });

  /**
   * 这是引入 tailwind-merge 的唯一理由：
   * `cn("p-2", props.className)` 里调用方传 `p-4` 时，若只用 clsx 会两个类同时存在，
   * 最终效果取决于 CSS 里的出现顺序——即「组件默认值有时能被覆盖，有时不能」。
   */
  it("同一属性冲突时保留后者", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-fg-muted", "text-fg")).toBe("text-fg");
  });

  it("不同属性不互相干扰", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });
});
