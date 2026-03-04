---
name: airtable
description: Use Airtable (bases, records) via the Portal. When the user asks about Airtable bases or records, list connections with list_integrations_connections (provider airtable) and use run_command with curl to the Airtable API or gateway.
metadata:
  {
    "sulala": {
      "emoji": "📊",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Airtable

1. **list_integrations_connections** with `provider: "airtable"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (do not curl the portal).
3. **run_command (curl)** with `Authorization: Bearer <accessToken>` and `Content-Type: application/json`.

Airtable API uses **base ID** and **table name or ID**. Add `api.airtable.com` to **ALLOWED_CURL_HOSTS**. Official docs: https://airtable.com/developers/web/api/introduction

---

## Bases and tables

- **List bases**: `GET https://api.airtable.com/v0/meta/bases`. Returns `bases[].id`, `bases[].name`. Use base `id` in table URLs.
- **List tables** (schema) in a base: `GET https://api.airtable.com/v0/meta/bases/<baseId>/tables`. Returns table names and field definitions.

---

## Records

- **List records** (one table): `GET https://api.airtable.com/v0/<baseId>/<tableNameOrId>?maxRecords=20`. Optional: `?filterByFormula=<formula>`, `?sort[0][field]=Name`. Returns `records[].id`, `records[].fields`.
- **Create record**: `POST https://api.airtable.com/v0/<baseId>/<tableNameOrId>` with body `{"fields": {"Name": "Value", "OtherField": "Value"}}`. Field names must match the table schema.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Airtable in the Portal. Base must be shared with the connected account.
