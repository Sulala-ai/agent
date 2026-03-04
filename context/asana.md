---
name: asana
description: Use Asana (workspaces, projects, tasks) via the Portal. When the user asks about Asana tasks or projects, list connections with list_integrations_connections (provider asana) and use run_command with curl to the Asana API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "✅",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Asana

1. **list_integrations_connections** with `provider: "asana"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` and `Content-Type: application/json`.

Base URL: `https://app.asana.com/api/1.0`. Add `app.asana.com` to **ALLOWED_CURL_HOSTS**. Official docs: https://developers.asana.com/reference/rest-api-reference

---

## Workspaces and projects

- **List workspaces**: `GET https://app.asana.com/api/1.0/workspaces`. Returns `data[].gid`, `data[].name`.
- **List projects** (in workspace): `GET https://app.asana.com/api/1.0/workspaces/<workspace_gid>/projects`. Returns `data[].gid`, `data[].name`.

---

## Tasks

- **List tasks** (in project): `GET https://app.asana.com/api/1.0/projects/<project_gid>/tasks?opt_fields=name,completed,due_on,notes`. Returns `data[].gid`, `data[].name`, etc. Pagination: `offset`, `limit`.
- **Create task**: `POST https://app.asana.com/api/1.0/tasks` with header `Content-Type: application/json` and body `{"data": {"name": "Task title", "projects": ["<project_gid>"]}}`. The `projects` value must be an array of one or more project GID **strings** from `GET /workspaces/<workspace_gid>/projects` (e.g. `["1213334948480995"]`). Do **not** send `workspace` when sending `projects`—the API will error. Optional in `data`: `"notes": "Description"`, `"due_on": "YYYY-MM-DD"`. Flow: (1) GET `/workspaces` → pick a workspace `gid`, (2) GET `/workspaces/<workspace_gid>/projects` → pick a project `gid`, (3) POST `/tasks` with `{"data": {"name": "fix bug today", "projects": ["<project_gid>"]}}`.
- **Get task**: `GET https://app.asana.com/api/1.0/tasks/<task_gid>?opt_fields=name,completed,notes,due_on,projects`.
- **Update task** (mark complete, etc.): `PUT https://app.asana.com/api/1.0/tasks/<task_gid>` with body `{"data": {"completed": true}}` or `{"data": {"name": "New name"}}`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Asana in the Portal.
