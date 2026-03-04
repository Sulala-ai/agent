---
name: calendar
description: Use Google Calendar via the Portal. When the user asks to create a calendar event, add to calendar, list events, or check calendar, use this skill with list_integrations_connections (provider calendar) and run_command + curl. Do not use Apple Calendar, osascript, or local calendar apps—use Google Calendar via the Portal.
metadata:
  {
    "sulala": {
      "emoji": "📅",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Google Calendar

Use **list_integrations_connections** with `provider: "calendar"`, then **get_connection_token** to get an OAuth token (do not curl the portal from run_command—use the tool). Then call Calendar with that token.

1. **list_integrations_connections** with `provider: "calendar"` → get `connection_id`.
2. **get_connection_token** with that `connection_id` → returns `accessToken` (runs server-side).
3. **run_command (curl)** — call Calendar APIs with `Authorization: Bearer <accessToken>` for all requests below.

Add `www.googleapis.com` to **ALLOWED_CURL_HOSTS**.

Base URL: `https://www.googleapis.com/calendar/v3`

---

## List calendars

`GET https://www.googleapis.com/calendar/v3/users/me/calendarList`. Use `items[].id` (e.g. `primary`) for listing events.

---

## List events

`GET https://www.googleapis.com/calendar/v3/calendars/<calendarId>/events?timeMin=<ISO8601>&timeMax=<ISO8601>&maxResults=20&singleEvents=true`. `calendarId` is often `primary`.

---

## Create event

**Use this for all "create a calendar event" or "add to calendar" requests.**

`POST https://www.googleapis.com/calendar/v3/calendars/primary/events` with `Content-Type: application/json`, body:

`{"summary": "Event title", "description": "Optional description", "start": {"dateTime": "2025-03-04T21:00:00", "timeZone": "America/New_York"}, "end": {"dateTime": "2025-03-04T21:30:00", "timeZone": "America/New_York"}}`

- Example for "gym at 9 PM" today: use today's date, start 21:00, end 21:30 (or 22:00) in the user's timezone.
- All-day: use `"start": {"date": "2025-03-15"}`, `"end": {"date": "2025-03-16"}`.
- Times in ISO8601 with timezone (e.g. `America/New_York` or `UTC`).

---

## Update event

`PUT https://www.googleapis.com/calendar/v3/calendars/<calendarId>/events/<eventId>` with same body shape as create.

---

## Delete event

`DELETE https://www.googleapis.com/calendar/v3/calendars/<calendarId>/events/<eventId>`.

Requirements: **PORTAL_GATEWAY_URL**, **PORTAL_API_KEY**; user must connect Google Calendar in the Portal or dashboard Integrations.
