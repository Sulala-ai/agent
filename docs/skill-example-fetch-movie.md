# Example: fetch-movie skill (correct format with metadata)

This page shows **two patterns** for authoring skills:

1. **API-key APIs** (this example) — use an env var (e.g. `TMDB_ACCESS_TOKEN`) and `run_command` with curl. User sets the token in Skills → config or `.env`.
2. **Own OAuth (e.g. Gmail)** — document env vars (e.g. `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`) in the skill; user sets them in Skills → config. The skill instructs the agent to use `run_command` with curl and the token from env. See the Gmail skill in the hub for the full flow.

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

For **own OAuth** skills (Gmail, etc.), see the Gmail skill: user sets `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and after the first auth flow `GMAIL_REFRESH_TOKEN` in Skills → config; the skill doc describes building the auth URL, exchanging the code, and using `run_command` with curl against the provider API.
