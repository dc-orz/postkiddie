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

# 标题过长会在 git log --oneline 和 GitHub 列表里被截断
SUBJECT_LEN=${#FIRST_LINE}
if ((SUBJECT_LEN > 72)); then
  echo "✗ 提交信息标题过长（${SUBJECT_LEN} 字符，上限 72）" >&2
  exit 1
fi
