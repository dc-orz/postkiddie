import { useEffect } from "react";

import { WelcomeScreen } from "@/components/layout/WelcomeScreen";
import { useWorkspace } from "@/stores/workspace";
import { Workbench } from "./Workbench";

export function App() {
  const info = useWorkspace((s) => s.info);

  useEffect(() => {
    // 启动时自动重开上次的工作区。失败（目录被删/被移走）就静默留在欢迎页，
    // 用户在最近列表里仍能看到它并自行处理。
    const { recent, open } = useWorkspace.getState();
    const last = recent[0];
    if (last) {
      void open(last).catch(() => {});
    }
  }, []);

  return info ? <Workbench /> : <WelcomeScreen />;
}
