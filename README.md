<div align="center">
  <img src="src-tauri/icons/128x128.png" width="72" alt="PostKiddie" />
  <h1>PostKiddie</h1>
  <p><strong>Manage HTTP requests like code.</strong><br />Stored as plain YAML in your own Git repo. Shared with <code>git push</code>.</p>

[![CI](https://github.com/dc-orz/postkiddie/actions/workflows/ci.yml/badge.svg)](https://github.com/dc-orz/postkiddie/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#system-requirements)

**English** · [简体中文](README.zh-CN.md)

</div>

---

## What is this

A lightweight HTTP client for desktop. Requests live as plain YAML files inside your Git
repository — versioning and team sharing go through Git itself. No accounts, no cloud,
no backend.

|  | Postman | PostKiddie |
|---|---|---|
| Storage | Cloud + local cache | Plain text in your Git repo |
| Sharing | Accounts / team workspaces | `git push` / `git pull` |
| Versioning | Platform-managed history | Git itself — branches, diff, blame, revert |
| Conflict resolution | Platform strategy | The Git merge flow you already know |
| Access control | Platform roles | Repository permissions |
| Offline use | Limited | Fully functional |

The point isn't just saving a backend. Once your API collection is a Git repo, API design
inherits the way code already works: branch to try a new endpoint, open a PR to review an
interface change, `git blame` to find out who added that header, `git revert` to undo a bad
edit. Git solved those problems twenty years ago.

## Features

- **Requests as files** — one request, one YAML file. Its identity *is* its path, so
  renaming and moving behave correctly and two people creating requests never collide on IDs.
- **Readable diffs** — multi-line JSON bodies are written as YAML block scalars, verbatim
  and unescaped, so `git diff` points at the exact JSON line that changed.
- **Secrets stay local** — environment variables marked `secret` never touch Git. The team
  shares the contract ("these keys must be filled in"), not the values.
- **Built-in terminal** — a real PTY running your own shell, opened at the workspace root.
  Completion, history, aliases, pagers and interactive commands (`git add -p`,
  `git rebase -i`) all work. Run `git checkout` there and the UI follows along.
- **Git where you can see it** — branch and ahead/behind counts live in the status bar;
  branch switching, staging, committing, per-file diffs and push/pull are all in-app.
- **Session capture** — log in through a built-in window, or paste a `Cookie` header or a
  whole `curl` command. PostKiddie never reads your browser's credential store
  ([why](docs/architecture.md)).
- **No cloud, ever** — everything is the file system and the `git` binary you already have.

## Quick start

Requires Node ≥ 22, pnpm, Rust stable, git, and your platform's Tauri prerequisites
(see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
pnpm install
pnpm app:dev
```

| Command | What it does |
|---|---|
| `pnpm app:dev` | Run the desktop app with hot reload |
| `pnpm dev` | Frontend only, in a browser — for UI work |
| `pnpm app:build` | Build installers |
| `pnpm check` | Everything: lint + types + contrast + rustfmt + clippy |
| `pnpm test` / `pnpm rs:test` | Frontend / Rust tests |
| `pnpm lint:fix` | Auto-fix formatting and fixable lints |
| `pnpm check:contrast` | Verify WCAG contrast of design tokens |

## What a workspace looks like

```text
my-api-workspace/            ← your Git repo
├── postkiddie.yaml
├── collections/
│   └── user-center/
│       ├── _folder.yaml     ← display order, folder-level headers/auth
│       └── login.yaml
├── environments/
│   └── local.yaml
└── .postkiddie/             ← machine-local, auto-gitignored
    └── secrets.yaml         ← real secret values, never committed
```

One request is one file:

```yaml
name: User login
method: POST
url: "{{baseUrl}}/auth/login"
headers:
  - name: Content-Type
    value: application/json
body:
  type: json
  content: |
    {
      "username": "admin",
      "password": "{{password}}"
    }
```

Full schema: [docs/storage-format.md](docs/storage-format.md).

## System requirements

| Platform | Minimum | Verification status |
|---|---|---|
| macOS | 14.5 | Developed and used here daily |
| Linux | WebKitGTK 2.44+ | Compiles, full test suite green in CI |
| Windows | 10/11 (WebView2 auto-updates) | Compiles in CI; **runtime unverified** |

The version floor is set by the CSS `light-dark()` function used by the design tokens; the
reasoning is in [docs/architecture.md](docs/architecture.md#5-系统要求).

Being explicit about Windows: the platform-specific code paths exist and compile, but the
test binary currently fails to start there with `0xc0000139`
(`STATUS_ENTRYPOINT_NOT_FOUND`) — a DLL-loading failure that happens before any test code
runs. So nothing is *known* broken, but nothing is verified either. If you use Windows and
hit problems, an issue with your OS version would genuinely help; see the notes in
[.github/workflows/ci.yml](.github/workflows/ci.yml) for where to start digging.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Save request | `⌘S` / `Ctrl+S` |
| Send request | `⌘↩` / `Ctrl+Enter` |
| Commit (in Git panel) | `⌘↩` / `Ctrl+Enter` |
| Toggle terminal | `` ⌘` `` / `` Ctrl+` `` |
| Switch branch | Click the branch name in the status bar |
| View a file's diff | Click the file name in the Git panel |
| Resize panels | Focus a splitter, then arrow keys — `Shift` to accelerate, `Home`/`End` for edges, double-click to reset |

## Project status

This is phase one. Working today: workspaces (open/init/switch), collections with drag
reordering, the full request editor (7 body types, 4 auth modes), responses, environments,
cookies, history, Postman v2.x import, the Git panel with per-file diffs and branch
switching, and the built-in terminal.

Not built yet: gRPC/WebSocket, scripting and assertions (pre-request / test), a mock server,
collection runners and code generation. See the
[Chinese README](README.zh-CN.md#一期范围) for the itemized list.

## Documentation

The design docs are written in Chinese — they record not just decisions but the reasoning
behind them, which matters most when you want to overturn one.

- [Architecture and technology choices](docs/architecture.md) — every decision and why
- [Design tokens](docs/design-tokens.md) — the design system
- [Storage format](docs/storage-format.md) — the YAML schema
- [Development conventions](docs/conventions.md) — code style, commit format, directory roles

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); it
covers the toolchain, the commit format, and what the Git hooks will check before you push.

## License

[MIT](LICENSE)
