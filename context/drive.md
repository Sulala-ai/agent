---
name: drive
description: Use Google Drive via the Portal. When the user asks to list files, create a folder, upload/download files, or manage Drive content, use this skill with list_integrations_connections (provider drive) and run_command + curl.
metadata:
  {
    "sulala": {
      "emoji": "📁",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Google Drive

Use **list_integrations_connections** with `provider: "drive"`, then **get_connection_token** (do not curl the portal). Then call Drive with that token.

1. **list_integrations_connections** with `provider: "drive"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken`.
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` for all requests below.

Add `www.googleapis.com` to **ALLOWED_CURL_HOSTS**.

Base URL: `https://www.googleapis.com/drive/v3`

---

## List files

`GET https://www.googleapis.com/drive/v3/files?pageSize=20&q=<query>` (e.g. `q='root' in parents` for root; `q=trashed=false`). Returns `files[].id`, `name`, `mimeType`.

---

## Create folder

`POST https://www.googleapis.com/drive/v3/files` with body `{"name": "FolderName", "mimeType": "application/vnd.google-apps.folder"}`. Optional: `"parents": ["<folderId>"]`.

---

## Upload file (small)

Use multipart: one part JSON `{"name": "filename.txt", "parents": ["<folderId>"]}`, second part file content. Or use resumable upload (see Drive API docs).

---

## Download file

`GET https://www.googleapis.com/drive/v3/files/<fileId>?alt=media` with `Authorization: Bearer <token>` (binary response). For export of Google Docs/Sheets use `GET https://www.googleapis.com/drive/v3/files/<fileId>/export?mimeType=text/plain` (or other export type).

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Google Drive in the Portal or dashboard Integrations.
