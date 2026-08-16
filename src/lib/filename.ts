/**
 * 从响应推断另存为的默认文件名。
 *
 * 抽成纯函数是因为规则琐碎又容易错（查询串、末尾斜杠、已有扩展名……），
 * 而它完全不依赖 DOM，值得直接单测覆盖。
 */

/** content-type 到扩展名。只列常见的，认不出就不猜。 */
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/gzip": "gz",
  "application/octet-stream": "bin",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
};

/** 取 content-type 的主体部分，丢掉 `; charset=...` 之类的参数 */
export function mimeOf(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isImage(contentType: string | undefined): boolean {
  return mimeOf(contentType).startsWith("image/");
}

export function isPdf(contentType: string | undefined): boolean {
  return mimeOf(contentType) === "application/pdf";
}

/**
 * 推断默认文件名。
 *
 * 优先用 URL 末段——它通常就是服务端给这份资源起的名字，比任何猜测都准。
 * 拿不到（根路径、纯查询串接口）时退回 `response`，再按 content-type 补扩展名。
 */
export function suggestFileName(url: string, contentType?: string): string {
  let base = "";

  try {
    // 相对 URL 也要能处理，给个 base 兜底
    const parsed = new URL(url, "http://localhost");
    // 末尾斜杠会让 pop() 取到空串，先去掉
    const segments = parsed.pathname.replace(/\/+$/, "").split("/");
    base = decodeURIComponent(segments[segments.length - 1] ?? "");
  } catch {
    // URL 完全不可解析时不抛，另存为不该因为文件名推断而失败
  }

  if (!base) base = "response";

  // 已经带扩展名就别再加一个。只认末段短后缀，避免把 `v1.2` 这类版本号当扩展名。
  if (/\.[a-z0-9]{1,5}$/i.test(base)) return base;

  const ext = EXTENSIONS[mimeOf(contentType)];
  return ext ? `${base}.${ext}` : base;
}
