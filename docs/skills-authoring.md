# Skills Authoring Guide

Skills are documentation-only Markdown files that teach the agent how to use tools. No per-skill code—only generic tools (`run_command`, `read_file`, `run_task`) plus clear instructions in the skill body.

## Format

Skills are `.md` files with YAML frontmatter. At minimum:

```yaml
---
name: my-skill
description: One-line summary of when to use this skill.
---
```

### Required frontmatter

- **name** — Unique identifier; used for precedence, config, and registry.
- **description** — Shown in the "Available skills" list so the agent knows when to apply the skill.

### Optional frontmatter

- **metadata** — JSON object; supports `sulala.requires.bins` for load-time gating:

```yaml
---
name: git
description: Git operations
metadata:
  {
    "sulala": {
      "requires": { "bins": ["git"] }
    }
  }
---
```

- **homepage** — URL for docs (optional).
- **version** — Semver string for registry (optional).

## Skill body

The body is Markdown. It should explain:

1. **When to use** — Match the description; clarify edge cases.
2. **How to use** — Which commands to run (binary + args).
3. **Limits** — What the agent must not do; tools that need `ALLOWED_BINARIES`.

### Example structure

```markdown
# Skill Name

Use when the user asks for X, Y, or Z.

## Setup

- Required binaries: `foo`, `bar` (add to ALLOWED_BINARIES).
- Required env: `FOO_API_KEY`.

## Commands

- **List:** `run_command` with `binary: "foo"`, `args: ["list"]`
- **Create:** `run_command` with `binary: "foo"`, `args: ["create", "--name", "X"]`

## Limits

- Do not run destructive commands without explicit confirmation.
```

## Adding to the registry

1. Add `registry/<slug>.md` with the full skill content.
2. Add an entry to `registry/skills-registry.json`:

```json
{
  "skills": [
    {
      "slug": "my-skill",
      "name": "my-skill",
      "description": "One-line description.",
      "version": "1.0.0",
      "url": "https://..."
    }
  ]
}
```

- **slug** — File name (without `.md`); used for install/update.
- **url** — Optional; if set, content is fetched from this URL instead of local file.

## Validation

Run `npm test` to validate skills. The `validateSkillContent` function checks:

- Presence of `name` and `description`
- Valid frontmatter
- Optional `metadata.sulala.requires.bins` parsing

## Precedence

Skills load from (highest to lowest):

1. **User** (`~/.sulala/workspace/skills/<name>/SKILL.md`) — directory-per-skill; safe from project updates
2. Workspace (`AGENT_CONTEXT_PATH`)
3. Managed (`~/.sulala/skills`) — flat `.md` files
4. Bundled (`context/`)
5. Plugin (`plugins/*/skills`)
6. Extra (`SKILLS_EXTRA_DIRS`)

On name conflict, the higher source wins. To create a skill that won't be overwritten on project updates, use `~/.sulala/workspace/skills/<slug>/SKILL.md`. Refresh skills or restart the gateway to pick it up.
