---
name: git
description: Basic Git operations via run_command. Use when the user asks to check status, diff, log, branch, or perform simple git commands.
metadata:
  {
    "sulala": {
      "requires": { "bins": ["git"] }
    }
  }
---

# Git operations

Use **run_command** with `binary: "git"` and appropriate args. Add `git` to ALLOWED_BINARIES.

## Status and diff

- `git status`
- `git diff`
- `git diff --staged`
- `git log -n 10 --oneline`

## Branches

- `git branch`
- `git branch -a`
- `git checkout -b new-branch`

## Info

- `git show HEAD:path/to/file` — show file at HEAD
- `git rev-parse --abbrev-ref HEAD` — current branch name

## Limits

- Do not run destructive commands (reset --hard, push --force) without explicit user confirmation.
- Prefer read-only commands when the user only asks to inspect.
