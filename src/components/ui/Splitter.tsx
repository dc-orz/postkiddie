import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/cn";

type Orientation = "vertical" | "horizontal";

interface SplitterProps {
  /**
   * 分割条自身的朝向：
   * - `vertical`   竖直的线，左右拖动，调整**左侧**面板宽度
   * - `horizontal` 水平的线，上下拖动，调整**上方**面板高度
   */
  orientation: Orientation;
  /** 受控值（像素） */
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** 双击或按 Enter 时调用；不传则不提供重置 */
  onReset?: () => void;
  /** 无障碍标签，例如「调整侧边栏宽度」 */
  label: string;
  className?: string;
}

const STEP = 8;
const STEP_LARGE = 48;

/**
 * 可拖拽的面板分割条。
 *
 * 自研而非引入 react-resizable-panels：需要的只是「拖动改一个数值」，
 * 而配色、命中区、键盘行为都要贴合本项目的 design token 与交互约定，
 * 适配一个通用库的成本并不比这一百多行低。
 *
 * 三个容易被忽略、但直接决定手感的点：
 *
 * 1. **命中区远大于视觉宽度。** 视觉上是 1px 的细线（简约风格靠边框划分区域），
 *    但实际可抓取宽度 9px，靠负 margin 撑开——布局上仍只占 1px。
 *    只有 1px 命中区的分割条会让人反复对不准。
 *
 * 2. **用 Pointer Capture 而非全局 mousemove 监听。** 指针被捕获后，
 *    即使拖出窗口、或快速划过 iframe / 输入框，事件依然回到分割条，
 *    不会出现「拖到一半断了」。
 *
 * 3. **键盘可达。** `role="separator"` + `tabIndex=0` + 方向键，
 *    这是 ARIA 对窗格分割条的标准约定；只能用鼠标调整的布局对键盘用户等于锁死。
 */
export function Splitter({
  orientation,
  value,
  min,
  max,
  onChange,
  onReset,
  label,
  className,
}: SplitterProps) {
  /**
   * 拖动状态存两份，各司其职：
   * - `draggingRef` 供事件处理器判断，必须同步可读——`setState` 要等下一次渲染才生效，
   *   而按下后同一帧内到达的 pointermove 会读到旧值，那批位移就被静默丢弃了
   *   （表现为「按下后猛地一拖，前半程没跟上」）。
   * - `dragging` state 只驱动视觉反馈，晚一帧无所谓。
   */
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ pointer: 0, value: 0 });

  const isVertical = orientation === "vertical";

  const clamp = useCallback(
    (next: number) => Math.min(max, Math.max(min, Math.round(next))),
    [min, max],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 只响应主键；右键与中键交给系统
    if (event.button !== 0) return;

    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 少数环境（自动化合成事件、部分远程桌面）拿不到捕获。
      // 拖动本身不依赖它，只是失去「拖出元素外仍跟手」的能力，不该因此中断。
    }
    startRef.current = {
      pointer: isVertical ? event.clientX : event.clientY,
      value,
    };
    draggingRef.current = true;
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const current = isVertical ? event.clientX : event.clientY;
    onChange(clamp(startRef.current.value + current - startRef.current.pointer));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draggingRef.current = false;
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP_LARGE : STEP;
    const decrease = isVertical ? "ArrowLeft" : "ArrowUp";
    const increase = isVertical ? "ArrowRight" : "ArrowDown";

    switch (event.key) {
      case decrease:
        onChange(clamp(value - step));
        break;
      case increase:
        onChange(clamp(value + step));
        break;
      case "Home":
        onChange(min);
        break;
      case "End":
        onChange(max);
        break;
      case "Enter":
        onReset?.();
        break;
      default:
        return;
    }
    // 方向键默认会滚动祖先容器，必须拦下
    event.preventDefault();
  };

  // 拖动期间接管全局光标：指针滑过输入框、按钮时不该变成 I 形或手形，
  // 否则会让人以为拖动已经结束。
  useEffect(() => {
    if (!dragging) return;

    const { style } = document.body;
    const previousCursor = style.cursor;
    const previousSelect = style.userSelect;

    style.cursor = isVertical ? "col-resize" : "row-resize";
    style.userSelect = "none";

    return () => {
      style.cursor = previousCursor;
      style.userSelect = previousSelect;
    };
  }, [dragging, isVertical]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> 不可聚焦也不接受指针交互，承载不了拖拽与键盘调整；ARIA Window Splitter 模式规定的正是 role=separator + tabindex + aria-valuenow 这一组合
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={label}
      title={onReset ? `${label}（双击恢复默认）` : label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      className={cn(
        // 需要 z-index：负 margin 让命中区侵入两侧面板，不抬高层级会被后面的兄弟盖住
        "group relative z-(--pk-z-raised) shrink-0 touch-none",
        // 负 margin 把命中区撑到 9px，但布局上仍只占 1px
        isVertical ? "-mx-1 w-[9px] cursor-col-resize" : "-my-1 h-[9px] cursor-row-resize",
        // 焦点环画在内部的线上，画在 9px 的透明区上会显得莫名其妙地粗
        "focus-visible:outline-none",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute bg-line-subtle transition-colors duration-fast",
          isVertical
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
          // hover/拖动/聚焦时线变粗变亮，给出明确的「这里可以拖」信号
          "group-hover:bg-line-strong group-focus-visible:bg-accent",
          dragging && "bg-accent",
          dragging && (isVertical ? "w-0.5" : "h-0.5"),
        )}
      />
    </div>
  );
}
