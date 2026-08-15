import { ShieldAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import type { RequestSettings } from "@/types/api";

/** 与 Rust 侧 `RequestSettings::default()` 保持一致 */
export const DEFAULT_SETTINGS: RequestSettings = {
  timeoutMs: 30_000,
  followRedirects: true,
  maxRedirects: 10,
  verifyTls: true,
  decompress: true,
  sendCookies: true,
};

function Row({
  label,
  hint,
  children,
  danger,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-subtle py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className={cn("text-sm", danger ? "text-danger" : "text-fg")}>{label}</div>
        {hint ? <p className="mt-0.5 text-xs text-fg-muted">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  // 不加 role="switch"：原生 checkbox 本就带选中状态语义，
  // 覆盖 role 反而要求自行维护 aria-checked，多一处可能不同步的状态
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 cursor-default accent-[var(--pk-accent-bg)]"
    />
  );
}

interface SettingsTabProps {
  settings: RequestSettings;
  onChange: (settings: RequestSettings) => void;
}

export function SettingsTab({ settings, onChange }: SettingsTabProps) {
  const patch = (part: Partial<RequestSettings>) => onChange({ ...settings, ...part });

  const numberInput = cn(
    "pk-tnum h-control-md w-24 rounded-md border border-line bg-surface px-2 text-right",
    "font-mono text-base outline-none transition-colors duration-fast focus:border-line-focus",
  );

  return (
    <div className="max-w-xl p-3">
      <Row label="超时" hint="毫秒。填 0 表示不限时。">
        <input
          type="number"
          min={0}
          step={1000}
          value={settings.timeoutMs}
          onChange={(e) => patch({ timeoutMs: Math.max(0, Number(e.target.value) || 0) })}
          aria-label="超时毫秒数"
          className={numberInput}
        />
      </Row>

      <Row label="跟随重定向" hint="关闭后可以直接看到 3xx 响应与 Location 头。">
        <Toggle
          label="跟随重定向"
          checked={settings.followRedirects}
          onChange={(followRedirects) => patch({ followRedirects })}
        />
      </Row>

      {settings.followRedirects ? (
        <Row label="最大重定向次数">
          <input
            type="number"
            min={1}
            max={50}
            value={settings.maxRedirects}
            onChange={(e) =>
              patch({ maxRedirects: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })
            }
            aria-label="最大重定向次数"
            className={numberInput}
          />
        </Row>
      ) : null}

      <Row
        label="校验 TLS 证书"
        danger={!settings.verifyTls}
        hint={
          settings.verifyTls
            ? "使用系统根证书链校验，企业内网的自签 CA 装在钥匙串里即可生效。"
            : "已关闭校验，连接可能被中间人窃听。仅在调试自签名证书的内网服务时临时关闭。"
        }
      >
        <div className="flex items-center gap-1.5">
          {settings.verifyTls ? null : (
            <ShieldAlert size={13} strokeWidth={2} className="text-danger" />
          )}
          <Toggle
            label="校验 TLS 证书"
            checked={settings.verifyTls}
            onChange={(verifyTls) => patch({ verifyTls })}
          />
        </div>
      </Row>

      <Row label="自动解压响应" hint="关闭后不声明 Accept-Encoding，可观察服务端返回的原始字节。">
        <Toggle
          label="自动解压响应"
          checked={settings.decompress}
          onChange={(decompress) => patch({ decompress })}
        />
      </Row>

      <Row
        label="携带 Cookie"
        hint="关闭后既不附带已保存的 Cookie，也不保存响应返回的 Cookie——用于以未登录身份做对照。"
      >
        <Toggle
          label="携带 Cookie"
          checked={settings.sendCookies}
          onChange={(sendCookies) => patch({ sendCookies })}
        />
      </Row>
    </div>
  );
}
