---
name: bluesky
description: Post to Bluesky (AT Protocol). Use when the user asks to post to Bluesky or share content on Bluesky. Use either (A) Portal OAuth connection and the Bluesky proxy, or (B) app password from skill config (BSKY_HANDLE, BSKY_APP_PASSWORD).
metadata:
  {
    "sulala": {
      "emoji": "🦋",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Bluesky

Two ways to post:

## (A) Portal OAuth (recommended)

1. **list_integrations_connections** with `provider: "bluesky"` → get `connection_id`.
2. **bluesky_post** with that `connection_id` and the post text (max 300 characters).

Use the **bluesky_post** tool for posting. Do not use run_command (curl) for Bluesky—the correct endpoint is the portal gateway bsky-request, and the tool calls it for you.

## (B) App password (skill config)

Set **BSKY_HANDLE** and **BSKY_APP_PASSWORD** (from bsky.app → Settings → App Passwords) in Skills → Bluesky config.

1. **Create session** to get access token:
   ```bash
   curl -s -X POST "https://bsky.social/xrpc/com.atproto.server.createSession" \
     -H "Content-Type: application/json" \
     -d '{"identifier":"$BSKY_HANDLE","password":"$BSKY_APP_PASSWORD"}'
   ```
   Response has `accessJwt` and `did`.

2. **Create post** (use the JWT and did from step 1):
   ```bash
   curl -s -X POST "https://bsky.social/xrpc/com.atproto.repo.createRecord" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <accessJwt>" \
     -d '{"repo":"<did>","collection":"app.bsky.feed.post","record":{"$type":"app.bsky.feed.post","text":"<post text>","createdAt":"<ISO8601>"}}'
   ```

Add `bsky.social` to **ALLOWED_CURL_HOSTS**. Optional: **BSKY_PDS** (default https://bsky.social) for a custom PDS.

Official docs: https://docs.bsky.app/docs/api/atproto/
