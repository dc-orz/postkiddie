import { FilePlus2, FolderPlus, Inbox, RefreshCw } from "lucide-react";
import { useState } from "react";

import { GitPanel } from "@/components/git/GitPanel";
import { CollectionTree, type DropPosition } from "@/components/sidebar/CollectionTree";
import { Splitter } from "@/components/ui/Splitter";
import { cn } from "@/lib/cn";
import { showError } from "@/lib/dialog";
import { isNoopMove, resolveDropTarget } from "@/lib/tree-move";
import { useElementSize } from "@/lib/use-element-size";
import { useGitFileStates } from "@/stores/git";
import { GIT_PANEL_MIN, TREE_MIN, useLayout } from "@/stores/layout";
import { useRequest } from "@/stores/request";
import { useWorkspace } from "@/stores/workspace";

/**
 * 从请求 id 推出它所在的目录。
 * 新建时以此作为落点——用户多半想把新请求放在刚才那个请求旁边。
 */
function parentDirOf(id: string | null): string | null {
  if (!id) return null;
  const slash = id.lastIndexOf("/");
  return slash > 0 ? id.slice(0, slash) : null;
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex size-6 items-center justify-center rounded-sm text-fg-muted",
        "transition-colors duration-fast hover:bg-hover hover:text-fg",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export function Sidebar() {
  const tree = useWorkspace((s) => s.tree);
  const refresh = useWorkspace((s) => s.refresh);
  const createRequest = useWorkspace((s) => s.createRequest);
  const createFolder = useWorkspace((s) => s.createFolder);
  const renameRequest = useWorkspace((s) => s.renameRequest);
  const moveRequest = useWorkspace((s) => s.moveRequest);

  const selectedId = useRequest((s) => s.id);
  const select = useRequest((s) => s.select);
  const gitStates = useGitFileStates();

  const gitPanelOpen = useLayout((s) => s.gitPanelOpen);
  const gitPanelHeight = useLayout((s) => s.gitPanelHeight);
  const setGitPanelHeight = useLayout((s) => s.setGitPanelHeight);
  const resetGitPanelHeight = useLayout((s) => s.resetGitPanelHeight);

  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const [refreshing, setRefreshing] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // 分割条按「上方（集合树）的高度」工作，因此这里做一次换算：
  // 向下拖 → 树变高 → git 面板变矮，与手上的方向一致。
  const available = Math.max(size.height, GIT_PANEL_MIN + TREE_MIN);
  const treeHeight = available - gitPanelHeight;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      // 转一整圈再停，否则本地目录扫得太快，图标只闪一下反而像没反应
      window.setTimeout(() => setRefreshing(false), 300);
    }
  }

  async function handleCreateRequest() {
    try {
      // 用默认名建好就选中，让用户直接在编辑区改名——
      // 建之前先弹框问名字，是多一道没必要的门槛
      const id = await createRequest(parentDirOf(selectedId), "新建请求");
      await select(id);
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "新建请求失败");
    }
  }

  async function handleRename(id: string, name: string) {
    setRenamingId(null);
    try {
      const newId = await renameRequest(id, name);
      // 文件名变了 = id 变了，当前打开的那个要跟着切过去，否则会指向一个已不存在的路径
      if (selectedId === id) await select(newId);
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "重命名失败");
    }
  }

  async function handleMove(sourceId: string, targetId: string, position: DropPosition) {
    const target = resolveDropTarget(tree, sourceId, targetId, position);
    // 原地放下就什么都别做，免得平白产生一次 _folder.yaml 的改动
    if (!target || isNoopMove(tree, sourceId, target)) return;

    try {
      const newId = await moveRequest(sourceId, target.parent, target.index);
      // 跨目录后 id 变了，当前打开的那个要跟着切过去
      if (selectedId === sourceId) await select(newId);
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "移动失败");
    }
  }

  async function handleCreateFolder() {
    try {
      await createFolder(parentDirOf(selectedId), "新建文件夹");
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "新建文件夹失败");
    }
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-toolbar shrink-0 items-center gap-0.5 border-b border-line-subtle px-2 pl-3">
          <span className="flex-1 text-xs font-medium tracking-wide text-fg-muted">集合</span>

          <ToolbarButton label="新建请求" onClick={() => void handleCreateRequest()}>
            <FilePlus2 size={13} strokeWidth={1.75} />
          </ToolbarButton>
          <ToolbarButton label="新建文件夹" onClick={() => void handleCreateFolder()}>
            <FolderPlus size={13} strokeWidth={1.75} />
          </ToolbarButton>
          <ToolbarButton
            label="重新扫描"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            <RefreshCw size={12} strokeWidth={2} className={cn(refreshing && "animate-spin")} />
          </ToolbarButton>
        </div>

        <nav className="min-h-0 flex-1 overflow-auto">
          {tree.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <Inbox size={22} strokeWidth={1.25} className="text-fg-subtle" />
              <p className="text-xs text-fg-muted">还没有请求</p>
              <button
                type="button"
                onClick={() => void handleCreateRequest()}
                className="text-xs text-fg-link hover:underline"
              >
                新建第一个请求
              </button>
            </div>
          ) : (
            <CollectionTree
              nodes={tree}
              gitStates={gitStates}
              selectedId={selectedId}
              onSelect={(id) => void select(id)}
              renamingId={renamingId}
              onRenameStart={setRenamingId}
              onRenameCommit={(id, name) => void handleRename(id, name)}
              onRenameCancel={() => setRenamingId(null)}
              onMove={(source, target, position) => void handleMove(source, target, position)}
            />
          )}
        </nav>
      </div>

      {gitPanelOpen ? (
        <>
          <Splitter
            orientation="horizontal"
            label="调整 Git 面板高度"
            value={treeHeight}
            min={TREE_MIN}
            max={available - GIT_PANEL_MIN}
            onChange={(nextTreeHeight) => setGitPanelHeight(available - nextTreeHeight)}
            onReset={resetGitPanelHeight}
          />
          <div
            style={{ height: Math.min(gitPanelHeight, available - TREE_MIN) }}
            className="min-h-0 shrink-0"
          >
            <GitPanel />
          </div>
        </>
      ) : null}
    </div>
  );
}
