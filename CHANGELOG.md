# Changelog

## v0.6.0 (2026-11-26)

### Added
- Background sessions: agent sessions run in a separate daemon process — closing a tab keeps the session in the projects panel (a running one gets a play/attach button) while its turn keeps running, sessions survive app restart and reopen from history, open tabs are restored on startup (3f9d44e, 7eaef58, fba1584, 1479bbb, 7883947, 80c5152, 679a27b, 2a9d4ac, 6dc0b0c)
- Background session notifications: sound and Telegram alert when a background turn or dialog finishes; configurable idle grace before a finished session is stopped (1dc45ea, 88ab20c, a8bef77)
- Background session controls: "Background sessions" toggle in settings, eject button on running tabs and session rows, footer counter with a popup list of background sessions and stop-all (0056be3, 4af9f9e, c005944, d494ff9, 339dacd)
- Web mode: the full PiWright UI in a browser — transport-agnostic RPC layer, headless server with the static renderer, browser replacements for native dialogs, PIN auth with same-origin checks and TLS for LAN, published as the `piwright-server` npm package (e09ea03, f410464, 961a22a, 67db418, a8a9473, 9b063af)
- Linux support: AppImage and deb packaging, Linux CI release pipeline, platform-aware paths, sounds, terminal profiles and safeStorage fallback (c095da9, 3dd35a2, e5e9bb4)
- Kanban boards on the phone via remote mode: board tree, card editing, comments, column loops (a6198d7)
- Git: push/force-push and pull (rebase/merge/fast-forward) in the branch selector with ahead/behind arrows; Resolve Conflicts dialog (Yours/Theirs/AI per file, Continue/Abort) and rebase items in the branch submenu (0aaca5e, efc6830)
- Models settings: "Copy to" menu covering Windows/WSL/SSH backends and a raw models.json editor with validation (c8fc2b5)
- Files: "Show in folder" context menu item for files and folders (fc00ec6)
- Loops: survive session detach/attach and app restart; a turn ending with a model error stops the loop (0aa6970, 22ef3b4, 5e8c976)
- Release notes are published automatically to GitHub Releases and the npm package README (fb06883)

### Fix
- Pasting non-image files into chat was silently dropped (9d70218)
- Cyrillic attachment names mangled to underscores (af62bcd)
- "Updated" popup showed the old version instead of the current one (0f7e3f1)
- Transcript tab stretched the tab bar (4c4d593)

## v0.5.0 (2026-11-25)

### Added
- SSH backend: run pi on remote Linux servers over SSH — ssh2 transport (password, key + passphrase, ssh-agent), remote projects with file/git/terminal/kanban parity over SFTP, host-key verification (accept-new), secrets kept out of settings.json. Known limits: no live file watching, no MCP probe, token stats skip SSH roots. (93b2400, bfbc011, f42c4cc, 3d432dd, 62114e4)
- SSH settings tab: server CRUD with live connection test (reports the resolved pi path), "forget host key", secret fields; remote directory browser in the add-project dialog; SSH tab in Models settings. (bfbc011, 62114e4)
- Rewind: button under assistant answers, on one row with fork, rolls the session and code back to that point — session forks to a new branch, working directory is restored from a snapshot taken before the next prompt, current state is saved to git stash as a safety net. (cacc10f, bdfd05f)
- Token usage statistics (File → Statistics, Ctrl+Shift+S): in/out/cached-read bar charts per day, month, year or custom range, project/model/metric filters, totals row, grouped/stacked modes. (f649b3c, baef6f4, 39f43b3)
- In-app changelog: click the version in the projects panel footer for "What's new" (GitHub API with Atom-feed fallback, offline cache); "updated to X" popup after installing a new version. (d728120, cf22a66)
- Explicit update flow: updates are no longer downloaded silently — a banner offers "Download and install" or "Don't offer this version". (37c3ec3)
- Kanban link tokens in input fields (prompt, card description, comments) render as badges with task/session names; Backspace next to a badge deletes the whole token. (afaf415, f981a25, ecc1b60)
- Crash recovery: if the renderer process crashes, a native dialog offers Reload / Restart without sandbox / Close instead of a blank window. (8ad4088)

### Changed
- Skills and MCP tabs open for the project of the active tab set, not the globally active session. (55e2a14)
- Fork marker moved to the start of forked session names so it stays visible in the UI. (15ae9e7)
- README: code signing policy section (SignPath Foundation). (f87a5de)

## v0.4.1 (2026-11-25)

### Added
- Kanban link chips: "Copy task link" in the card context menu and "Copy session link" in the session tab menu; `kanban:task:…` / `session:…` tokens render as clickable chips in the chat feed, card description and comments — a task chip opens the card, a session chip activates a live session or restores it from history (3344b1a, fa75067)
- Dedicated kanban task tab: a card can be opened as a full tab (card context menu → "Open in separate tab", or click a task chip) with the same editor as the board modal; tabs persist across restarts and group with board tabs (032e4af)
- Session task chips in the chat header: board cards linked to the current session (via the agent's session reference) show as chips left of the panel toggler, click opens the task tab (7e8ea98)
- Click a pending (not yet sent) image thumbnail in the composer to open the lightbox preview (a972283)

### Changed
- Model dropdown refreshes the catalog when it is opened (throttled to 5s) and after saving models in Settings — no longer relies only on window focus (c32f76c)

### Fix
- WSL projects: files behind Linux symlinks (e.g. `CLAUDE.md` → `AGENTS.md`, scripts with absolute POSIX targets) were listed in the file tree but failed to open — the symlink chain is now resolved through `wsl.exe readlink` (fa99926)
- Branch submenu no longer overlaps the branch popup; it opens strictly to its right (a9387ae)

## v0.4.0 (2026-11-24)

### Added
- Session queue: schedule a prompt to run after another session's turn ends or at a set time — right-click Send, cancel from the Scheduled panel; loops can be scheduled too (exit condition and iteration count captured) (0dcf54f, 829774b)
- Queue actions: no feed duplicates, convert followUp ↔ steer from the queue row, "return to composer" pencil to edit a queued prompt (2b79da1)
- Chat attachments kept in the repo root `.pi/attachments` so worktree sessions share them and survive worktree removal; image previews with lightbox in the chat feed (d62e29c)
- App header shows the active project and branch (IDE-style): project switcher, branch popup, ahead/behind arrows with auto `git fetch` every 60s (7a1d899, 4075fbf)
- Git Log: search by message or commit hash, branch filter dropdown, right-click commit menu — cherry-pick, checkout revision, reset soft/mixed/hard, revert, edit message, squash, drop commit, interactive rebase from here, new branch/tag, parent/child navigation (843ce72)
- Git Log graph now shows side branches by default (`--all` scoped to heads/remotes/tags, stash excluded) with converging lanes where branches merge (7ee0ed6)
- Kanban panel redesigned as a task tree: board → columns → tasks, per-column theme accents and counters, collapse/expand persisted, session status dots per card (busy/confirm/waiting/unread) surviving session close until the card is opened (6d87853)
- Branch switcher: pin branches to the top (📌), main/master ordered first (92f7425)
- Drag-and-drop vertical reordering of projects in the sidebar; projects are ordered by add order rather than alphabetically, order persisted in settings.json (f381745)
- Resizable composer with auto-growing prompt (up to 15 lines) and loop-exit field; drag handle, double-click resets to auto (f510d78)
- Model dropdown refreshes after a manual `models.json` edit — pi model catalog reload via embedded extension on window focus/visibility change (96476fb)
- Custom application menu: File → Settings (Ctrl+,) and Exit, localized with the app language (1d6938d, b89c2f4)
- Play button to preview the selected notification sound (c0a5560)
- Click a collapsed project's colored badge counters to expand it (d93f659)

### Changed
- Send key default is now Enter (was Ctrl+Enter); an explicitly saved setting is left untouched (8952e5d)
- Error state in UI: a turn that fails with a model error now ends as `error` — red dot in chat header, session panel, tab bar and kanban cards, no completion sound, Telegram gets an error notification with the message (f4c5560)
- Kanban panel and board view poll for live updates every 3s — mutations made by agents through the pi extension appear without manual refresh (b5892f6)
- Diff overlay: arrow keys step through the files of the selected commit or working copy (was cycling only open tabs) (08df593)
- i18n: thinking-level labels no longer show a "thinking" prefix in English; kanban themes hint has full English text (e67eb38)

### Fix
- Remote: phone-created sessions had empty model/thinking dropdowns and the first prompt silently disappeared — lazy hosts are now started on attach/create/prompt, with catalog fallback to handshake cache (b0d0694)

## v0.3.1 (2026-11-24)

### Changed
- Slash command menu matches by substring, not only prefix — `/rele` now finds `/skill:release` (20590bc)
- Kanban tabs render leftmost in the tab bar, before session tabs (719d47c)
- Advanced-feature descriptions in Settings moved into hover tooltips (18f2d0c)
- README: kanban board screenshots (ad5ff33)

### Fix
- Loop "exact count" ran one extra iteration (e19e9b3)
- Context breakdown popover could overflow the viewport near the left edge (3d44a21)
- Kanban CAS retry budget raised to 10 attempts with wider jitter — parallel agent mutations on one board no longer exhaust retries under load (4ec2a30)

## v0.3.0 (2026-11-23)

### Added
- Kanban boards: full kanban system — boards panel in right rail, card DnD, card modal (scoped to its board tab) with properties rail and activity feed, column/card menus, comments with images and clickable session/commit chips, workflow editor (abe382a, 27bc4db, f02d450, b66cdec, 9beaccb, befaa04, 0c30d94, 8d66136)
- Kanban agent tools: card, column and workflow tools; pick_task/get_card return comments and card image attachments; board name is included in kanban prompts and loop exit conditions only when the project has multiple boards (38c6a02, 7098670, 9d272ff, dade08a, 9f91e3e, b7d5fac)
- Kanban durability: cross-process board file locking, atomic writes with fsync, corrupt-file quarantine, stale-rev UI guard (c39b2b3, 1a33a0c)
- Kanban board themes: 4 built-in themes, Appearance theme manager, import/export JSON (41dcaf6, e9c39ea, 6c43e0d)
- Search Everywhere overlay on double Shift (edb3a74)
- Loop: sync worktree branch before iteration spawn (5638543), copy model and thinking level to spawned session (ad72da7), optional exit condition (9b84a47), close-parent-session setting (03be3f9), "Loop completed" Telegram notification (7a93671)
- Chat feed: live tok/s during streaming (35c8e3f, 59a4f1b), per-bucket context token breakdown popover (5da40fd), turn timer with live ticker (1dc2b0f), copy button on code blocks (1daaabd, 89a5948), view-diff button for write tool blocks (82240a7), full command shown when expanding tool blocks (28de2f6)
- Terminal: cmd profile, copy selection to clipboard (21231a6)
- Sessions: history search (d5ed11b), rename via modal dialog (829392a), MRU tab restore + Ctrl+Tab switcher (5e6026c), type icons on workspace tabs (a00a91e), new-session/new-worktree buttons in tab bar (85f26a8)
- Projects sidebar: resize and collapse (12b82f2), active project highlight (9e55ce2)
- Remote: static PIN setting (f590b74), WS server start retry with backoff and Retry button (cbcf541), web UI follows app language (4b10568)
- Open file tabs from chat links (22ef357)
- Launch minimized via --minimized flag or PIWRIGHT_MINIMIZED=1 (118be07)

### Changed
- Feed virtualization: fixed-size virtual window reuses DOM entries for long sessions (19c255c)
- TTFB metric renamed to TTFT across UI and tests (bf2aa9b)
- Shiki switched to JS-regex engine — wasm blocked by CSP in built app (ad632be)

### Fix
- Terminal: Ctrl+C and Ctrl+V sent wrong characters on non-Latin keyboard layouts (b342b16, 5c04ed4)
- Terminal lost on project switch; WSL terminal spawn failed silently (5421ff2, 9f899cb)
- Images in markdown live preview not rendering (28ae72f)
- Feed: restored long sessions had broken scrollbar and blank viewport (e17e432)
- Sessions: tool-call markup leaked into generated titles (50b6854); history not refreshed after manual close (3b31ebd); loop auto-closed session missing from history (c2ee253)
- Thinking level reset to default after model switch at session start (c65c185)
- Remote: phone-created sessions not shared, unshare from phone broken (cc6b851)
- Updater 404 caused by spaces in installer artifact name (44d233a); updater fell back to default feed when updateUrl empty (452a449)

## v0.2.0 (2026-11-22)

### Added
- Project tabs for sessions, files, diffs, MCP and skills (`2fefa4d`)
- Built-in `/loop`: agent iterations, exit condition via harness-check, `loop_stop` tool, stuck-turn watchdog, loop flags in session names and icons, settings toggle + remote UI (`515e945`, `d6bd9f7`, `9e27bd2`, `912e9a8`, `25adb80`, `c1d841c`, `46bbf44`, `4a23be5`, `1607332`, `8a55394`)
- Git Log dock in PHPStorm style: branch graph, history pagination, strict dock exclusivity (`bcde8b4`, `13b8959`)
- Prompt editing with session fork (Rewind port from jb-pi), fork after any agent reply — action buttons sit below messages, always visible (`a503266`, `9907beb`, `8bd33bf`)
- Image attachments in the composer (DeepSeek-style) and image viewing in the file browser tab (`2dc5af4`, `8dd1edc`)
- File context menu: delete/refresh/new folder-file, rename, copy path, add to chat context; shared confirmation dialog; "Refresh tree" button (`0e6db75`, `e5dcccb`, `38f13f3`, `59d462f`)
- Slash-command autocomplete in the composer (`0a462f7`, `f771904`, `2e882f4`)
- Thinking level slider instead of select (`e8dae8e`)
- Terminal: PHPStorm-style header, project from active tabs instead of active session (`a4911a1`, `5bb16c7`)
- "Waiting for subagents" status (`72574ec`)
- Settings as a modal dialog instead of full-screen view (`b661797`, `cb3fe34`)
- Full command shown when expanding a single-line tool block (`9c65c86`)
- Task checkboxes clickable in the markdown viewer (`1d23a55`)
- Markdown list continuation on Enter in the live editor (`2151a50`)
- settings.json.bak backup before every write (`83b94ac`)
- `rename_session` tool — agent names its own session, the name survives history restore (`3ef8af1`, `4590618`)
- App version in the session panel footer (`d4aefa9`)
- Remembering last model and thinking level for new sessions (`8f8f87a`)
- Closing worktree sessions before `git worktree remove` + cleanup prompt when closing the last one (`17df113`)

### Removed
- Inline git history in the panel — replaced by the Git Log dock (`13b8959`)

### Changed
- Long session history restore: replay in a single batch + window with lazy tail-forward loading (`867f771`)
- Remaining setting labels and values translated to Russian (`1e8c28e`)

### Fix
- Prompt draft stored per-session, including in remote UI (`76b95a0`, `c44b74f`)
- Duplicate turn_end/notifications after subagent turns (`de0b687`, `db3501b`)
- Remote: snapshot reads messages from get_messages, feed survives page reload; yellow tab dot only from real dialogs (`8077bbb`, `892d980`, `d020b2f`)
- Diff overlapped the tab bar (`ac5f910`)
- Status dots squashed by long titles (`a600ca3`)
- Thinking level status pushed before pi start (`1f3d287`)
- Branch list no longer disappears when opening submenu (`f5eb44f`)
- Renaming edits the clicked session, not the active one (`9977dea`)
- `realpathSync.native` for 8.3 short paths in tests (`9c7ef15`)

## v0.1.1 (2026-11-21)

### Added
- Chat with the pi agent: markdown rendering with thinking and tool blocks (collapsible, nested, single-line mode), image paste and file attachments, todo widget panel, LSP status chips, context-percentage indicator with cache tooltip, sticky scroll, hide-tools toggle, theme and chat font size settings, soft-wrap (db336c0, 5264c48, 359b7ad, 553ab36)
- Sessions panel: live status dots (pulsing blue while streaming, yellow when an answer is needed), session rename, history restore on close and delete from disk, LLM-generated 2–3 word session titles (e473b40, 249524c, 3c0c5d8, 06cd066)
- Model and thinking-level pickers available before the first prompt; Steer button and prompt queue panel with per-item remove (c85d92e, 5769651)
- Backends: native Windows and WSL with per-backend pi paths; settings screen with General/Models tabs and autosave (7adc337, a87c1a1)
- Git panel: backend-side git CLI, Monaco diff overlay, AI commit message generation, branch select and create (12070af, 553ab36)
- File browser: lazy tree panel, tabbed Monaco viewer and editor, live file watching, file links in tool blocks open tabs, file names colored by git status (4685f4e, 4ca43c2)
- Obsidian-style live preview for markdown files with editing (f6dc95d)
- Terminal: node-pty panel with xterm.js tabs, PowerShell/cmd/WSL profiles, bottom dock mode, tab rename with persistence (3fd1370, 9fac5a1, 8256a28)
- Remote mode: control PiWright from a phone browser — full remote bridge, dialog answers synced between PC and phone, unread indicators, configurable port (c26339a, e8d2025, 2bcf132)
- Notifications: sounds and Telegram notifications with a per-session toggle (c26339a, 8256a28)
- MCP servers and Skills panels (c26339a)
- Worktree sessions (2bcf132)
- ask_question dialog with a note field (04f2dc7)
- Localization: English and Russian UI (9fac5a1)
- Packaging: NSIS installer, auto-update via the GitHub Releases feed, release CI workflow on tags, app icon, dark splash, window size and maximized state persistence (65b409b, 5c7aabe, 460c0d3, 583fd22, 7f56dd3, 93b4471, 6c7a84c)
