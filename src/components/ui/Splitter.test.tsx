import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Splitter } from "./Splitter";

// jsdom 没有实现 Pointer Capture。组件已对缺失做了容错，
// 但测试里补上桩函数，才能覆盖到「正常捕获」这条主路径。
beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

const MIN = 100;
const MAX = 400;
const DEFAULT = 200;

/** 受控包装：Splitter 本身不持有值，测试需要一个宿主来承接 onChange */
function Harness({ initial = DEFAULT }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Splitter
        orientation="vertical"
        label="调整宽度"
        value={value}
        min={MIN}
        max={MAX}
        onChange={setValue}
        onReset={() => setValue(DEFAULT)}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const separator = () => screen.getByRole("separator");
const currentValue = () => Number(screen.getByTestId("value").textContent);

/** 一次完整拖动：按下 → 若干次移动 → 抬起 */
function drag(dx: number, steps = 4) {
  const el = separator();
  fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
  for (let i = 1; i <= steps; i++) {
    fireEvent.pointerMove(el, { clientX: (dx * i) / steps, clientY: 0, pointerId: 1 });
  }
  fireEvent.pointerUp(el, { clientX: dx, clientY: 0, pointerId: 1 });
}

describe("Splitter", () => {
  it("暴露符合 ARIA Window Splitter 模式的属性", () => {
    render(<Harness />);
    const el = separator();

    // 用原生断言而非 jest-dom 的 toHaveAttribute：只为一个 matcher 引入一个依赖不划算
    expect(el.getAttribute("aria-orientation")).toBe("vertical");
    expect(el.getAttribute("aria-valuenow")).toBe(String(DEFAULT));
    expect(el.getAttribute("aria-valuemin")).toBe(String(MIN));
    expect(el.getAttribute("aria-valuemax")).toBe(String(MAX));
    expect(el.getAttribute("aria-label")).toBe("调整宽度");
    // 不可聚焦的分割条对键盘用户等于锁死布局
    expect(el.tabIndex).toBe(0);
  });

  /**
   * 回归测试：拖动状态最初用 useState 保存，导致按下后**同一帧内**到达的
   * pointermove 读到的仍是旧值 false，那批位移被静默丢弃——
   * 表现为「按下后猛地一拖，前半程没跟上」。修复方式是改用 ref。
   */
  it("按下后立即移动（同一帧内）也能跟手", () => {
    render(<Harness />);
    const el = separator();

    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 0, pointerId: 1 });

    expect(currentValue()).toBe(DEFAULT + 50);
  });

  it("按位移量改变数值", () => {
    render(<Harness />);
    drag(120);
    expect(currentValue()).toBe(DEFAULT + 120);
  });

  it("超出上下限时收敛到边界", () => {
    render(<Harness />);

    drag(999);
    expect(currentValue()).toBe(MAX);

    drag(-999);
    expect(currentValue()).toBe(MIN);
  });

  it("抬起指针后继续移动不再改变数值", () => {
    render(<Harness />);
    drag(60);
    const settled = currentValue();

    fireEvent.pointerMove(separator(), { clientX: 500, clientY: 0, pointerId: 1 });
    expect(currentValue()).toBe(settled);
  });

  it("指针事件被取消时结束拖动", () => {
    render(<Harness />);
    const el = separator();

    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 30, clientY: 0, pointerId: 1 });
    fireEvent.pointerCancel(el, { clientX: 30, clientY: 0, pointerId: 1 });
    const settled = currentValue();

    fireEvent.pointerMove(el, { clientX: 300, clientY: 0, pointerId: 1 });
    expect(currentValue()).toBe(settled);
  });

  it("忽略非主键按下", () => {
    render(<Harness />);
    const el = separator();

    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1, button: 2 });
    fireEvent.pointerMove(el, { clientX: 80, clientY: 0, pointerId: 1 });

    expect(currentValue()).toBe(DEFAULT);
  });

  it("方向键按步长调整，Shift 加速", () => {
    render(<Harness />);
    const el = separator();

    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(currentValue()).toBe(DEFAULT + 8);

    fireEvent.keyDown(el, { key: "ArrowLeft" });
    expect(currentValue()).toBe(DEFAULT);

    fireEvent.keyDown(el, { key: "ArrowRight", shiftKey: true });
    expect(currentValue()).toBe(DEFAULT + 48);
  });

  it("Home / End 跳到边界", () => {
    render(<Harness />);
    const el = separator();

    fireEvent.keyDown(el, { key: "Home" });
    expect(currentValue()).toBe(MIN);

    fireEvent.keyDown(el, { key: "End" });
    expect(currentValue()).toBe(MAX);
  });

  it("双击与 Enter 都能恢复默认值", () => {
    render(<Harness initial={MAX} />);
    const el = separator();

    fireEvent.doubleClick(el);
    expect(currentValue()).toBe(DEFAULT);

    fireEvent.keyDown(el, { key: "End" });
    fireEvent.keyDown(el, { key: "Enter" });
    expect(currentValue()).toBe(DEFAULT);
  });

  it("横向分割条响应上下方向键而非左右", () => {
    function VerticalHarness() {
      const [value, setValue] = useState(DEFAULT);
      return (
        <>
          <Splitter
            orientation="horizontal"
            label="调整高度"
            value={value}
            min={MIN}
            max={MAX}
            onChange={setValue}
          />
          <output data-testid="value">{value}</output>
        </>
      );
    }
    render(<VerticalHarness />);
    const el = separator();

    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(currentValue()).toBe(DEFAULT);

    fireEvent.keyDown(el, { key: "ArrowDown" });
    expect(currentValue()).toBe(DEFAULT + 8);
  });

  it("横向分割条按纵向位移拖动", () => {
    function VerticalHarness() {
      const [value, setValue] = useState(DEFAULT);
      return (
        <>
          <Splitter
            orientation="horizontal"
            label="调整高度"
            value={value}
            min={MIN}
            max={MAX}
            onChange={setValue}
          />
          <output data-testid="value">{value}</output>
        </>
      );
    }
    render(<VerticalHarness />);
    const el = separator();

    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 200, clientY: 40, pointerId: 1 });

    expect(currentValue()).toBe(DEFAULT + 40);
  });
});
