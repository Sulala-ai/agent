---
name: dropbox
description: Use Dropbox (files) via the Portal. When the user asks to list, upload, or download Dropbox files, list connections with list_integrations_connections (provider dropbox) and use run_command with curl to the Dropbox API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "📁",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Dropbox

1. **list_integrations_connections** with `provider: "dropbox"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** with `Authorization: Bearer <accessToken>`. RPC-style endpoints use `Content-Type: application/json` and body; content endpoints use `Dropbox-API-Arg` header.

Add `api.dropboxapi.com` and `content.dropboxapi.com` to **ALLOWED_CURL_HOSTS**. Official docs: https://www.dropbox.com/developers/documentation/http/documentation

---

## List folder

- **List folder**: `POST https://api.dropboxapi.com/2/files/list_folder` with body `{"path": ""}` for root or `{"path": "/FolderName"}`. Returns `entries[].name`, `entries[].id`, `entries[].tag` (file/folder). Pagination: `cursor` in response, then `POST https://api.dropboxapi.com/2/files/list_folder/continue` with `{"cursor": "..."}`.

---

## Download file

- **Download**: `POST https://content.dropboxapi.com/2/files/download` with header `Dropbox-API-Arg: {"path": "/path/to/file.txt"}`. No body. Response body is file content (binary). Use same `Authorization: Bearer <token>`.

---

## Upload file

- **Upload** (small file): `POST https://content.dropboxapi.com/2/files/upload` with header `Dropbox-API-Arg: {"path": "/path/to/destination.txt", "mode": "add"}` and `Content-Type: application/octet-stream`, body = raw file bytes. `mode`: "add" (always add), "overwrite", "add" with autorename.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Dropbox in the Portal.
