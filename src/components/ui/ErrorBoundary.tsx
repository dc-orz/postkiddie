import { RotateCcw, TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/Button";

/**
 * 错误边界。
 *
 * 存在的理由来自一次真实事故：`EnvironmentDialog` 因为一个字段是 undefined
 * 抛了 TypeError，React 卸掉整棵子树，用户看到的是「点开环境管理是一片黑」——
 * 一个完全无从下手的现象，日志不翻到就永远猜不出发生了什么。
 *
 * 有了边界，同样的崩溃会变成一块写着出了什么错的区域，且**范围可控**：
 * 弹框各自包一层，炸掉的就只是那个弹框，主界面照常可用。
 *
 * 必须是 class 组件——React 19 仍然只在 class 上提供 componentDidCatch。
 * 注意它捕获不到事件处理器、异步回调、SSR 里抛出的错误，那些仍需各自 try/catch。
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 出错时显示在标题里的位置名，如「环境管理」。缺省用通用文案。 */
  label?: string;
  /** 重置时机：这个值变化会清掉错误态，通常传弹框的 open 或当前选中项 id */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    // 关掉再打开、或切到另一个对象时应当重新尝试渲染，
    // 否则一次偶发错误会把这块区域永久钉死在错误态
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // 保留组件栈：只看 error.stack 往往只能定位到 React 内部，看不出是哪个组件
    console.error(`[${this.props.label ?? "界面"}] 渲染出错`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 py-12">
        <TriangleAlert size={22} strokeWidth={1.75} className="text-danger" />

        <div className="max-w-md text-center">
          <p className="text-sm text-fg">
            {this.props.label ? `${this.props.label}出错了` : "这块区域出错了"}
          </p>
          {/* 原始信息照实显示：使用者多半也是开发者，一句「出错了」帮不上任何忙 */}
          <p className="pk-selectable mt-1 font-mono text-xs break-words text-fg-muted">
            {error.message}
          </p>
        </div>

        <Button size="sm" onClick={() => this.setState({ error: null })}>
          <RotateCcw size={11} strokeWidth={2} />
          重试
        </Button>
      </div>
    );
  }
}
