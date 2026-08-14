import { cn } from "@/lib/cn";

/** 按状态码首位取语义色，与 tokens.css 中的 `--pk-status-*` 一一对应 */
function statusColor(status: number): string {
  if (status >= 500) return "text-status-5xx";
  if (status >= 400) return "text-status-4xx";
  if (status >= 300) return "text-status-3xx";
  if (status >= 200) return "text-status-2xx";
  return "text-status-1xx";
}

interface StatusBadgeProps {
  status: number;
  statusText?: string;
  className?: string;
}

export function StatusBadge({ status, statusText, className }: StatusBadgeProps) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span className={cn("pk-tnum font-mono text-sm font-semibold", statusColor(status))}>
        {status}
      </span>
      {statusText ? <span className="text-xs text-fg-muted">{statusText}</span> : null}
    </span>
  );
}

/**
 * 耗时 / 体积等指标。用等宽数字（pk-tnum），
 * 否则连续请求时数字宽度变化会让整行左右跳动。
 */
export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-xs text-fg-muted">
      <span>{label}</span>
      <span className="pk-tnum font-mono text-fg-secondary">{value}</span>
    </span>
  );
}
