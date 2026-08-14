import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror 主题。
 *
 * 所有颜色都写成 `var(--pk-*)` 而非字面值——CodeMirror 生成的是真实 CSS 规则，
 * CSS 变量在其中同样生效。于是切换亮暗主题时编辑器自动跟随，
 * 既不用重建 EditorView，也不用维护两套主题配置。
 */
export const pkEditorTheme = EditorView.theme({
  "&": {
    color: "var(--pk-text-primary)",
    backgroundColor: "transparent",
    fontSize: "var(--pk-text-base)",
    height: "100%",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--pk-font-mono)",
    lineHeight: "var(--pk-leading-code)",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "var(--pk-space-2) 0",
    caretColor: "var(--pk-text-primary)",
  },
  ".cm-line": {
    padding: "0 var(--pk-space-3)",
  },

  // 光标与选区
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--pk-text-primary)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--pk-accent-bg-subtle)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "var(--pk-bg-active)",
  },

  // 行号栏：靠右对齐、低对比，不与正文抢注意力
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--pk-text-subtle)",
    border: "none",
    fontSize: "var(--pk-text-xs)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 var(--pk-space-2) 0 var(--pk-space-3)",
    minWidth: "2.5ch",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--pk-text-secondary)",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 var(--pk-space-0-5)",
    cursor: "default",
  },

  // 括号匹配：用底色而非边框，避免文字位置发生 1px 位移
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--pk-bg-active)",
    outline: "1px solid var(--pk-border-strong)",
  },
  ".cm-nonmatchingBracket": {
    color: "var(--pk-danger-fg)",
  },

  // 搜索面板
  ".cm-panels": {
    backgroundColor: "var(--pk-bg-raised)",
    color: "var(--pk-text-primary)",
    borderTop: "1px solid var(--pk-border-default)",
  },
  ".cm-panel input, .cm-panel button": {
    fontFamily: "var(--pk-font-sans)",
    fontSize: "var(--pk-text-sm)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--pk-warning-bg)",
    outline: "1px solid var(--pk-warning-border)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--pk-accent-bg-subtle)",
  },

  // 自动补全弹层
  ".cm-tooltip": {
    backgroundColor: "var(--pk-bg-raised)",
    border: "1px solid var(--pk-border-default)",
    borderRadius: "var(--pk-radius-md)",
    boxShadow: "var(--pk-shadow-md)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--pk-bg-selected)",
    color: "var(--pk-text-primary)",
  },

  ".cm-placeholder": {
    color: "var(--pk-text-subtle)",
    fontFamily: "var(--pk-font-sans)",
  },
});

/**
 * 语法高亮。色相取自 design token 的组件层（`--pk-syn-*`），
 * 与应用其余部分同源，不会出现「编辑器里的绿和别处的绿不是一个绿」。
 */
export const pkHighlightStyle = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--pk-syn-key)" },
  { tag: [t.string, t.special(t.string)], color: "var(--pk-syn-string)" },
  { tag: [t.number, t.integer, t.float], color: "var(--pk-syn-number)" },
  { tag: [t.bool, t.atom], color: "var(--pk-syn-boolean)" },
  { tag: t.null, color: "var(--pk-syn-null)" },
  { tag: [t.punctuation, t.separator, t.bracket], color: "var(--pk-syn-punct)" },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: "var(--pk-syn-comment)",
    fontStyle: "italic",
  },
  { tag: [t.tagName, t.angleBracket], color: "var(--pk-syn-tag)" },
  { tag: t.attributeName, color: "var(--pk-syn-key)" },
  { tag: t.attributeValue, color: "var(--pk-syn-string)" },
  { tag: [t.keyword, t.operator], color: "var(--pk-syn-boolean)" },
  { tag: t.variableName, color: "var(--pk-text-primary)" },
  { tag: t.invalid, color: "var(--pk-danger-fg)" },
]);

export const pkSyntaxHighlighting = syntaxHighlighting(pkHighlightStyle);
