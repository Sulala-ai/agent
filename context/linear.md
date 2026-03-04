---
name: linear
description: Use Linear (teams, issues) via the Portal. When the user asks about Linear teams or issues, list connections with list_integrations_connections (provider linear) and use run_command with curl to the Linear API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "📋",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Linear

**Creating an issue:** First run the teams query to get a real team `id` (UUID). Then POST the issue with body `{"query": "mutation ... $teamId $title $description ...", "variables": {"teamId": "<from teams>", "title": "...", "description": "..."}}`. Never embed title or description in the query string—use variables only.

1. **list_integrations_connections** with `provider: "linear"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** to `POST https://api.linear.app/graphql` with `Authorization: Bearer <accessToken>`, `Content-Type: application/json`, and body `{"query": "<GraphQL>", "variables": {...}}`. Use **variables** for any user-provided text (title, description) so quotes and newlines do not break the query.

Add `api.linear.app` to **ALLOWED_CURL_HOSTS**. Official docs: https://developers.linear.app/docs/graphql

---

## Teams

- **List teams**: Query `query { teams { nodes { id name key } } }`. Returns `data.teams.nodes`.

---

## Issues

- **List issues** (filter by team or assignee): `query { issues(first: 20, filter: { team: { key: { eq: "ENG" } } }) { nodes { id identifier title state { name } assignee { name } } } }`. Or use `filter: { assignee: { id: { eq: "<userId>" } } }`.

- **Create issue** — you must do two steps. **Step 1:** Get a real team ID by sending a POST to `https://api.linear.app/graphql` with body `{"query":"query { teams { nodes { id name key } } }"}`. Use one of the returned `nodes[].id` values (UUID format like `23f232c2-7a1c-407e-8e6c-3c75bdfd0d41`). **Step 2:** Create the issue by POSTing to the same URL with a body that has **two keys only**: `query` (a mutation that uses variables, no literal title/description) and `variables` (JSON with the actual teamId, title, description). Do **not** put title or description inside the query string—that causes "Syntax Error: Unexpected }". Use this exact shape:
  - Body: `{"query": "mutation IssueCreate($teamId: String!, $title: String!, $description: String) { issueCreate(input: { teamId: $teamId, title: $title, description: $description }) { success issue { id identifier url } } }", "variables": {"teamId": "<paste the team id from step 1>", "title": "Test Issue", "description": "Optional description"}}`
  - The `query` string must contain only `$teamId`, `$title`, `$description`—no quoted literals for those. The `variables` object holds the real values.
- **Update issue** (e.g. state, assignee): `mutation { issueUpdate(id: "<issueId>", input: { stateId: "<stateId>" }) { success issue { id state { name } } } }`. List states with `query { workflowStates(filter: { team: { id: { eq: "<teamId>" } } }) { nodes { id name } } }`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Linear in the Portal.
