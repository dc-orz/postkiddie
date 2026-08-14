import { useEffect, useState } from "react";

import { StatusBar } from "@/components/layout/StatusBar";
import { TitleBar } from "@/components/layout/TitleBar";
import { RequestPane } from "@/components/request/RequestPane";
import { ResponsePane } from "@/components/response/ResponsePane";
import { CollectionTree } from "@/components/sidebar/CollectionTree";
import type { FileState, GitStatus, HttpRequest, HttpResponse, TreeNode } from "@/types/api";

/**
 * 骨架界面。
 *
 * 目前使用示例数据驱动，用途是把 design token 与布局尺寸落到真实界面上做验证——
 * 配色、密度、层次是否成立，看这一屏就能判断。接入真实 IPC 时替换掉本文件里的
 * 示例常量与 `useState` 即可，下层组件无需改动。
 */
const DEMO_TREE: TreeNode[] = [
  {
    kind: "folder",
    id: "collections/用户中心",
    name: "用户中心",
    children: [
      {
        kind: "request",
        id: "collections/用户中心/登录.yaml",
        name: "登录",
        method: "POST",
        url: "{{baseUrl}}/auth/login",
      },
      {
        kind: "request",
        id: "collections/用户中心/查询资料.yaml",
        name: "查询资料",
        method: "GET",
        url: "{{baseUrl}}/users/{{userId}}",
      },
      {
        kind: "request",
        id: "collections/用户中心/更新头像.yaml",
        name: "更新头像",
        method: "PATCH",
        url: "{{baseUrl}}/users/{{userId}}/avatar",
      },
      {
        kind: "request",
        id: "collections/用户中心/注销.yaml",
        name: "注销账号",
        method: "DELETE",
        url: "{{baseUrl}}/users/{{userId}}",
      },
    ],
  },
  {
    kind: "folder",
    id: "collections/订单",
    name: "订单",
    children: [
      {
        kind: "request",
        id: "collections/订单/创建订单.yaml",
        name: "创建订单",
        method: "POST",
        url: "{{baseUrl}}/orders",
      },
      {
        kind: "request",
        id: "collections/订单/订单列表.yaml",
        name: "订单列表",
        method: "GET",
        url: "{{baseUrl}}/orders",
      },
      {
        kind: "request",
        id: "collections/订单/健康检查.yaml",
        name: "健康检查",
        method: "HEAD",
        url: "{{baseUrl}}/healthz",
      },
    ],
  },
];

const DEMO_GIT_STATES: Record<string, FileState> = {
  "collections/用户中心/登录.yaml": "modified",
  "collections/订单/创建订单.yaml": "added",
  "collections/订单/健康检查.yaml": "untracked",
};

const DEMO_STATUS: GitStatus = {
  branch: "feature/order-api",
  upstream: "origin/feature/order-api",
  ahead: 2,
  behind: 1,
  entries: [],
  hasConflicts: false,
};

const DEMO_REQUEST: HttpRequest = {
  name: "登录",
  method: "POST",
  url: "{{baseUrl}}/auth/login",
};

const DEMO_RESPONSE: HttpResponse = {
  status: 200,
  statusText: "OK",
  finalUrl: "http://localhost:8080/auth/login",
  headers: [{ name: "content-type", value: "application/json", enabled: true }],
  body: {
    kind: "text",
    content: `{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 7200,
  "user": {
    "id": 1024,
    "name": "kiddie",
    "roles": ["admin"]
  }
}`,
  },
  sizeBytes: 186,
  elapsedMs: 42,
};

export function App() {
  const [selectedId, setSelectedId] = useState<string | null>("collections/用户中心/登录.yaml");
  const [request, setRequest] = useState<HttpRequest>(DEMO_REQUEST);
  const [response, setResponse] = useState<HttpResponse | null>(DEMO_RESPONSE);
  const [sending, setSending] = useState(false);

  // 窗口以 visible:false 启动，等首帧渲染完成再显示，避免出现白屏一闪
  useEffect(() => {
    void showWindow();
  }, []);

  const handleSend = () => {
    setSending(true);
    // 真实实现见 src/lib/ipc.ts 的 request.send
    window.setTimeout(() => {
      setResponse(DEMO_RESPONSE);
      setSending(false);
    }, 300);
  };

  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <TitleBar environment="本地开发" />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-sidebar shrink-0 flex-col border-r border-line-subtle bg-surface">
          <div className="flex h-toolbar shrink-0 items-center border-b border-line-subtle px-3">
            <span className="text-xs font-medium tracking-wide text-fg-muted">集合</span>
          </div>
          <nav className="min-h-0 flex-1 overflow-auto">
            <CollectionTree
              nodes={DEMO_TREE}
              gitStates={DEMO_GIT_STATES}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </nav>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
          <RequestPane
            request={request}
            sending={sending}
            onChange={(patch) => setRequest((prev) => ({ ...prev, ...patch }))}
            onSend={handleSend}
          />
          <ResponsePane response={response} />
        </main>
      </div>

      <StatusBar status={DEMO_STATUS} dirtyCount={3} />
    </div>
  );
}

/** 在浏览器里跑 `pnpm dev` 时没有 Tauri 运行时，静默跳过即可 */
async function showWindow(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().show();
  } catch {
    // 非 Tauri 环境，忽略
  }
}
