import { useEffect } from "react";

import { WelcomeScreen } from "@/components/layout/WelcomeScreen";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useWorkspace } from "@/stores/workspace";
import { Workbench } from "./Workbench";

export function App() {
  const info = useWorkspace((s) => s.info);

  useEffect(() => {
    // 启动时自动重开上次的工作区。失败（目录被删/被移走）就留在欢迎页，
    // 用户在最近列表里仍能看到它并自行处理。
    //
    // 但失败原因必须落到控制台：这里曾经是 `.catch(() => {})`，
    // 于是「后端日志显示工作区已打开、界面却停在欢迎页」这种状况完全无从下手——
    // 静默的 catch 把唯一的线索也丢了。
    const { recent, open } = useWorkspace.getState();
    const last = recent[0];
    if (last) {
      void open(last).catch((error) => {
        console.error("自动打开上次的工作区失败", last, error);
      });
    }
  }, []);

  // 最外层的兜底。弹框各自还有一层（见 ui/Dialog），
  // 那层负责把故障关在弹框里；到这里说明主界面本身塌了，
  // resetKey 取工作区路径，换个工作区等于重来一次。
  return (
    <ErrorBoundary label="PostKiddie" resetKey={info?.root}>
      {info ? <Workbench /> : <WelcomeScreen />}
    </ErrorBoundary>
  );
}
