<!--
中英文皆可 / Either language is fine.
提交前建议本地跑一遍 `pnpm check`，pre-push hook 也会拦（类型检查 + clippy + 测试）。
-->

## 解决什么问题

<!-- 从问题说起，而不只是「改了什么」。关联 issue 可写 Closes #123 -->

## 怎么做的

<!-- 有取舍的地方请说明为什么选这条路，以及否掉了什么。
     这个项目的注释和提交信息都倾向于记录理由——将来推翻某个决定时，
     先要知道它当初成立的前提是什么。 -->

## 自查

- [ ] `pnpm check` 通过（lint + 类型 + 对比度 + rustfmt + clippy）
- [ ] `pnpm test` 与 `pnpm rs:test` 通过
- [ ] 改了 Rust 模型或命令签名 → 已跑 `pnpm rs:test` 并提交重新生成的 `src/types/bindings.ts`
- [ ] 新增的逻辑「出错时会静默产生错误结果」→ 已加测试，并确认过**去掉修复后测试会失败**
- [ ] 改了 design token → `pnpm check:contrast` 通过
- [ ] 新增依赖 → 已在上面说明为什么标准库或已有依赖做不到
- [ ] 界面上能看见的改动 → 附了截图或录屏

## 界面变化

<!-- 截图 / 录屏。深浅两种主题都受影响的话，两张都放。 -->
