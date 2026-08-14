import { type RefObject, useLayoutEffect, useRef, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * 观测元素的实际尺寸。
 *
 * 分割栏需要它把「像素尺寸」换算成相对容器的可用范围——例如请求区最多能拖到多高，
 * 取决于容器当前高度减去响应区的最小高度。窗口缩放时这个上限要跟着变，
 * 所以必须用 ResizeObserver 而不是只在挂载时量一次。
 */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, ElementSize] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    // 先同步量一次，避免首帧拿到 0 导致分割栏位置跳一下
    const rect = element.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const box = entry.contentRect;
      setSize((prev) =>
        prev.width === box.width && prev.height === box.height
          ? prev
          : { width: box.width, height: box.height },
      );
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
