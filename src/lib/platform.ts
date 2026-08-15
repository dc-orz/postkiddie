/**
 * 平台判定。
 *
 * 用 userAgent 而非 `@tauri-apps/plugin-os`：只需要区分「是不是 macOS」这一件事，
 * 为此多引一个插件（以及它的权限声明与异步初始化）不划算。
 * WebView 的 UA 在三端都稳定包含平台标识，判定足够可靠。
 *
 * 注意这是同步常量：窗口装饰的让位边距要在首帧就正确，
 * 异步拿平台会导致标题栏先画错再跳一下。
 */

const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

/**
 * macOS 下窗口用 `titleBarStyle: "Overlay"`，原生红绿灯按钮悬浮在内容之上，
 * 自绘标题栏必须在左侧让出空位；Windows/Linux 的窗口按钮在右侧且有原生标题栏，
 * 让位反而会让内容莫名其妙地偏移。
 */
export const isMacOS = /Mac|iPhone|iPad/i.test(ua);

/** 修饰键的显示符号。逻辑上两个键都接受，这里只决定提示文案怎么写。 */
export const MOD_KEY_LABEL = isMacOS ? "⌘" : "Ctrl+";

/** 拼一个快捷键提示，如 `⌘S` / `Ctrl+S` */
export function shortcut(key: string): string {
  return `${MOD_KEY_LABEL}${key}`;
}
