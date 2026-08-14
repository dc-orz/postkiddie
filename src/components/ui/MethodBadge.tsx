import { cn } from "@/lib/cn";
import type { HttpMethod } from "@/types/api";

/**
 * HTTP 方法徽章 —— 侧边栏里出现频率最高的元素。
 *
 * 三个刻意的取舍：
 * - 只用文字颜色，不加底色。几十行列表里每行一个色块会非常吵。
 * - 固定宽度 + 右对齐，让不同长度的方法名（GET / OPTIONS）后面的请求名垂直对齐。
 * - 等宽字体 + 加大字距，短全大写文本在小字号下才不会糊成一团。
 */
const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  PATCH: "text-method-patch",
  DELETE: "text-method-delete",
  HEAD: "text-method-head",
  OPTIONS: "text-method-options",
};

/** OPTIONS 有 7 个字符，缩写到 4 字符以内才能保持列宽紧凑 */
const ABBREV: Partial<Record<HttpMethod, string>> = {
  DELETE: "DEL",
  OPTIONS: "OPT",
  PATCH: "PTCH",
};

interface MethodBadgeProps {
  method: HttpMethod;
  className?: string;
}

export function MethodBadge({ method, className }: MethodBadgeProps) {
  return (
    <span
      className={cn(
        "w-[3.25rem] shrink-0 text-right font-mono text-2xs font-semibold tracking-caps",
        METHOD_COLOR[method],
        className,
      )}
      title={method}
    >
      {ABBREV[method] ?? method}
    </span>
  );
}
