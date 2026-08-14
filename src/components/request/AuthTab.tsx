import { useId } from "react";

import { cn } from "@/lib/cn";
import type { Auth } from "@/types/api";

type AuthType = Auth["type"];

const TYPE_LABELS: Record<AuthType, string> = {
  inherit: "继承",
  none: "无",
  basic: "Basic",
  bearer: "Bearer",
  "api-key": "API Key",
};

const TYPES: AuthType[] = ["inherit", "none", "basic", "bearer", "api-key"];

function convert(from: Auth, to: AuthType): Auth {
  switch (to) {
    case "inherit":
      return { type: "inherit" };
    case "none":
      return { type: "none" };
    case "basic":
      return from.type === "basic" ? from : { type: "basic", username: "", password: "" };
    case "bearer":
      return from.type === "bearer" ? from : { type: "bearer", token: "" };
    case "api-key":
      return from.type === "api-key"
        ? from
        : { type: "api-key", key: "", value: "", placement: "header" };
  }
}

const inputClass = cn(
  "h-control-md w-full rounded-md border border-line bg-surface px-2",
  "font-mono text-base outline-none transition-colors duration-fast",
  "focus:border-line-focus placeholder:font-sans placeholder:text-fg-subtle",
);

/**
 * 带标签的表单字段。
 *
 * children 用 render prop 接收生成好的 id：`<label>` 包裹 `<input>` 虽然是合法的
 * 隐式关联，但静态分析看不出来，显式的 htmlFor 对读屏软件也更稳妥。
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
        {label}
      </label>
      {children(id)}
      {hint ? <span className="text-xs text-fg-subtle">{hint}</span> : null}
    </div>
  );
}

interface AuthTabProps {
  auth: Auth;
  onChange: (auth: Auth) => void;
}

export function AuthTab({ auth, onChange }: AuthTabProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex shrink-0 items-center gap-1">
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onChange(convert(auth, type))}
            className={cn(
              "h-control-sm rounded-md px-2 text-xs transition-colors duration-fast",
              auth.type === type
                ? "bg-accent-soft font-medium text-accent-fg"
                : "text-fg-muted hover:bg-hover hover:text-fg",
            )}
          >
            {TYPE_LABELS[type]}
          </button>
        ))}
      </div>

      <div className="max-w-md">
        {auth.type === "inherit" ? (
          <p className="text-sm text-fg-muted">
            沿用上层文件夹或工作区的认证设置。这是最常用的方式——整个集合通常共用一套凭证。
          </p>
        ) : auth.type === "none" ? (
          <p className="text-sm text-fg-muted">不附加任何认证信息，并且不继承上层设置。</p>
        ) : auth.type === "basic" ? (
          <div className="flex flex-col gap-3">
            <Field label="用户名">
              {(id) => (
                <input
                  id={id}
                  value={auth.username}
                  onChange={(e) => onChange({ ...auth, username: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="密码" hint="可以填 {{变量}}，避免把凭证写进 git">
              {(id) => (
                <input
                  id={id}
                  value={auth.password}
                  onChange={(e) => onChange({ ...auth, password: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="{{password}}"
                  className={inputClass}
                />
              )}
            </Field>
          </div>
        ) : auth.type === "bearer" ? (
          <Field label="Token" hint="可以填 {{变量}}，避免把凭证写进 git">
            {(id) => (
              <input
                id={id}
                value={auth.token}
                onChange={(e) => onChange({ ...auth, token: e.target.value })}
                spellCheck={false}
                autoComplete="off"
                placeholder="{{token}}"
                className={inputClass}
              />
            )}
          </Field>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="键名">
              {(id) => (
                <input
                  id={id}
                  value={auth.key}
                  onChange={(e) => onChange({ ...auth, key: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="X-API-Key"
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="值">
              {(id) => (
                <input
                  id={id}
                  value={auth.value}
                  onChange={(e) => onChange({ ...auth, value: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="{{apiKey}}"
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="放置位置">
              {(id) => (
                <div id={id} className="flex gap-1">
                  {(["header", "query"] as const).map((placement) => (
                    <button
                      key={placement}
                      type="button"
                      onClick={() => onChange({ ...auth, placement })}
                      className={cn(
                        "h-control-md rounded-md border px-2.5 text-xs transition-colors duration-fast",
                        auth.placement === placement
                          ? "border-line-accent bg-accent-soft text-accent-fg"
                          : "border-line text-fg-muted hover:bg-hover hover:text-fg",
                      )}
                    >
                      {placement === "header" ? "请求头" : "查询参数"}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}
