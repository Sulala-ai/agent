---
name: create-skill
description: Create a new Sulala skill when the user asks for one. Use write_file to create the .md file. Use when the user asks to create, add, or write a skill.
---

# Create Sulala Skill

When the user asks to create a skill (e.g. "create a skill for X", "add a skill that does Y"), create it using **write_file**. Infer the skill from the request; ask only if critical details are missing.

## Skill format

Every Sulala skill is a `.md` file with YAML frontmatter and a markdown body:

```markdown
---
name: slug-or-name
description: One-line summary of when to use this skill. Include trigger terms.
---
# Skill Title

Use when the user asks for X, Y, or Z.

## How to use
- Commands, steps, or run_command examples
## Limits
- What not to do
```

**Required frontmatter:** `name` (slug, lowercase-hyphens), `description` (third person, includes WHAT and WHEN).

**Required when the skill uses run_command or external APIs:** `metadata` with `sulala.requires`:
- **bins** — list of CLI tools (e.g. `["curl", "jq"]`). Add these to ALLOWED_BINARIES. Always include if the skill uses run_command.
- **env** — list of required env var names for API keys (e.g. `["TMDB_ACCESS_TOKEN"]`). Users configure these in Skills config.

```yaml
metadata:
  {
    "sulala": {
      "requires": {
        "bins": ["curl"],
        "env": ["TMDB_ACCESS_TOKEN"]
      }
    }
  }
```

## Where to write

Use the **SKILL.md flow** (direct skill directory, not packaged .skill):

1. **Use the path from the Workspace section:** In "## Context" → **## Workspace**, the prompt gives **Your skill output directory**. Use that path with write_file: `<that-directory>/<slug>/SKILL.md`. It is already resolved for the current OS. Do **not** use `~` or `$HOME`; the tool does not expand them and would create a literal folder under the project.
2. Add `SKILL.md` with YAML frontmatter (`name`, `description`) and instructions.
3. Add any `scripts/`, `references/`, or `assets/` under that folder if needed.
4. Do **not** create skills under the project folder (e.g. `context/`) — they will be overwritten on project updates.

If write_file cannot write to the path from the Workspace section (e.g. permission or workspace root restriction), tell the user: "Create the skill at [that path], then refresh skills or restart the gateway."

## Steps

1. Infer purpose and name from the user's request.
2. Draft frontmatter (name, description) and body (when to use, how to use, limits).
3. Call **write_file** with `path` = the skill output directory from **## Workspace** + `/<slug>/SKILL.md` (e.g. `/Users/you/.sulala/workspace/skills/<slug>/SKILL.md`). Create the directory if needed.
4. Confirm: "Created skill at [path]. Refresh skills or restart the gateway to load it."

## Example (API skill with metadata)

User: "Create a skill that fetches movie data from TMDB"

Include **metadata** with `bins` (curl) and `env` (API key). Use write_file with the path from **## Workspace** + `/fetch-movie/SKILL.md`:

```markdown
---
name: fetch-movie
description: Fetch movies using TMDB API via curl. Use when the user asks for movie details or to search movies by title.
metadata:
  {
    "sulala": {
      "requires": {
        "bins": ["curl"],
        "env": ["TMDB_ACCESS_TOKEN"]
      }
    }
  }
---

# Fetch Movie

Use **run_command** with `curl` to get movie data from The Movie Database (TMDB) API. Add `curl` to ALLOWED_BINARIES. Store your TMDB API token in Skills config as `TMDB_ACCESS_TOKEN`.

## TMDB Search API

- **Search:** `curl -s -H "Authorization: Bearer $TMDB_ACCESS_TOKEN" "https://api.themoviedb.org/3/search/movie?query=QUERY"`

## Limits

- Do not expose the token in responses. Use the env var in run_command.
```

## Example (stock price)

User: "Create a skill that fetches stock prices"

Use write_file with the path from **## Workspace** + `/stock-price/SKILL.md`:

```markdown
---
name: stock-price
description: Fetches stock prices via API. Use when the user asks for stock quotes, share price, or market data.
---

# Stock Price

Use **run_command** with `curl` to call a stock API. Add `curl` to ALLOWED_BINARIES.

## Alpha Vantage (requires API key)

    curl -s "https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=$ALPHA_VANTAGE_API_KEY"

## Limits

- Do not share API keys in responses.
```

## Tips

- Description: third person, specific, include trigger terms. Example: "Fetches weather for a city. Use when the user asks for weather, temperature, or forecast."
- Body: concise; if the skill uses run_command, say which binaries and add to ALLOWED_BINARIES.
- Slug: lowercase, hyphens only (e.g. `my-new-skill`).
