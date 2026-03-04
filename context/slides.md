---
name: slides
description: Use Google Slides via the Portal. When the user asks to list presentations or read Slides content, use this skill with list_integrations_connections (provider slides) and run_command + curl.
metadata:
  {
    "sulala": {
      "emoji": "📽️",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Google Slides

Use **list_integrations_connections** with `provider: "slides"`, then **get_connection_token** (do not curl the portal). Then call the API with that token.

1. **list_integrations_connections** with `provider: "slides"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken`.
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` for all requests.

Add `www.googleapis.com` and `slides.googleapis.com` to **ALLOWED_CURL_HOSTS**.

---

## List presentations

List via Drive API (mimeType `application/vnd.google-apps.presentation`).

---

## Get presentation

`GET https://slides.googleapis.com/v1/presentations/<presentationId>`. Returns slide structure and content.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Google Slides in the Portal or dashboard Integrations.
