import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";

/**
 * 系统原生对话框。
 *
 * 用原生而非自绘弹窗：选目录必须走系统文件选择器（WebView 拿不到真实路径），
 * 确认/提示框顺带也用原生，观感与平台一致且无需处理焦点陷阱。
 */

/** 打开目录选择器。用户取消时返回 null。 */
export async function pickDirectory(title: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

/** 打开文件选择器。不传 filters 表示接受任意文件。用户取消时返回 null。 */
export async function pickFile(
  title: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  const selected = await open(
    filters ? { multiple: false, title, filters } : { multiple: false, title },
  );
  return typeof selected === "string" ? selected : null;
}

/** 打开保存对话框，返回用户选定的路径；取消时返回 null。 */
export async function pickSavePath(defaultName: string): Promise<string | null> {
  return save({ defaultPath: defaultName });
}

/** 破坏性或有副作用的操作前的确认框 */
export async function confirmAction(
  text: string,
  options: { title: string; okLabel?: string },
): Promise<boolean> {
  return confirm(text, {
    title: options.title,
    kind: "warning",
    okLabel: options.okLabel ?? "继续",
    cancelLabel: "取消",
  });
}

/** 中性的完成提示。与 showError 分开是为了拿到系统对话框的正确图标与音效。 */
export async function showMessage(text: string, title: string): Promise<void> {
  await message(text, { title, kind: "info" });
}

export async function showError(text: string, title = "出错了"): Promise<void> {
  await message(text, { title, kind: "error" });
}
