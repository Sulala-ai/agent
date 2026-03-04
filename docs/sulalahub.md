# SulalaHub

The agent does not ship a local registry. Use a hub (e.g. the [SulalaHub store](https://github.com/schedra/sulala)) and set **`SKILLS_REGISTRY_URL`** to list and install skills.

## How it works

1. Set `SKILLS_REGISTRY_URL` in your agent `.env` to your hub’s registry endpoint:

```bash
SKILLS_REGISTRY_URL=https://hub.sulala.ai/api/sulalahub/registry
```

2. Then `sulala skill install <slug>` (or the dashboard) fetches the skill list from that URL and each skill’s content from the `url` field in the registry (e.g. `https://hub.sulala.ai/api/sulalahub/skills/apple-notes`).

## Gateway endpoints (optional)

The agent gateway still exposes SulalaHub-style endpoints for instances that serve registry data (e.g. a separate hub app). Without a local registry, they return an empty list:

- **`GET /api/sulalahub/registry`** — Returns the skills index with `url` for each skill.
- **`GET /api/sulalahub/skills/:slug`** — Returns the raw `.md` content for a skill.

To publish and serve skills, use the **store** app: add skills to `store/data/registry.json` and `store/data/skills/<slug>.md`, then deploy the store and point `SKILLS_REGISTRY_URL` at it. See the store README for sync and deployment.
