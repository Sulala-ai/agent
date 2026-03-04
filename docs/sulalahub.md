# SulalaHub

SulalaHub is a built-in skills registry served by the Sulala gateway. It lets you share skills from a running instance without needing an external registry server.

## How it works

When the gateway runs, it exposes:

- **`GET /api/sulalahub/registry`** — Returns the skills index with `url` pointing to each skill’s content.
- **`GET /api/sulalahub/skills/:slug`** — Returns the raw `.md` content for a skill (from `registry/<slug>.md`).

To use SulalaHub as the registry for another instance:

```bash
SKILLS_REGISTRY_URL=http://localhost:2026/api/sulalahub/registry
```

Then `sulala skill install <slug>` will fetch the registry from that URL and the skill content from the `url` field (e.g. `http://localhost:2026/api/sulalahub/skills/apple-notes`).

## Setup

1. Run the Sulala gateway.
2. Add skills to `registry/skills-registry.json` and `registry/<slug>.md` (see [skills-authoring.md](./skills-authoring.md)).
3. Set `SULALAHUB_BASE_URL` in `.env` if the gateway is behind a proxy or uses a different host/port:

```bash
SULALAHUB_BASE_URL=https://your-sulalahub.example.com
```

If omitted, the base URL defaults to `http://<HOST>:<PORT>`.

## Publishing skills

1. Add an entry to `registry/skills-registry.json`:

```json
{ "slug": "my-skill", "name": "My Skill", "description": "Does X. Use when...", "version": "1.0.0" }
```

2. Create `registry/my-skill.md` with the skill content (SKILL.md format).

3. Restart or reload the gateway. The skill will be available at `/api/sulalahub/skills/my-skill`.
