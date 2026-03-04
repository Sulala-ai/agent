---
name: jira
description: Use Jira (sites, issues, transitions) via the Portal. When the user asks about Jira issues or projects, list connections with list_integrations_connections (provider jira) and use run_command with curl to the Jira API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "🔧",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Jira

1. **list_integrations_connections** with `provider: "jira"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** to the user's Jira site (`https://<site>.atlassian.net` or `https://api.atlassian.com/...`). All requests: `Authorization: Bearer <accessToken>`, `Content-Type: application/json`. Add `*.atlassian.net` (or the site host) to **ALLOWED_CURL_HOSTS**.

Official docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/

---

## Cloud ID / Access

- **Get accessible resources** (to find cloud ID): `GET https://api.atlassian.com/oauth/token/accessible-resources`. Returns `[].id` (cloudId), `[].url` (e.g. `https://site.atlassian.net`). Use cloud ID in REST v3 URLs: `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/...`.

---

## Search issues

- **Search**: `POST https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/search` with body `{"jql": "project = MYPROJECT ORDER BY created DESC", "maxResults": 20, "fields": ["summary", "status", "assignee"]}`. Returns `issues[].key`, `issues[].fields.summary`, `issues[].fields.status.name`. JQL examples: `assignee = currentUser()`, `status = "In Progress"`.

---

## Create issue

- **Create**: `POST https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/issue` with body `{"fields": {"project": {"key": "PROJ"}, "summary": "Title", "issuetype": {"name": "Task"}, "description": {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Description"}]}]}}}`. Get project keys from `/rest/api/3/project`; issuetypes from `/rest/api/3/issue/createmeta`.

---

## Transitions

- **Get transitions** (for an issue): `GET https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/issue/<issueKey>/transitions`. Returns `transitions[].id`, `transitions[].name`.
- **Transition issue**: `POST https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/issue/<issueKey>/transitions` with body `{"transition": {"id": "<transitionId>"}}`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Jira in the Portal.
