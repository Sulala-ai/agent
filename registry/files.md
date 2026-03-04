---
name: files
description: Basic file operations via run_command. Use when the user asks to list files, show file contents, search within files, or inspect directories.
metadata:
  {
    "sulala": {
      "requires": { "bins": [] }
    }
  }
---

# File operations

Use **run_command** with common shell tools to read and inspect files. Add required binaries to ALLOWED_BINARIES (e.g. ls, cat, head, tail, wc, grep, find).

## List files

- `ls` — list directory contents
- `ls -la` — long format with hidden files

## Read files

- `cat path/to/file` — output entire file
- `head -n 20 path/to/file` — first 20 lines
- `tail -n 50 path/to/file` — last 50 lines

## Search

- `grep -r "pattern" path/` — search in files recursively
- `find path -name "*.md"` — find files by name
