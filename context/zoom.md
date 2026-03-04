---
name: zoom
description: Use Zoom (meetings) via the Portal. When the user asks to list or create Zoom meetings, list connections with list_integrations_connections (provider zoom) and use run_command with curl to the Zoom API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "📹",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Zoom

1. **list_integrations_connections** with `provider: "zoom"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` and `Content-Type: application/json` for POST.

Base URL: `https://api.zoom.us/v2`. Add `api.zoom.us` to **ALLOWED_CURL_HOSTS**. Official docs: https://developers.zoom.us/docs/api/

---

## Meetings

- **List meetings** (user's scheduled): `GET https://api.zoom.us/v2/users/me/meetings?type=scheduled&page_size=30`. Returns `meetings[].id`, `uuid`, `topic`, `start_time`, `join_url`, `agenda`.
- **Create meeting**: `POST https://api.zoom.us/v2/users/me/meetings` with body `{"topic": "Meeting title", "type": 2, "start_time": "<YYYY-MM-DDTHH:MM:SSZ>", "duration": 30, "agenda": "Optional agenda"}`. `type`: 1=instant, 2=scheduled, 3=recurring. Response has `join_url`, `start_url`, `id`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Zoom in the Portal.
