---
name: docs
description: Use Google Docs via the Portal. When the user asks to list, create, or read Google Docs, use this skill with list_integrations_connections (provider docs) and run_command + curl.
metadata:
  {
    "sulala": {
      "emoji": "📄",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Google Docs

Use **list_integrations_connections** with `provider: "docs"`, then **get_connection_token** (do not curl the portal). Then call the API with that token.

1. **list_integrations_connections** with `provider: "docs"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken`.
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` for all requests.

Add `www.googleapis.com` to **ALLOWED_CURL_HOSTS**.

---

## List / create / read

List and create Docs via the Drive API (mimeType `application/vnd.google-apps.document`). Export to read: `GET https://www.googleapis.com/drive/v3/files/<id>/export?mimeType=text/plain` with `Authorization: Bearer <accessToken>`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Google Docs in the Portal or dashboard Integrations.
