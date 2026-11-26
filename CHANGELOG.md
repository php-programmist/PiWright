# Changelog

## v0.6.0 (2026-11-26)

- **Background sessions**: sessions run in a separate daemon process — closing a tab or
  quitting mid-turn keeps the agent running; sessions survive app restart, open tabs are
  restored, sound/Telegram notifications for background turns with a configurable idle
  grace, footer counter with a popover and stop-all. Off by default (Settings → Advanced).
- **Web mode**: transport-agnostic RPC layer, browser replacements for native dialogs
  (file/folder pickers, theme export, sound upload), TLS for LAN, same-origin protection;
  headless server published as the
  [`piwright-server`](https://www.npmjs.com/package/piwright-server) npm package.
- **Linux support**: platform-aware paths, sounds, terminal profiles, safeStorage fallback;
  Linux CI release job publishing AppImage and deb packages.
- **Remote kanban**: kanban boards on the phone — board tree, card editing, comments,
  column loops.
- **Git panel**: push/force-push and pull (rebase/merge/fast-forward) in the branch
  selector with ahead/behind arrows; Resolve Conflicts dialog (Yours/Theirs/AI per file,
  Continue/Abort) and rebase items in the branch submenu.
- **Models settings**: copy providers/models to any backend (Windows/WSL/SSH) via a menu,
  raw models.json editor with validation.
- **Files**: "Show in folder" context menu item.
- **Loops**: survive session detach/attach and app restart; a model error stops the loop.
- **Fixes**: daemon startup in installed builds (paths with spaces, PATH env, runAsNode
  fuse), installer daemon check, mid-turn attach state, Steer after attach, loop panel
  after restart, non-image paste, Cyrillic attachment names, update popup version,
  transcript tab layout.

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
