---
name: slack
description: Use Slack (channels, messages, reactions) via the Portal. When the user asks to list channels, send a message, or read Slack, list connections with list_integrations_connections (provider slack) and use run_command with curl to the Slack API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "💬",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Slack

1. **list_integrations_connections** with `provider: "slack"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` and `Content-Type: application/json` for POST.

Base URL: `https://slack.com/api`. Add `slack.com` to **ALLOWED_CURL_HOSTS**.

Official docs: https://api.slack.com/methods

---

## Channels

- **List channels** (public and private the app is in): `GET https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=50`. Returns `channels[].id`, `channels[].name`. Pagination: `cursor` in response.

---

## Messages

- **Send message**: `POST https://slack.com/api/chat.postMessage` with body `{"channel": "<channel_id>", "text": "Message text"}`. `channel` can be channel ID (from conversations.list) or channel name (e.g. `#general`).
- **Get channel history**: `GET https://slack.com/api/conversations.history?channel=<channel_id>&limit=20`. Returns `messages[]` with `text`, `user`, `ts`. Pagination: `cursor` or `oldest`/`latest` (timestamp).

---

## Users

- **List users**: `GET https://slack.com/api/users.list?limit=50`. Returns `members[].id`, `members[].real_name`, `members[].name`.

---

## Reactions

- **Add reaction**: `POST https://slack.com/api/reactions.add` with body `{"channel": "<channel_id>", "timestamp": "<message_ts>", "name": "emoji_name"}`. `timestamp` is the `ts` of the message (e.g. `1234567890.123456`). `name` is the emoji without colons (e.g. `thumbsup`).

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Slack in the Portal. Bot must be in the workspace and invited to channels as needed.
