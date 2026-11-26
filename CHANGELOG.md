# Changelog

## v0.5.0 (2026-11-26)

- **Web mode**: full PiWright workbench in a browser — headless server (plain Node.js, no
  Electron), WebSocket RPC with PIN authentication, HTTPS for LAN, static renderer hosting.
  Also published as the [`piwright-server`](https://www.npmjs.com/package/piwright-server)
  npm package (`npm i -g piwright-server`).
- **Background sessions**: keep agent sessions running in a daemon while the app is closed,
  reattach later; background session counter with a popover, watchdog with configurable
  grace period, eject a running session to background from the tab bar.
- **Linux support**: AppImage and deb builds, Linux CI release job, native pi backend,
  posix paths, bundled notification sounds (paplay/aplay).
- **Remote bridge**: phone-friendly UI, static PIN, TLS support, same-origin protection.
- **Sessions**: fork and rewind sessions from any assistant message, edit sent prompts,
  transcript tabs for subagent sessions.
- **Kanban**: boards per project with agent-driven cards, comments with session links and
  commit badges, attachments.
- **Git panel**: worktrees, log with icons, branch operations, conflict resolution.
- **Files**: monaco editor with tabs, upload/download, watch-driven refresh.
- **Terminal**: xterm.js terminals per project, WSL profiles on Windows.
- **Notifications**: sound and Telegram notifications on turn completion, awaiting input
  and errors.
