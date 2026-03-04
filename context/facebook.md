---
name: facebook
description: Use Facebook (Graph API, pages) via the Portal. When the user asks to post or manage Facebook content, list connections with list_integrations_connections (provider facebook) and use run_command with curl to the Graph API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "📘",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Facebook

1. **list_integrations_connections** with `provider: "facebook"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** to `https://graph.facebook.com`. Use `access_token=<accessToken>` in query or `Authorization: Bearer <accessToken>` in header per endpoint.

Add `graph.facebook.com` to **ALLOWED_CURL_HOSTS**. Official docs: https://developers.facebook.com/docs/graph-api

---

## User and pages

- **Get user info**: `GET https://graph.facebook.com/me?fields=id,name,email&access_token=<token>`. Do **not** use this id as the target for posting (it is a person, not a page).
- **Get user's pages** (required before any post): `GET https://graph.facebook.com/me/accounts?access_token=<token>`. Returns `data[].id` (page id), `data[].name`, `data[].access_token` (page token). Use these for posting.

---

## Post to page (required flow)

**Never post to the user's ID or /me.** The user ID from `GET /me` is a person, not a page. You must use a **page** id and **page** access token from `me/accounts`. **Never use placeholders** like `your_page_id` or `<page_id>` in real API calls—Facebook will reject them. Always get real values from step 2.

1. Get **user** token: `list_integrations_connections` → `get_connection_token` → `accessToken`.
2. **Call** `GET https://graph.facebook.com/v25.0/me/accounts?access_token=<user_token>`. Response: `data[]` with `id`, `name`, `access_token` (page token). You must do this before posting; the POST needs real `id` and `access_token` from this response.
3. Pick a page: if the user said a name (e.g. "playoutdoor"), find the item in `data` whose `name` matches (e.g. "PlayOutdoor : Tennis, Bike & Run"); otherwise use `data[0]`. Let `PAGE_ID` = that item’s `id`, `PAGE_TOKEN` = that item’s `access_token`.
4. Post: `POST https://graph.facebook.com/v25.0/PAGE_ID/feed` with body `{"message": "Your text here", "access_token": "PAGE_TOKEN"}`. Use the actual string values for PAGE_ID and PAGE_TOKEN from step 3 (e.g. if id is `677659355438097`, the URL is `.../v25.0/677659355438097/feed`).

- **Photo**: `POST https://graph.facebook.com/v25.0/PAGE_ID/photos` with the **page** token. The image must be at a **publicly reachable URL** — Facebook's servers fetch it. **URLs like http://127.0.0.1 or http://localhost do not work** (Facebook cannot reach your machine). Use a public URL (e.g. deploy the gateway or expose it via ngrok and use that base URL for uploads). When the user attaches media in chat, the message includes "[Attached media ... URLs]"; use one of those URLs only if it is public. Use **form data** (not JSON) for the photos endpoint. Example with curl: `curl -X POST "https://graph.facebook.com/v25.0/PAGE_ID/photos" -F "url=IMAGE_PUBLIC_URL" -F "caption=Optional caption" -F "access_token=PAGE_TOKEN"`. Replace PAGE_ID, IMAGE_PUBLIC_URL, and PAGE_TOKEN with real values from step 3. For multiple images, post one at a time.

---

## Page insights (optional)

- **Page insights**: `GET https://graph.facebook.com/<page_id>/insights?metric=page_impressions&access_token=<page_token>`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Facebook in the Portal. For posting to a Page, the Facebook app must request (and the user grant) **pages_manage_posts** and **pages_read_engagement**; the token used for the POST must be the **page** access token from `me/accounts`, not the user token. If photo post fails: ensure the image URL is **public** (not 127.0.0.1/localhost), use form params (`-F`) for `/photos`, and use the page token from `me/accounts`.
