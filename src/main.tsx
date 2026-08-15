import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/App";
import { initUiScale } from "@/stores/settings";
import { initTheme } from "@/stores/theme";
import "@/styles/global.css";

// 在 React 挂载前落定主题与缩放，避免首帧闪一下默认配色、或按默认字号排完版再跳一次
initTheme();
initUiScale();

const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到 #root 挂载点，index.html 可能被改动");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
