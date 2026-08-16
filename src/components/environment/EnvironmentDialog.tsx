import { Eye, EyeOff, KeyRound, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { confirmAction, showError } from "@/lib/dialog";
import { useWorkspace } from "@/stores/workspace";
import type { Environment, EnvVariable } from "@/types/api";

/** 表格里始终留一个空行，输入即新增——比先点「添加」再填快一步 */
const BLANK: EnvVariable = { name: "", value: "", secret: false, enabled: true };

const CELL_INPUT =
  "w-full bg-transparent px-2 py-1 font-mono outline-none placeholder:text-fg-subtle";

interface VariableRowProps {
  row: EnvVariable;
  /** 末尾那一行占位行：不显示勾选框与删除按钮，填了内容才变成真正的一行 */
  isBlank: boolean;
  masked: boolean;
  onChange: (patch: Partial<EnvVariable>) => void;
  onRemove: () => void;
  onToggleReveal: () => void;
}

function VariableRow({
  row,
  isBlank,
  masked,
  onChange,
  onRemove,
  onToggleReveal,
}: VariableRowProps) {
  return (
    <tr className="group/row border-b border-line-subtle last:border-b-0">
      <td className="text-center">
        {!isBlank ? (
          <input
            type="checkbox"
            checked={row.enabled !== false}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            aria-label={`启用 ${row.name}`}
            className="align-middle"
          />
        ) : null}
      </td>

      <td>
        <input
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={isBlank ? "变量名" : ""}
          spellCheck={false}
          aria-label="变量名"
          className={CELL_INPUT}
        />
      </td>

      <td>
        <input
          // 密钥默认打码：录屏、结对、截图分享时不至于把 token 直接暴露出去
          type={masked ? "password" : "text"}
          value={row.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={isBlank ? "值" : ""}
          spellCheck={false}
          aria-label="变量值"
          className={CELL_INPUT}
        />
      </td>

      <td>
        {!isBlank ? (
          <div className="flex items-center justify-center gap-0.5">
            <input
              type="checkbox"
              checked={row.secret === true}
              onChange={(e) => onChange({ secret: e.target.checked })}
              aria-label={`将 ${row.name} 标记为密钥`}
            />
            {row.secret ? (
              <button
                type="button"
                onClick={onToggleReveal}
                aria-label={masked ? "显示值" : "隐藏值"}
                className="flex size-5 items-center justify-center rounded-sm text-fg-subtle hover:bg-hover hover:text-fg"
              >
                {masked ? <Eye size={11} strokeWidth={2} /> : <EyeOff size={11} strokeWidth={2} />}
              </button>
            ) : null}
          </div>
        ) : null}
      </td>

      <td className="text-center">
        {!isBlank ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`删除 ${row.name}`}
            className={cn(
              "flex size-5 items-center justify-center rounded-sm text-fg-subtle",
              "opacity-0 transition-opacity duration-fast",
              "hover:bg-hover hover:text-danger group-hover/row:opacity-100 focus-visible:opacity-100",
            )}
          >
            <X size={11} strokeWidth={2} />
          </button>
        ) : null}
      </td>
    </tr>
  );
}

interface EnvironmentDialogProps {
  open: boolean;
  onClose: () => void;
}

export function EnvironmentDialog({ open, onClose }: EnvironmentDialogProps) {
  const environments = useWorkspace((s) => s.environments);
  const saveEnvironment = useWorkspace((s) => s.saveEnvironment);
  const createEnvironment = useWorkspace((s) => s.createEnvironment);
  const deleteEnvironment = useWorkspace((s) => s.deleteEnvironment);

  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Environment | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  // 打开时载入第一个环境；关闭时清掉草稿，避免下次打开闪出上次的内容
  useEffect(() => {
    if (!open) {
      setDraft(null);
      setRevealed(new Set());
      return;
    }
    setSelected((prev) => prev ?? environments[0]?.name ?? null);
  }, [open, environments]);

  // 选中项变化时把 store 里的环境复制成草稿
  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    const found = environments.find((e) => e.name === selected);
    setDraft(found ? structuredClone(found) : null);
    setRevealed(new Set());
  }, [selected, environments]);

  const original = useMemo(
    () => environments.find((e) => e.name === selected) ?? null,
    [environments, selected],
  );
  const dirty = useMemo(
    () => (draft && original ? JSON.stringify(draft) !== JSON.stringify(original) : false),
    [draft, original],
  );

  const rows = draft ? [...draft.variables, BLANK] : [];

  function updateVariable(index: number, patch: Partial<EnvVariable>) {
    setDraft((prev) => {
      if (!prev) return prev;
      const variables =
        index === prev.variables.length
          ? [...prev.variables, { ...BLANK, ...patch }]
          : prev.variables.map((v, i) => (i === index ? { ...v, ...patch } : v));
      return { ...prev, variables };
    });
  }

  function removeVariable(index: number) {
    setDraft((prev) =>
      prev ? { ...prev, variables: prev.variables.filter((_, i) => i !== index) } : prev,
    );
  }

  function toggleReveal(name: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleSave() {
    if (!draft || !selected) return;
    setBusy(true);
    try {
      // 丢掉尾部那个从未填写过的空行
      const cleaned = {
        ...draft,
        variables: draft.variables.filter((v) => v.name.trim() !== ""),
      };
      await saveEnvironment(selected, cleaned);
      onClose();
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "保存环境失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const base = "新建环境";
    const taken = new Set(environments.map((e) => e.name));
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;

    setBusy(true);
    try {
      const created = await createEnvironment(name);
      setSelected(created.name);
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "新建环境失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(name: string) {
    const hasSecrets = environments.find((e) => e.name === name)?.variables.some((v) => v.secret);
    const text = hasSecrets
      ? `将删除环境「${name}」，本机为它保存的密钥值也会一并清除。`
      : `将删除环境「${name}」。`;

    if (!(await confirmAction(text, { title: "删除环境", okLabel: "删除" }))) return;

    setBusy(true);
    try {
      await deleteEnvironment(name);
      setSelected(null);
    } catch (error) {
      await showError(error instanceof Error ? error.message : String(error), "删除环境失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} label="环境管理" className="w-[46rem] max-w-[90vw]">
      <div className="flex h-[26rem] max-h-[80vh] flex-col">
        <header className="flex h-toolbar shrink-0 items-center border-b border-line-subtle px-3">
          <h2 className="flex-1 text-md font-medium">环境管理</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* 环境列表 */}
          <nav className="flex w-44 shrink-0 flex-col border-r border-line-subtle">
            <ul className="min-h-0 flex-1 overflow-auto py-1">
              {environments.map((env) => (
                <li key={env.name} className="group/env flex items-center">
                  <button
                    type="button"
                    onClick={() => setSelected(env.name)}
                    className={cn(
                      "flex h-row min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left text-sm",
                      "transition-colors duration-fast",
                      selected === env.name
                        ? "bg-selected text-fg"
                        : "text-fg-secondary hover:bg-hover",
                    )}
                  >
                    <span className="pk-truncate flex-1">{env.name}</span>
                    {env.variables.some((v) => v.secret) ? (
                      <KeyRound
                        size={10}
                        strokeWidth={2}
                        className="shrink-0 text-fg-subtle"
                        aria-label="含密钥"
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(env.name)}
                    aria-label={`删除环境 ${env.name}`}
                    className={cn(
                      "mr-1 flex size-5 shrink-0 items-center justify-center rounded-sm",
                      "text-fg-subtle opacity-0 transition-opacity duration-fast",
                      "hover:bg-hover hover:text-danger group-hover/env:opacity-100 focus-visible:opacity-100",
                    )}
                  >
                    <Trash2 size={11} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 border-t border-line-subtle px-2.5",
                "text-sm text-fg-muted transition-colors duration-fast hover:bg-hover hover:text-fg",
              )}
            >
              <Plus size={12} strokeWidth={2} />
              新建环境
            </button>
          </nav>

          {/* 变量表格 */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {draft ? (
              <>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full border-collapse text-base">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="border-b border-line-subtle text-xs text-fg-muted">
                        <th className="w-8" />
                        <th className="px-2 py-1.5 text-left font-medium">变量名</th>
                        <th className="px-2 py-1.5 text-left font-medium">值</th>
                        <th className="w-16 px-1 py-1.5 text-center font-medium">密钥</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <VariableRow
                          // biome-ignore lint/suspicious/noArrayIndexKey: 行由位置标识，变量名可重复且编辑中可能为空
                          key={index}
                          row={row}
                          isBlank={index === draft.variables.length}
                          masked={row.secret === true && !revealed.has(row.name)}
                          onChange={(patch) => updateVariable(index, patch)}
                          onRemove={() => removeVariable(index)}
                          onToggleReveal={() => toggleReveal(row.name)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 这句话是整个密钥机制能被信任的前提，必须常驻可见 */}
                <p className="flex shrink-0 items-center gap-1.5 border-t border-line-subtle px-3 py-2 text-xs text-fg-muted">
                  <KeyRound size={11} strokeWidth={2} className="shrink-0" />
                  勾选「密钥」的变量，其值只保存在本机 .postkiddie/secrets.yaml，不会提交到 git。
                </p>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-fg-muted">
                  {environments.length === 0 ? "还没有环境，先新建一个" : "从左侧选择一个环境"}
                </p>
              </div>
            )}
          </div>
        </div>

        <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-line-subtle px-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={!dirty || busy}>
            {busy ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : null}
            保存
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
