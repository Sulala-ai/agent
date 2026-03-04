---
name: apple-notes
description: Manage Apple Notes via the `memo` CLI on macOS. Use when the user asks to add a note, list notes, search notes, or manage note folders.
homepage: https://github.com/antoniorodr/memo
metadata:
  {
    "sulala":
      {
        "emoji": "📝",
        "os": ["darwin"],
        "requires": { "bins": ["memo"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "antoniorodr/memo/memo",
              "bins": ["memo"],
              "label": "Install memo via Homebrew",
            },
          ],
      },
  }
---

# Apple Notes CLI

Use `memo notes` to manage Apple Notes directly from the terminal. Create, view, edit, delete, search, move notes between folders, and export to HTML/Markdown.

Setup

- Install (Homebrew): `brew tap antoniorodr/memo && brew install antoniorodr/memo/memo`
- Manual (pip): `pip install .` (after cloning the repo)
- macOS-only; if prompted, grant Automation access to Notes.app.

View Notes

- List all notes: `memo notes`
- Filter by folder: `memo notes -f "Folder Name"`
- Search notes (fuzzy): `memo notes -s "query"`

Create Notes

- **Add a note (prefer AppleScript):** For "add a note titled X", use **run_command** with `binary: "osascript"` and the AppleScript in the section below. Do not use memo for non-interactive add.
- Add via memo (interactive only): `memo notes -a -f "FolderName"` — **requires** `-f` (folder). Opens the user's editor; memo does **not** accept title or body as arguments. Use only as fallback if osascript is unavailable.

Edit Notes

- Edit existing note: `memo notes -e`
  - Interactive selection of note to edit.

Delete Notes

- Delete a note: `memo notes -d`
  - Interactive selection of note to delete.

Move Notes

- Move note to folder: `memo notes -m`
  - Interactive selection of note and destination folder.

Export Notes

- Export to HTML/Markdown: `memo notes -ex`
  - Exports selected note; uses Mistune for markdown processing.

Limitations

- Cannot edit notes containing images or attachments.
- Interactive prompts may require terminal access.

Notes

- macOS-only.
- Requires Apple Notes.app to be accessible.
- For automation, grant permissions in System Settings > Privacy & Security > Automation.

---

## When the user asks you to add a note

Your goal is to get the note into Apple Notes. Use **run_command** only (no skill-specific tools). Add osascript and memo to ALLOWED_BINARIES.

**Prefer AppleScript for "add a note titled X".** Use the osascript one-liner below so the agent creates the note in one shot instead of trying memo (which is interactive and does not accept title as an argument).

1. **Adding a note directly (macOS)**
   - Use **run_command** with `binary: "osascript"` and one `-e` argument containing this AppleScript. Replace TITLE and BODY with the user's note title and optional body; escape any double-quote in TITLE or BODY as backslash-quote (`\"`).
   - Script (use `\n` for newlines in the string you pass):
     `tell application "Notes"\ntell account "iCloud"\ntell folder "Notes"\nmake new note with properties {name:"TITLE", body:"BODY"}\nend tell\nend tell\nend tell`
   - Example for "add apple note called buy saisai": args = `["-e", "tell application \"Notes\"\ntell account \"iCloud\"\ntell folder \"Notes\"\nmake new note with properties {name:\"buy saisai\", body:\"\"}\nend tell\nend tell\nend tell"]`
   - On success, confirm: "Done — I added an Apple Note titled \"…\"."
   - If osascript is not in ALLOWED_BINARIES or the command errors: give the user the note text and steps to run `memo notes -a -f "Notes"` in the terminal and paste the content when the editor opens.

2. **List and search**
   - **run_command** with `binary: "memo"`, `args: ["notes"]` for list; `args: ["notes", "-s", "query"]` for search.

3. **Do not**
   - Do not use run_command with memo `["notes", "-a", "title"]`; memo rejects extra arguments.
   - Do not leave the user without a path to success: either add via osascript (run_command) or give text + steps for memo notes -a, or explain why (e.g. add osascript to ALLOWED_BINARIES).
