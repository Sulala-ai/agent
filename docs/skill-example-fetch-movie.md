# Example: fetch-movie skill (correct format with metadata)

This page shows **two patterns** for authoring skills:

1. **API-key APIs** (this example) — use an env var (e.g. `TMDB_ACCESS_TOKEN`) and `run_command` with curl. User sets the token in Skills → config or `.env`.
2. **Sulala integrations (Portal)** — use `list_integrations_connections` and `get_connection_token`; no API key in the skill. User connects the app in the Portal/dashboard. See [Integration example](#integration-example-gmail-style) below and `context/portal-integrations.md`, `context/gmail.md`.

---

## Example 1: API-key API (fetch-movie)

Copy the block below to `~/.sulala/workspace/skills/fetch-movie/SKILL.md` to replace the existing skill. It includes the required **metadata** (`bins`, `env`) so the dashboard shows "blocked" until curl is allowed and the token is set.

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

Use **run_command** with `curl` to get movie data from The Movie Database (TMDB) API. Add `curl` to ALLOWED_BINARIES. Store your TMDB API token in the dashboard under Skills → config for this skill as `TMDB_ACCESS_TOKEN`.

## TMDB Search API

### Search movies by title

Use run_command with binary `curl` and args (e.g. `-s`, `-H`, `"Authorization: Bearer $TMDB_ACCESS_TOKEN"`, URL). Example:

- **Search:** `https://api.themoviedb.org/3/search/movie?query=QUERY` with header `Authorization: Bearer $TMDB_ACCESS_TOKEN`

## Limits

- Do not expose the API token in responses. Use the env var in run_command.
- Add `curl` to ALLOWED_BINARIES if not already present.
```

Then in the dashboard: Skills → fetch-movie → set `TMDB_ACCESS_TOKEN`, and ensure `curl` is in ALLOWED_BINARIES.

---

## Integration example (Gmail-style)

If your skill uses a **Sulala/Portal-connected app** (Gmail, Calendar, Slack, GitHub, etc.), the user does **not** set an API key in the skill. They connect the app in the Portal (or dashboard → Integrations). The skill instructs the agent to:

1. Call **list_integrations_connections** with `provider: "<name>"` (e.g. `"gmail"`, `"calendar"`) to get `connection_id`.
2. Call **get_connection_token** with that `connection_id` to get an OAuth `accessToken`.
3. Use **run_command** with `curl` to call the provider API, with header `Authorization: Bearer <accessToken>`.

**Frontmatter** for an integration skill typically only requires `bins: ["curl"]` (no `env` for the provider token). Example:

```markdown
---
name: my-integration
description: Use MyApp via the Portal. When the user asks about X, list connections with list_integrations_connections (provider myapp) and use run_command + curl.
metadata:
  { "sulala": { "requires": { "bins": ["curl"] } } }
---
# My integration
1. **list_integrations_connections** with `provider: "myapp"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → get `accessToken`.
3. **run_command (curl)** — call the provider API with `Authorization: Bearer <accessToken>`. Add required hosts to ALLOWED_CURL_HOSTS.
```

See **context/portal-integrations.md** and **context/gmail.md** (or calendar.md, slack.md) for full integration skill examples.
