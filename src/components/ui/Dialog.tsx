import { type ReactNode, useEffect, useRef } from "react";

import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { cn } from "@/lib/cn";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** 弹框名，用于读屏标注与出错时的提示文案 */
  label: string;
  /** 只用来指定宽度，其余外观由 `.pk-dialog` 统一负责 */
  className?: string;
  children: ReactNode;
}

/**
 * 模态弹框的外壳。
 *
 * 用原生 `<dialog>` + `showModal()`：焦点陷阱、ESC 关闭、背景 inert 化
 * 都是浏览器免费给的，自绘弹层容易漏掉这些可访问性细节。
 *
 * 外壳与内容分离是为了错误隔离，不只是消除重复。
 * ErrorBoundary 若包在 `<dialog>` 外面，一旦内容崩溃，整个 dialog 元素
 * 连同它的 top layer 状态一起被卸载，fallback 渲染成一个普通 div——
 * 用户仍然什么都看不到。只有外壳活着、内容被替换，报错信息才显示得出来。
 */
export function Dialog({ open, onClose, label, className, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // 原生 dialog 的开合只能靠命令式 API，用 effect 把它同步到受控的 open
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: onClick 只处理「点遮罩关闭」，键盘侧由原生 dialog 的 ESC 承担（触发 onClose）
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => {
        // 点在 dialog 元素本身 = 点在遮罩上；点内容会命中子元素
        if (e.target === ref.current) onClose();
      }}
      className={cn("pk-dialog", className)}
    >
      {/* resetKey 取 open：关掉再打开应当重新尝试渲染，
          否则一次偶发错误会把这个弹框永久钉死在错误态 */}
      <ErrorBoundary label={label} resetKey={open}>
        {children}
      </ErrorBoundary>
    </dialog>
  );
}
