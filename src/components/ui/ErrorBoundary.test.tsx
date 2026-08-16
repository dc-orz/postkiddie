import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

/**
 * 这些用例覆盖的是一次真实事故：某个字段是 undefined 让弹框组件抛了 TypeError，
 * React 卸掉整棵子树，用户看到一片黑。边界的价值就在于把那种现象变成可读的提示。
 */

function Boom({ explode }: { explode: boolean }): React.ReactNode {
  if (explode) throw new Error("undefined is not an object");
  return <p>正常内容</p>;
}

beforeEach(() => {
  // React 会把边界捕获到的错误再往 console.error 打一份，
  // 静音它才能让测试输出保持干净——不是在掩盖问题，断言仍然照做
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("子树正常时原样渲染", () => {
    render(
      <ErrorBoundary label="环境管理">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("正常内容")).toBeDefined();
  });

  it("子树抛错时显示位置名与原始信息", () => {
    render(
      <ErrorBoundary label="环境管理">
        <Boom explode={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("环境管理出错了")).toBeDefined();
    // 原始 message 必须照实透出：使用者多半也是开发者，一句「出错了」帮不上忙
    expect(screen.getByText("undefined is not an object")).toBeDefined();
  });

  it("没给 label 时用通用文案", () => {
    render(
      <ErrorBoundary>
        <Boom explode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("这块区域出错了")).toBeDefined();
  });

  /** 故障必须关在边界内，否则边界就白加了 */
  it("兄弟节点不受影响", () => {
    render(
      <div>
        <p>主界面还在</p>
        <ErrorBoundary label="环境管理">
          <Boom explode={true} />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText("主界面还在")).toBeDefined();
    expect(screen.getByText("环境管理出错了")).toBeDefined();
  });

  it("点重试后重新渲染子树", () => {
    function Harness() {
      const [explode, setExplode] = useState(true);
      return (
        <div>
          <button type="button" onClick={() => setExplode(false)}>
            修好它
          </button>
          <ErrorBoundary label="环境管理">
            <Boom explode={explode} />
          </ErrorBoundary>
        </div>
      );
    }

    render(<Harness />);
    expect(screen.getByText("环境管理出错了")).toBeDefined();

    // 先消除病因，再重试——否则重试只会立刻再抛一次
    fireEvent.click(screen.getByText("修好它"));
    fireEvent.click(screen.getByText("重试"));

    expect(screen.getByText("正常内容")).toBeDefined();
  });

  /**
   * 回归测试：漏掉 resetKey 的话，弹框一旦出过错就永久钉死在错误态，
   * 关掉再打开还是那句报错，只能重启应用。
   */
  it("resetKey 变化时自动清除错误态", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      const [explode, setExplode] = useState(true);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              setExplode(false);
              setOpen((v) => !v);
            }}
          >
            重开
          </button>
          <ErrorBoundary label="环境管理" resetKey={open}>
            <Boom explode={explode} />
          </ErrorBoundary>
        </div>
      );
    }

    render(<Harness />);
    expect(screen.getByText("环境管理出错了")).toBeDefined();

    fireEvent.click(screen.getByText("重开"));

    expect(screen.getByText("正常内容")).toBeDefined();
  });
});
