---
name: sheets
description: Use Google Sheets via the Portal. When the user asks to list spreadsheets, read or append rows, or edit Sheets, use this skill with list_integrations_connections (provider sheets) and run_command + curl.
metadata:
  {
    "sulala": {
      "emoji": "📊",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Google Sheets

Use **list_integrations_connections** with `provider: "sheets"`, then **get_connection_token** (do not curl the portal). Then call the API with that token.

1. **list_integrations_connections** with `provider: "sheets"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken`.
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` for all requests.

Add `www.googleapis.com` and `sheets.googleapis.com` to **ALLOWED_CURL_HOSTS**.

---

## List spreadsheets

List via Drive API (mimeType `application/vnd.google-apps.spreadsheet`).

---

## Read range

`GET https://sheets.googleapis.com/v4/spreadsheets/<spreadsheetId>/values/<range>`. Example range: `Sheet1!A1:D10`.

---

## Append rows

`POST https://sheets.googleapis.com/v4/spreadsheets/<spreadsheetId>/values/<range>:append?valueInputOption=USER_ENTERED` with body `{"values": [[ "cell1", "cell2" ], [ "row2col1", "row2col2" ]]}`.

---

## Update range

`PUT https://sheets.googleapis.com/v4/spreadsheets/<spreadsheetId>/values/<range>?valueInputOption=USER_ENTERED` with body `{"values": [[...]]}`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Google Sheets in the Portal or dashboard Integrations.
