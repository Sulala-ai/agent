# Skills config: which file is used, how it’s read and written

Sulala has **no database** for skill config. A single JSON file holds `skills.entries` (enable/disable and per-skill options like Bluesky handle/apiKey). Here’s how that file is chosen and how read/write work.

**Folder creation:** The fixed folder under home is `.sulala`. There is no dedicated “create .sulala” routine. The folder is created when something first writes under it: `saveFullConfig()` / `loadFullConfig()` (in `src/agent/skills-config.ts`) call `mkdirSync(dirname(path), { recursive: true })` before writing the config file, so `~/.sulala` (or project `.sulala`) is created on first save.

---

## 1. Which config file is used

**Path resolution** (`src/agent/skills-config.ts` → `getConfigPath()`):

| Priority | Condition | Path used |
|----------|-----------|-----------|
| 1 | `SULALA_CONFIG_PATH` is set | That path; `~` is expanded to your home dir in code (`.env` has no shell, so we expand it). |
| 2 | `.sulala/config.json` **exists** in the current working directory | `join(cwd(), '.sulala', 'config.json')` |
| 3 | Otherwise | `~/.sulala/config.json` |

So by default Sulala uses a global config under your home directory. It uses a file **inside this project** only if:

- You create `.sulala/config.json` in the project and run the process from that directory (e.g. `npm run dev` from the project root), or  
- You set `SULALA_CONFIG_PATH` to that file.

**Using a config file in your project**

- **Automatic:** Create `.sulala/config.json` in the project. When you start the server from the project root, `cwd()` is the project dir, so that file is used if it exists.
- **Explicit (any path):**
  ```bash
  # Absolute path
  export SULALA_CONFIG_PATH="/Users/saiko/schedra/sulala_agent/.sulala/config.json"

  # Or from project root
  export SULALA_CONFIG_PATH="$(pwd)/.sulala/config.json"
  npm run dev
  ```
  Then all read and write go to that same file.

---

## 2. How the JSON file is read

- **Entry:** `loadSkillsConfig()` (and `loadFullConfig()` for the full JSON).
- **Flow:**
  1. Resolve path via `getConfigPath()` (see above).
  2. If the path doesn’t exist: create the directory, write `{}`, return empty config.
  3. Otherwise: `fs.readFileSync(path, 'utf8')` → `JSON.parse()` → return `data.skills` (or full object for `loadFullConfig`).
- **Cache:** Result is cached and invalidated when the file’s **mtime** changes, so edits on disk (or from another process) are picked up on the next read. No DB; that one JSON file is the store.

---

## 3. How the JSON file is written

- **Entry:** `saveSkillsConfig(cfg)` (used by the gateway’s `PUT /api/agent/skills/config` and by `setSkillEnabled()`).
- **Flow:**
  1. Same path as read: `getConfigPath()` again (so same env / same cwd).
  2. Load current full config: `loadFullConfig()`.
  3. Set `full.skills = cfg`, then write: `fs.writeFileSync(path, JSON.stringify(full, null, 2), 'utf8')`.
  4. Create parent directory with `mkdirSync(dirname(path), { recursive: true })` if needed.
  5. Invalidate cache so the next read sees the new content.

So **writing** goes to the same path that was used for read. If that path is in your project (e.g. `.sulala/config.json` or a path set by `SULALA_CONFIG_PATH`), that’s the file that gets written.

---

## 4. Summary

| Question | Answer |
|----------|--------|
| Where is the config? | One JSON file; path from `SULALA_CONFIG_PATH`, or `.sulala/config.json` in cwd if it exists, else `~/.sulala/config.json`. |
| Read from “this project”? | Yes if you create `.sulala/config.json` in the project and run from that directory, or set `SULALA_CONFIG_PATH` to that file. |
| Write to “this project”? | Same: `saveSkillsConfig()` writes to the same path. No DB. |
| How is the path chosen? | `getConfigPath()`: env → existing file in cwd → homedir default. |

To read and write the JSON file **from this project**, either create `.sulala/config.json` in the project and run the server from the project root, or set `SULALA_CONFIG_PATH` to that project file. Then `loadSkillsConfig()` and `saveSkillsConfig()` both use that path.
