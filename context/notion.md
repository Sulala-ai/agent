---
name: notion
description: Use Notion (search, pages, databases) via the Portal. When the user asks about Notion pages or databases, list connections with list_integrations_connections (provider notion) and use run_command with curl to the Notion API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "📝",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Notion

1. **list_integrations_connections** with `provider: "notion"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** with `Authorization: Bearer <accessToken>`, `Notion-Version: 2022-06-28`, and `Content-Type: application/json` where applicable.

Base URL: `https://api.notion.com/v1`. Add `api.notion.com` to **ALLOWED_CURL_HOSTS**.

Official docs: https://developers.notion.com/reference

---

## Search

- **Search** (pages and databases): `POST https://api.notion.com/v1/search` with body `{"query": "optional search text", "filter": {"property": "object", "value": "page"}}` or `"value": "database"`. Returns `results[].id`, `url`, `object` (page/database). Omit filter to get both.

---

## Pages

- **Get page** (content and properties): `GET https://api.notion.com/v1/pages/<page_id>`. Page ID is the UUID from a Notion URL (with hyphens).
- **Get page content** (blocks): `GET https://api.notion.com/v1/blocks/<page_id>/children?page_size=100`. Returns block objects (paragraph, heading, etc.); `type` and `paragraph.rich_text` or similar.
- **Create page** (under parent): `POST https://api.notion.com/v1/pages` with body `{"parent": {"page_id": "<parent_page_id>"}, "properties": {"title": {"title": [{"text": {"content": "Page title"}}]}}}`. Parent page must be shared with the integration.
- **Update page** (e.g. title): `PATCH https://api.notion.com/v1/pages/<page_id>` with body `{"properties": {"title": {"title": [{"text": {"content": "New title"}}]}}}`.

---

## Databases

- **Create database** (under parent page): `POST https://api.notion.com/v1/databases` with body `{"parent": {"page_id": "<parent_page_id>"}, "title": [{"text": {"content": "DB name"}}], "properties": {"Name": {"title": {}}}}`. Default "Name" property is created.
- **Query database** (list rows): `POST https://api.notion.com/v1/databases/<database_id>/query` with body `{}` or `{"filter": {...}, "sorts": [{"property": "Name", "direction": "ascending"}]}`. Returns `results[]` (page objects with properties).

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Notion in the Portal. Pages/databases must be shared with the connected Notion integration.
