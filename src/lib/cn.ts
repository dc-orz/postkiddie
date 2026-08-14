import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 className：先用 clsx 处理条件表达式，再用 tailwind-merge 消除冲突。
 *
 * 后者解决的是 `cn("p-2", props.className)` 里调用方传 `p-4` 时两个类同时存在、
 * 结果取决于 CSS 出现顺序的问题——合并后只保留后者。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
