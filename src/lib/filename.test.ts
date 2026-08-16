import { describe, expect, it } from "vitest";
import { isImage, isPdf, mimeOf, suggestFileName } from "./filename";

describe("mimeOf", () => {
  it("丢掉参数只留类型本体", () => {
    expect(mimeOf("image/png; charset=binary")).toBe("image/png");
    expect(mimeOf("APPLICATION/PDF")).toBe("application/pdf");
  });

  it("缺失时返回空串而非抛异常", () => {
    expect(mimeOf(undefined)).toBe("");
  });
});

describe("isImage / isPdf", () => {
  it("按主类型判断", () => {
    expect(isImage("image/webp")).toBe(true);
    expect(isImage("text/html")).toBe(false);
    expect(isPdf("application/pdf; version=1.7")).toBe(true);
  });
});

describe("suggestFileName", () => {
  it("优先用 URL 末段", () => {
    expect(suggestFileName("https://x.com/files/report.pdf")).toBe("report.pdf");
  });

  it("末段没有扩展名时按 content-type 补", () => {
    expect(suggestFileName("https://x.com/avatar", "image/png")).toBe("avatar.png");
  });

  it("查询串不参与文件名", () => {
    expect(suggestFileName("https://x.com/logo.svg?v=2&size=big")).toBe("logo.svg");
  });

  /** 末尾斜杠会让朴素的 split().pop() 取到空串 */
  it("末尾斜杠不产生空文件名", () => {
    expect(suggestFileName("https://x.com/download/", "application/zip")).toBe("download.zip");
  });

  it("根路径退回通用名", () => {
    expect(suggestFileName("https://x.com/", "image/jpeg")).toBe("response.jpg");
    expect(suggestFileName("https://x.com")).toBe("response");
  });

  it("认不出的类型就不硬猜扩展名", () => {
    expect(suggestFileName("https://x.com/data", "application/x-custom")).toBe("data");
  });

  /** 版本号形态的末段容易被误判成已有扩展名 */
  it("不把长后缀当扩展名", () => {
    expect(suggestFileName("https://x.com/export-20260816", "application/zip")).toBe(
      "export-20260816.zip",
    );
  });

  it("URL 编码的中文名要还原", () => {
    expect(suggestFileName("https://x.com/%E6%8A%A5%E5%91%8A.pdf")).toBe("报告.pdf");
  });

  it("URL 不可解析时不抛异常", () => {
    expect(suggestFileName("::::", "image/png")).toBe("::::.png");
  });
});
