# PiWright

Desktop workbench for the [pi coding agent](https://github.com/earendil-works/pi) — a native Windows app (Electron + React) that turns pi into a full IDE-like workspace: chat sessions, projects, git, file editor and terminal in one window.

## Features

### Chat
- Streaming chat with pi over RPC, markdown rendering with syntax highlighting
- Collapsible tool-call blocks (optional single-line mode), nested subagent tool calls as a tree
- **Steer** and queued messages: send follow-ups mid-turn or queue them for the next turn
- Interactive question cards (ask_question) with options, free-text answers and multi-select
- Todo widget pinned above the chat, live context-usage indicator with color grading and cache stats
- Paste images and attach files (copied to `.pi/attachments`, referenced with `@`)
- Session history with subagent sessions nested under their parent, unread dots and busy badges per project

### Projects and backends
- Multiple projects in a sidebar, each with its own sessions, git repo and settings
- Two pi backends: native Windows and WSL (per-project choice, auto-detection)
- Git worktree support: create, reuse and delete worktrees, sessions grouped under the project

### Git panel
- Status with color-coded files (modified / staged / untracked / deleted) grouped into a folder tree
- Stage / unstage / commit, unified and split diffs
- Branch popup in IDE style: search, create, checkout, rename, delete

### Files and editor
- File browser with Monaco editor, soft wrap toggle
- Markdown files: Obsidian-style live preview — click a block to edit the source, everything else renders

### Terminal
- Docked terminal at the bottom (node-pty / ConPTY, native and WSL)
- Multiple tabs, renameable, restored after restart

### Models, MCP and skills
- Manage pi providers and models (`models.json`) for both backends: add, edit, copy between backends
- MCP servers: user-level and per-project, enable/disable, exposure toggles, JSON import, live connection check
- Skills: user-level and per-project directories with toggles

### Notifications and remote access
- Sound notifications for completed turns, questions and errors (system sounds or custom wav)
- Telegram bot notifications with per-event checkboxes and per-session toggle
- Remote control from a phone: built-in WebSocket bridge with PIN auth serves the web UI — session list, chat with images, abort, dialog answers, session creation

### Interface
- Dark and light themes, adjustable chat font size
- English and Russian UI
- Configurable send key (Enter / Ctrl+Enter), model/thinking selector placement

## Requirements

- Windows 10/11
- Node.js ≥ 22.19 and Git for Windows
- [pi CLI](https://github.com/earendil-works/pi): native (`irm https://pi.dev/install.ps1 | iex`) and/or inside WSL — selectable per project in settings

## Installation

Download the latest installer from [Releases](https://github.com/php-programmist/PiWright/releases/latest). The app checks this feed for updates automatically (configurable in Settings → Launch → Update feed URL).

## Building from source

```sh
npm install
npm run build          # compile to out/
npm run dist           # build the NSIS installer (release/)
```

## Development

```sh
npm install
npm run dev            # electron-vite dev (window + HMR)
npm test               # vitest
npm run typecheck      # tsc (node + web configs)
npm run lint           # eslint
```

## Settings

App settings live in `%APPDATA%\Piwright\settings.json` and are editable from the in-app settings window: backends, WSL distro, pi path, update feed, appearance, notifications, remote access.

## Project structure

- `src/main` — Electron main process: pi RPC client, backends (native/WSL), settings, git, files, terminal, MCP, notifications, remote bridge
- `src/preload` — contextBridge, the only IPC boundary
- `src/shared` — IPC contracts and pi protocol types, no side effects
- `src/renderer` — React UI (zustand stores, views)
- `tests` — vitest

## License

[MIT](LICENSE)
