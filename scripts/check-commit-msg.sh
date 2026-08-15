#!/usr/bin/env bash
#
# 校验提交信息符合 Conventional Commits。
#
# 用 40 行脚本而非引入 commitlint + @commitlint/config-conventional + husky
# 三个依赖：规则本身就这么点，自己维护比追着上游升级省事。

set -euo pipefail

MSG_FILE="${1:?用法: check-commit-msg.sh <commit-msg-file>}"
FIRST_LINE=$(head -n 1 "$MSG_FILE")

# merge / revert / fixup 由 git 自动生成，不校验
if [[ "$FIRST_LINE" =~ ^(Merge|Revert|fixup!|squash!) ]]; then
  exit 0
fi

TYPES="feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert"
PATTERN="^(${TYPES})(\([a-z0-9./-]+\))?!?: .{1,}"

if [[ ! "$FIRST_LINE" =~ $PATTERN ]]; then
  cat >&2 <<EOF

✗ 提交信息不符合 Conventional Commits 规范

  当前：$FIRST_LINE

  格式：<type>(<scope>)?: <描述>
  类型：${TYPES//|/, }

  示例：
    feat(git): 状态栏展示 ahead/behind 计数
    fix(http): 修正 multipart 上传时的文件名编码
    refactor(storage)!: 集合改用目录结构存放

EOF
  exit 1
fi

# 标题过长会在 git log --oneline 和 GitHub 列表里被截断。
#
# 按**显示宽度**计算，而不是 ${#var}：后者在多数 locale 下按字节算，
# 一个中文字算 3，于是中文标题会被系统性误判为超长（这个脚本自己就踩过）。
# 而 git log 关心的本来就是终端占几列——CJK 字符占两列。
subject_width() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import sys, unicodedata
s = sys.argv[1]
print(sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s))
' "$1"
  else
    # 没有 python3 时退回字节数，并由调用方放宽上限，避免误伤非 ASCII
    printf "%s" "${#1}"
  fi
}

if command -v python3 >/dev/null 2>&1; then
  LIMIT=72
  UNIT="显示宽度"
else
  LIMIT=120
  UNIT="字节"
fi

WIDTH=$(subject_width "$FIRST_LINE")
if ((WIDTH > LIMIT)); then
  echo "✗ 提交信息标题过长（${WIDTH} ${UNIT}，上限 ${LIMIT}）" >&2
  echo "  $FIRST_LINE" >&2
  exit 1
fi
