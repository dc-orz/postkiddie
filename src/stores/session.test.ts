import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSession } from "./session";

vi.mock("@/lib/ipc", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ipc")>("@/lib/ipc");
  return {
    ...actual,
    workspace: { open: vi.fn(), init: vi.fn(), tree: vi.fn(), environments: vi.fn() },
    request: { read: vi.fn(), save: vi.fn() },
    git: { status: vi.fn() },
  };
});

import { useGit } from "./git";
import { useRequest } from "./request";
import { useWorkspace } from "./workspace";

/**
 * 换工作区必须连带作废请求与 git 状态。
 *
 * 这条联动值得测，是因为它出错的方式是**静默**的：界面上一切正常，
 * 只有编辑区里躺着的还是上一个工作区的请求——而请求的 id 是相对路径，
 * 保存下去就会写到新工作区里同名（或不存在）的位置。
 */
describe("工作区切换的跨 store 清理", () => {
  const workspace = (root: string) => ({ root, name: "ws", repoRoot: root });

  beforeEach(() => {
    useWorkspace.setState({ info: null, tree: [], environments: [] });
    useRequest.getState().close();
    useGit.getState().reset();
  });

  it("首次打开不做清理", () => {
    initSession();

    useRequest.setState({ id: "collections/a.yaml" });
    useWorkspace.setState({ info: workspace("/tmp/one") });

    // 首次打开时用户不可能有「上一个工作区的请求」，这里的 id 是测试自己塞的，
    // 断言它没被动过即可确认清理确实只在**切换**时发生
    expect(useRequest.getState().id).toBe("collections/a.yaml");
  });

  it("换到另一个工作区时清掉请求与 git 状态", () => {
    initSession();

    useWorkspace.setState({ info: workspace("/tmp/one") });
    useRequest.setState({ id: "collections/a.yaml", draft: null, saved: null });
    useGit.setState({
      status: {
        branch: "main",
        upstream: null,
        ahead: 0,
        behind: 0,
        entries: [],
        hasConflicts: false,
      },
    });

    useWorkspace.setState({ info: workspace("/tmp/two") });

    expect(useRequest.getState().id).toBeNull();
    expect(useGit.getState().status).toBeNull();
  });

  it("重新设置同一个工作区不触发清理", () => {
    initSession();

    useWorkspace.setState({ info: workspace("/tmp/one") });
    useRequest.setState({ id: "collections/a.yaml" });

    // 同一个 root：订阅按值比较，不该认为发生了切换
    useWorkspace.setState({ info: workspace("/tmp/one") });

    expect(useRequest.getState().id).toBe("collections/a.yaml");
  });
});
