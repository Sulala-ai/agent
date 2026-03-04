---
name: figma
description: Use Figma (files, projects) via the Portal. When the user asks about Figma files or designs, list connections with list_integrations_connections (provider figma) and use run_command with curl to the Figma API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "🎨",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Figma

1. **list_integrations_connections** with `provider: "figma"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` (or `X-Figma-Token` per Figma docs).

Base URL: `https://api.figma.com/v1`. Add `api.figma.com` to **ALLOWED_CURL_HOSTS**. Official docs: https://www.figma.com/developers/api

---

## Files and projects

- **Get file** (document structure, nodes): `GET https://api.figma.com/v1/files/<file_key>`. Returns document tree, pages, frames. `file_key` is the ID from the Figma file URL.
- **Get file nodes** (specific nodes): `GET https://api.figma.com/v1/files/<file_key>/nodes?ids=<node_id1>,<node_id2>`.
- **Get projects** (team): `GET https://api.figma.com/v1/teams/<team_id>/projects`. Returns `projects[].id`, `name`. Get `team_id` from user or from project response.
- **Get project files**: `GET https://api.figma.com/v1/projects/<project_id>/files`. Returns `files[].key`, `name`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Figma in the Portal. File/project must be accessible to the connected account.
