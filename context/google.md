---
name: google
description: Google services are split by product. Use the skill that matches the request—calendar for events, gmail for email, drive for files, docs/sheets/slides for Docs/Sheets/Slides. Do not loop over one doc; pick the right skill.
metadata:
  {
    "sulala": {
      "emoji": "🔷",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Google (per-service skills)

**Use one skill per product.** The Portal has separate providers; there is no single "google" provider.

| User intent              | Skill to use   | Provider for list_integrations_connections |
|--------------------------|----------------|--------------------------------------------|
| Create event, calendar   | **calendar**   | `"calendar"`                                |
| Email, Gmail             | **gmail**      | `"gmail"`                                   |
| Drive files, folders     | **drive**      | `"drive"`                                   |
| Google Docs              | **docs**       | `"docs"`                                    |
| Google Sheets            | **sheets**     | `"sheets"`                                  |
| Google Slides            | **slides**     | `"slides"`                                  |

For "create an event at 9 PM" → use the **calendar** skill only. For "send an email" → use the **gmail** skill only. No need to load or loop over multiple Google sections.

Each skill doc has the full flow: list_integrations_connections with that provider → get token from gateway → curl the API.
