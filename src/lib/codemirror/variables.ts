import { Facet } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * 当前作用域内已定义的变量名。
 *
 * 传入的 Set 必须是**稳定引用**（React 侧用 useMemo 保证）：
 * 插件靠比较引用来判断是否需要重算全部装饰，每次渲染都换新对象会造成无谓的全量重绘。
 */
export const knownVariables = Facet.define<ReadonlySet<string>, ReadonlySet<string>>({
  combine: (values) => values[0] ?? new Set<string>(),
});

/**
 * 匹配 `{{name}}`。
 *
 * 允许花括号内有空白（`{{ token }}` 与插值实现一致），
 * 但不匹配空名字——`{{}}` 与 GraphQL 里的 `{{` 都应按普通文本处理。
 */
const VARIABLE_RE = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

const RESOLVED = Decoration.mark({ class: "pk-cm-variable" });
const UNRESOLVED = Decoration.mark({ class: "pk-cm-variable-unresolved" });

const matcher = new MatchDecorator({
  regexp: VARIABLE_RE,
  decorate: (add, from, to, match, view) => {
    const name = match[1];
    if (!name) return;
    const known = view.state.facet(knownVariables);
    add(from, to, known.has(name) ? RESOLVED : UNRESOLVED);
  },
});

/**
 * 高亮模板变量，未定义的标红。
 *
 * 在输入时就把「这个变量当前环境里没有」标出来，比发出去再报错早一步——
 * 后者往往要等到看见一个 404 才反应过来是变量没替换。
 */
export const variableHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view);
    }

    update(update: ViewUpdate) {
      // 切换环境会换掉变量集合，此时已有的装饰全部需要重新判定
      const scopeChanged =
        update.startState.facet(knownVariables) !== update.state.facet(knownVariables);

      this.decorations = scopeChanged
        ? matcher.createDeco(update.view)
        : matcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** 变量的视觉样式。与语法高亮分开，因为它不是语言的一部分。 */
export const variableTheme = EditorView.theme({
  ".pk-cm-variable": {
    color: "var(--pk-syn-variable-fg)",
    backgroundColor: "var(--pk-syn-variable-bg)",
    borderRadius: "var(--pk-radius-xs)",
    padding: "1px 1px",
  },
  ".pk-cm-variable-unresolved": {
    color: "var(--pk-syn-variable-unresolved-fg)",
    backgroundColor: "var(--pk-syn-variable-unresolved-bg)",
    borderRadius: "var(--pk-radius-xs)",
    padding: "1px 1px",
    // 波浪下划线：与「拼写错误」的通用心智一致，不必额外解释
    textDecoration: "underline wavy",
    textDecorationThickness: "1px",
    textUnderlineOffset: "2px",
  },
});

export const variableExtension = [variableHighlight, variableTheme];
