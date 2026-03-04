---
name: gmail
description: Use Gmail via the Portal. When the user asks to read email, send email, list messages, or archive mail, use this skill with list_integrations_connections (provider gmail) and run_command + curl.
metadata:
  {
    "sulala": {
      "emoji": "📧",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Gmail

Use **list_integrations_connections** with `provider: "gmail"`, then **get_connection_token** to get an OAuth token (do not curl the portal from run_command—use the tool). Then call Gmail with that token.

**Required order:**
1. **list_integrations_connections** with `provider: "gmail"` → get `connection_id` (e.g. from `connections[0].id`).
2. **get_connection_token** with that `connection_id` → returns `accessToken`. This runs server-side; the agent does not curl the portal.
3. **run_command (curl)** — call Gmail APIs with header `Authorization: Bearer <accessToken>` (the value from step 2). Do **not** use the Portal API key on Gmail URLs.

If you get 401, you skipped step 2: call **get_connection_token** first, then use the returned `accessToken` in the Gmail curl.

Add `gmail.googleapis.com` to **ALLOWED_CURL_HOSTS**.

Base URL: `https://gmail.googleapis.com/gmail/v1`

---

## List messages (inbox)

`GET https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20` (optional: `q=is:unread`, `pageToken`). Returns `messages[].id`; use `threadId` if needed.

---

## Get message (body, subject, from)

`GET https://gmail.googleapis.com/gmail/v1/users/me/messages/<messageId>?format=full` (or `format=metadata`). Decode `payload.parts[].body.data` or `payload.body.data` (base64url) for body.

---

## Send email

Build MIME (From, To, Subject, body); base64url-encode it. `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with body `{"raw": "<base64url-encoded-mime>"}`. Or use `{"raw": "<base64url>"}` where the MIME string is encoded (e.g. with a small script or base64).

---

## Archive message

`POST https://gmail.googleapis.com/gmail/v1/users/me/messages/<messageId>/modify` with body `{"removeLabelIds": ["INBOX"]}`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Gmail in the Portal or dashboard Integrations.
