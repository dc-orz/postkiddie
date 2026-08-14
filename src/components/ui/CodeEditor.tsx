import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import { pkEditorTheme, pkSyntaxHighlighting } from "@/lib/codemirror/theme";
import { knownVariables, variableExtension } from "@/lib/codemirror/variables";

export type CodeLanguage = "json" | "xml" | "text";

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLanguage;
  readOnly?: boolean;
  placeholder?: string;
  /** 当前作用域内已定义的变量名，未定义的会被标红。必须是稳定引用。 */
  variables?: ReadonlySet<string>;
  className?: string;
  ariaLabel?: string;
}

function languageExtension(language: CodeLanguage): Extension {
  switch (language) {
    case "json":
      return json();
    case "xml":
      return xml();
    default:
      return [];
  }
}

const EMPTY_VARIABLES: ReadonlySet<string> = new Set();

/**
 * CodeMirror 6 的 React 封装。
 *
 * 三处需要留心的地方：
 *
 * 1. **EditorView 只创建一次**，后续变化都通过 Compartment 局部重配置。
 *    重建实例会丢掉撤销历史、光标位置和折叠状态。
 * 2. **外部 value 同步前先比对内容**，否则会与用户输入形成回环：
 *    输入 → onChange → 父组件 setState → 回灌 → 光标跳到末尾。
 * 3. **主题不在依赖里**，因为它整套用 CSS 变量表达，亮暗切换由 CSS 自己完成。
 */
export function CodeEditor({
  value,
  onChange,
  language = "text",
  readOnly = false,
  placeholder,
  variables = EMPTY_VARIABLES,
  className,
  ariaLabel,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // 回调放进 ref，这样它变化时不必重建编辑器
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const languageComp = useRef(new Compartment()).current;
  const readOnlyComp = useRef(new Compartment()).current;
  const variablesComp = useRef(new Compartment()).current;
  const placeholderComp = useRef(new Compartment()).current;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅在挂载时建一次；其余变化走下面的 Compartment 重配置
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          search({ top: true }),
          // 长 URL 与压缩过的 JSON 必须折行，否则只能靠横向滚动阅读
          EditorView.lineWrapping,
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...searchKeymap,
            // Tab 在编辑器内缩进；键盘用户可先按 Esc 再 Tab 移出焦点
            indentWithTab,
          ]),
          pkEditorTheme,
          pkSyntaxHighlighting,
          variableExtension,
          languageComp.of(languageExtension(language)),
          readOnlyComp.of(EditorState.readOnly.of(readOnly)),
          variablesComp.of(knownVariables.of(variables)),
          placeholderComp.of(placeholder ? placeholderExtension(placeholder) : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    if (ariaLabel) {
      view.contentDOM.setAttribute("aria-label", ariaLabel);
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // 外部值变化（切换请求、撤销保存）时同步进编辑器
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageComp.reconfigure(languageExtension(language)),
    });
  }, [language, languageComp]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyComp.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly, readOnlyComp]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: variablesComp.reconfigure(knownVariables.of(variables)),
    });
  }, [variables, variablesComp]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: placeholderComp.reconfigure(placeholder ? placeholderExtension(placeholder) : []),
    });
  }, [placeholder, placeholderComp]);

  return <div ref={hostRef} className={cn("h-full min-h-0 overflow-hidden", className)} />;
}
