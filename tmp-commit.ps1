[IO.File]::WriteAllText('D:\Projects\piwright\.git\COMMIT_MSG', @"
feat(search): Search Everywhere overlay on double Shift

PHPStorm-style double-Shift search across the current project: files,
sessions and kanban cards in one fuzzy-filtered list (max 20 items),
each kind with its own icon, matched chars highlighted.

- files:search IPC — flat recursive project walk (skips dot-dirs,
  node_modules/dist/out/build/coverage/venv/__pycache__, cap 3000)
- fuzzy subsequence scorer in renderer lib with tests
- empty query shows recent sessions and cards by recency
- Enter/click opens file tab, session, or kanban card modal
- smoke scripts: tests/manual/smoke-search-everywhere*.cjs
"@, [Text.UTF8Encoding]::new($false))
git add -A
git commit -F .git\COMMIT_MSG
git log --oneline -1