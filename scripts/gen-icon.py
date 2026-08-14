#!/usr/bin/env python3
"""生成应用图标源图（1024×1024 PNG）。

不依赖 Pillow 等第三方库：用有符号距离场（SDF）直接光栅化，
再用标准库 zlib 写 PNG。这样 CI 上无需额外安装任何东西就能重新生成图标。

生成后用 Tauri CLI 派生各平台所需尺寸：
    pnpm tauri icon src-tauri/icons/source.png
"""

import math
import struct
import zlib
from pathlib import Path

SIZE = 1024

# 取自 tokens.css 的 --pk-accent-500 / --pk-accent-700，转换到 sRGB
ACCENT = (0x46, 0x60, 0xE5)
ACCENT_DEEP = (0x33, 0x45, 0xB4)
WHITE = (0xFF, 0xFF, 0xFF)


def rounded_rect_sdf(px: float, py: float, half_w: float, half_h: float, radius: float) -> float:
    """圆角矩形的有符号距离，负值在内部。"""
    dx = abs(px) - half_w + radius
    dy = abs(py) - half_h + radius
    outside = math.hypot(max(dx, 0.0), max(dy, 0.0))
    inside = min(max(dx, dy), 0.0)
    return outside + inside - radius


def segment_sdf(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    """点到线段的距离。"""
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    t = 0.0 if denom == 0 else max(0.0, min(1.0, (pax * bax + pay * bay) / denom))
    return math.hypot(pax - bax * t, pay - bay * t)


def blend(dst: tuple[int, int, int], src: tuple[int, int, int], alpha: float) -> tuple[int, int, int]:
    return tuple(round(d + (s - d) * alpha) for d, s in zip(dst, src))  # type: ignore[return-value]


def coverage(distance: float, feather: float = 1.2) -> float:
    """把 SDF 距离映射成 0..1 的覆盖率，得到抗锯齿边缘。"""
    return max(0.0, min(1.0, 0.5 - distance / feather))


def build() -> bytearray:
    rows = bytearray()
    half = SIZE / 2

    # 图案：一条水平主干 + 两条斜线构成的右向箭头（发送），
    # 尾端一个圆点代表「一次提交 / 一个节点」，呼应 git 语义。
    stroke = SIZE * 0.055
    arrow_y = 0.0
    shaft_x0, shaft_x1 = -SIZE * 0.20, SIZE * 0.20
    head_len = SIZE * 0.135
    dot_x, dot_r = -SIZE * 0.285, SIZE * 0.052

    for y in range(SIZE):
        row = bytearray()
        py = y - half + 0.5
        for x in range(SIZE):
            px = x - half + 0.5

            # 背景：圆角方块，带一点从左上到右下的深浅渐变，避免大面积纯色显得呆板
            bg_d = rounded_rect_sdf(px, py, SIZE * 0.46, SIZE * 0.46, SIZE * 0.225)
            bg_a = coverage(bg_d)
            if bg_a <= 0.0:
                row += bytes((0, 0, 0, 0))
                continue

            t = max(0.0, min(1.0, (px + py) / SIZE + 0.5))
            color = blend(ACCENT, ACCENT_DEEP, t * 0.55)

            # 前景箭头
            d_shaft = segment_sdf(px, py, shaft_x0, arrow_y, shaft_x1, arrow_y)
            d_up = segment_sdf(px, py, shaft_x1 - head_len, arrow_y - head_len, shaft_x1, arrow_y)
            d_down = segment_sdf(px, py, shaft_x1 - head_len, arrow_y + head_len, shaft_x1, arrow_y)
            d_dot = math.hypot(px - dot_x, py - arrow_y) - dot_r

            d_fg = min(d_shaft, d_up, d_down) - stroke / 2
            d_fg = min(d_fg, d_dot)

            fg_a = coverage(d_fg)
            if fg_a > 0.0:
                color = blend(color, WHITE, fg_a)

            row += bytes((*color, round(bg_a * 255)))

        rows += b"\x00" + row

    return rows


def write_png(path: Path, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8bit RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


if __name__ == "__main__":
    target = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "source.png"
    write_png(target, build())
    print(f"已生成 {target}（{SIZE}×{SIZE}）")
