import { Braces, ChevronDown, Cookie, History, Layers, Settings } from "lucide-react";
import { useState } from "react";

import { CookieDialog } from "@/components/cookie/CookieDialog";
import { EnvironmentDialog } from "@/components/environment/EnvironmentDialog";
import { HistoryDialog } from "@/components/history/HistoryDialog";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { cn } from "@/lib/cn";
import { isMacOS } from "@/lib/platform";
import { useWorkspace } from "@/stores/workspace";

/**
 * 自定义标题栏。
 *
 * 左边距按平台区分：macOS 用 `titleBarStyle: "Overlay"`，原生红绿灯悬浮在内容之上，
 * 必须留出约 80px 让位；Windows/Linux 的窗口按钮在右侧且保留原生标题栏，
 * 同样留白只会让内容平白偏移一大块。
 *
 * 只放高频操作：环境切换每天要用很多次，主题与缩放一年调不了几回，
 * 后者收进设置弹框，标题栏才不至于被一排图标塞满。
 */
export function TitleBar() {
  const environments = useWorkspace((s) => s.environments);
  const activeEnvironment = useWorkspace((s) => s.activeEnvironment);
  const setActiveEnvironment = useWorkspace((s) => s.setActiveEnvironment);

  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [cookieDialogOpen, setCookieDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
      <header
        className={cn(
          "pk-drag-region flex h-titlebar shrink-0 items-center gap-3",
          "border-b border-line-subtle bg-surface pr-2",
          isMacOS ? "pl-20" : "pl-3",
        )}
      >
        <WorkspaceSwitcher />

        <div className="flex-1" />

        {/* 环境选择器：用原生 select，键盘操作与系统观感都是免费的 */}
        <div
          className={cn(
            "pk-no-drag relative flex h-control-sm items-center rounded-md border border-line",
            "text-xs text-fg-secondary transition-colors duration-fast hover:border-line-strong",
            environments.length === 0 && "opacity-50",
          )}
        >
          <Layers size={11} strokeWidth={2} className="ml-2 shrink-0 text-fg-muted" />
          <select
            aria-label="选择环境"
            value={activeEnvironment ?? ""}
            disabled={environments.length === 0}
            onChange={(e) => setActiveEnvironment(e.target.value || null)}
            className="h-full cursor-default appearance-none bg-transparent pr-5 pl-1.5 outline-none"
          >
            {environments.length === 0 ? (
              <option value="">无环境</option>
            ) : (
              <>
                <option value="">不使用环境</option>
                {environments.map((env) => (
                  <option key={env.name} value={env.name}>
                    {env.name}
                  </option>
                ))}
              </>
            )}
          </select>
          <ChevronDown
            size={11}
            strokeWidth={2}
            className="pointer-events-none absolute right-1.5 text-fg-muted"
          />
        </div>

        <IconButton label="管理环境与密钥" icon={Braces} onClick={() => setEnvDialogOpen(true)} />
        <IconButton
          label="Cookie 与登录态"
          icon={Cookie}
          onClick={() => setCookieDialogOpen(true)}
        />
        <IconButton label="请求历史" icon={History} onClick={() => setHistoryOpen(true)} />
        <IconButton label="设置" icon={Settings} onClick={() => setSettingsOpen(true)} />
      </header>

      {/*
        弹框必须留在 <header> 外面。
        `-webkit-app-region: drag` 会作用到元素的全部后代，而 showModal() 只把
        dialog 提到 top layer，并不改变它在 DOM 里的归属——写在 header 里，
        整个弹框就成了窗口拖拽区：按下去是在拖窗口，点不动按钮也聚焦不了输入框。
        它们是浮层，本来也不属于标题栏。
      */}
      <EnvironmentDialog open={envDialogOpen} onClose={() => setEnvDialogOpen(false)} />
      <CookieDialog open={cookieDialogOpen} onClose={() => setCookieDialogOpen(false)} />
      <HistoryDialog open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Cookie;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "pk-no-drag flex size-control-sm items-center justify-center rounded-md border border-line",
        "text-fg-muted transition-colors duration-fast hover:bg-hover hover:text-fg",
      )}
    >
      <Icon size={12} strokeWidth={2} />
    </button>
  );
}
