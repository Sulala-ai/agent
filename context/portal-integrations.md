---
name: portal-integrations
description: Use connected apps (Gmail, Calendar, Zoom, Slack, GitHub, etc.) via the Portal. When the user asks about email, calendar, meetings, or other integrated apps, list connections with list_integrations_connections and use run_command with curl to the gateway or provider APIs (see per-integration skills: calendar, gmail, drive, docs, sheets, slides, github, notion, slack, linear, zoom, airtable, etc.).
metadata:
  {
    "sulala": {
      "emoji": "🔌"
    }
  }
---

# Portal integrations

The agent uses **connected apps** (Gmail, Google Calendar, Zoom, Slack, GitHub, Notion, Linear, Airtable, etc.) via **skills** and **run_command** with curl. The user connects apps in the Portal (or dashboard → Integrations); the agent gets `connection_id` from **list_integrations_connections** and performs actions by following the relevant integration skill (e.g. calendar.md, gmail.md, drive.md, github.md, slack.md) and calling **run_command** with `binary: "curl"` to the gateway or provider API.

## How it works

1. **User** creates an API key at the Portal and adds it in the agent (Settings → Portal API key or `PORTAL_API_KEY`). Optionally set `PORTAL_GATEWAY_URL`.
2. **User** connects apps in the Portal (or dashboard Integrations): Gmail, Calendar, Zoom, Slack, etc.
3. **Agent** uses:
   - **list_integrations_connections** — returns `connection_id` and `provider` for each connected app. Call with optional `provider` to filter (e.g. `"calendar"`, `"gmail"`, `"slack"`, `"github"`).
   - **get_connection_token** — call with `connection_id` to get an OAuth `accessToken`. Use this before each integration API call; the agent does not curl the portal from run_command.
   - **run_command** with **curl** — use the `accessToken` from get_connection_token in the `Authorization: Bearer <accessToken>` header when curling the provider API (Gmail, Calendar, GitHub, Slack, etc.), as documented in each integration skill.

Integration behavior is **skill-driven**: use **list_integrations_connections** for OAuth apps (calendar, gmail, drive, github, slack, linear, etc.) and the instructions in the per-integration skills. **Stripe and Discord are not OAuth**—they are "channels" configured in **Settings → Channels** (API key / bot token). Do not use list_integrations_connections for Stripe or Discord; use **stripe_list_customers** and **discord_list_guilds** / **discord_send_message** instead. See stripe.md and discord.md.

## When to use

- User asks to **create a calendar event**, read/send email, check calendar, list or create Zoom meetings, post in Slack, list GitHub repos/issues, query Notion, etc. For calendar events, always use the **calendar** skill (provider `calendar`) and the Calendar API via run_command + curl; do not use Apple Calendar, osascript, or local calendar apps.
- First call **list_integrations_connections** (optionally with `provider`, e.g. `calendar` for events), then follow the relevant integration skill and use **run_command** with curl as documented there.

## Requirements

- **PORTAL_GATEWAY_URL** and **PORTAL_API_KEY** must be set so the agent can list connections and get OAuth tokens. The agent loads them from **`~/.sulala/.env`** (e.g. when saved via dashboard Settings); you do not need them in the agent project `.env`. If both exist, the agent project `.env` overrides. Create the API key in the Portal → API Keys. Example in `~/.sulala/.env`: `PORTAL_GATEWAY_URL=https://portal.sulala.ai/api/gateway`, `PORTAL_API_KEY=<your key>`.
- The user must have connected the relevant app in the Portal before the agent can use it.
- Add required hosts to **ALLOWED_CURL_HOSTS** (e.g. api.github.com, slack.com, www.googleapis.com) as documented in each integration skill.

## Notes

- Connection count and subscription limits are enforced by the Portal; the agent only sees connections the user has already connected.
- If **list_integrations_connections** returns an error like "Portal not configured", prompt the user to add a Portal API key in Settings or at the Portal.
- For OAuth-backed actions, the Portal (or gateway) may expose action endpoints (e.g. `POST /api/gateway/actions/gmail/send`) that skills document for curl; until then, skills document calling the gateway for a token and then the provider API directly.
