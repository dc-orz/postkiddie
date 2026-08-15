import { describe, expect, it } from "vitest";
import { autoScale, resolveScale, SCALE_STEPS } from "./settings";

describe("autoScale", () => {
  it("笔记本内屏保持基准大小", () => {
    // 设计基准就是 14" MacBook Pro 的 1512pt
    expect(autoScale(1512)).toBe(1);
    expect(autoScale(1440)).toBe(1);
  });

  it("1920 及以上放大一档", () => {
    expect(autoScale(1920)).toBe(1.1);
    expect(autoScale(2304)).toBe(1.1);
  });

  it("2560 及以上放大两档", () => {
    expect(autoScale(2560)).toBe(1.25);
    expect(autoScale(3008)).toBe(1.25);
  });

  /**
   * 阈值是「大于等于」而非「大于」。1920 与 2560 都是极常见的逻辑宽度，
   * 边界弄反的话正好在最主流的两种屏幕上给出错误档位。
   */
  it("阈值处取的是上一档", () => {
    expect(autoScale(1919)).toBe(1);
    expect(autoScale(2559)).toBe(1.1);
  });
});

describe("resolveScale", () => {
  it("手动档原样返回", () => {
    for (const step of SCALE_STEPS) {
      expect(resolveScale(step)).toBe(step);
    }
  });

  it("auto 换算成具体倍率", () => {
    const resolved = resolveScale("auto");
    expect(SCALE_STEPS).toContain(resolved);
  });
});
