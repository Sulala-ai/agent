---
name: bluesky
description: Post to Bluesky (AT Protocol). Use when the user asks to post to Bluesky or share content on Bluesky. Uses Portal OAuth connection via integrations.
homepage: https://bsky.app
metadata:
  {
    "sulala": {
      "emoji": "🦋",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Bluesky Posting

Post to Bluesky via the AT Protocol. Uses the **Portal OAuth connection** (integrations). User connects Bluesky in the Portal; no app password needed.

## How to post

1. **list_integrations_connections** with `provider: "bluesky"` → get `connection_id`.
2. **bluesky_post** with that `connection_id` and the post text (max 300 characters).

Use **bluesky_post**; do not use run_command (curl) for Bluesky.

## When to use

- "Post this to Bluesky"
- "Share [content] on Bluesky"
- "Post news from [URL] to Bluesky"

## Requirements

- **PORTAL_GATEWAY_URL** and **PORTAL_API_KEY** (from Portal → API Keys).
- User must have connected Bluesky in the Portal (Connections).
