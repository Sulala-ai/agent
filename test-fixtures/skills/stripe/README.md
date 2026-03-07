---
name: stripe
description: Use Stripe (customers, invoices) via STRIPE_SECRET_KEY in .env or skill config. Do not use list_integrations_connections for Stripe—it only lists OAuth apps. Use stripe_list_customers for listing customers; for invoices use run_command with curl and the key from .env.
metadata:
  {
    "sulala": {
      "emoji": "💳",
      "requires": { "env": ["STRIPE_SECRET_KEY"] }
    }
  }
---

# Stripe

**When the user asks to list Stripe customers**, use the **stripe_list_customers** tool. Do **not** use `list_integrations_connections`—Stripe is not OAuth; that tool only returns OAuth apps and will be empty for Stripe.

Stripe is configured via **STRIPE_SECRET_KEY** in the agent `.env` (or in the skill’s config). There are no payment settings in the agent; skills are installed from the hub.

- **List customers**: use the **stripe_list_customers** tool (uses the key from .env). Returns customers with id, email, name.
- **Invoices / other Stripe API calls**: use **run_command** with curl to `https://api.stripe.com/v1`. Add `api.stripe.com` to **ALLOWED_CURL_HOSTS**. Stripe API uses **form-encoded** body for POST (e.g. `key=value`), not JSON for most v1 endpoints. The key is in .env; the agent must not expose it in chat.

Base URL: `https://api.stripe.com/v1`. Official docs: https://stripe.com/docs/api

Requirements: Stripe secret key (starts with `sk_`) in Skills config. Do not expose in chat.
