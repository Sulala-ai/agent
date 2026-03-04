---
name: stripe
description: Use Stripe (customers, invoices) via Settings → Channels or API key. Do not use list_integrations_connections for Stripe—it only lists OAuth apps. Use stripe_list_customers for listing customers; for invoices use run_command with curl and the key from Settings.
metadata:
  {
    "sulala": {
      "emoji": "💳",
      "requires": { "env": ["STRIPE_SECRET_KEY"] }
    }
  }
---

# Stripe

Stripe is configured in **Settings → Channels (Stripe)** or via **STRIPE_SECRET_KEY** in the agent env. **Do not call list_integrations_connections for Stripe**—that tool only returns OAuth connections (Gmail, Slack, etc.). Stripe uses an API key, not OAuth.

- **List customers**: use the **stripe_list_customers** tool (uses the key from Settings → Channels). Returns customers with id, email, name.
- **Invoices / other Stripe API calls**: use **run_command** with curl to `https://api.stripe.com/v1`. Add `api.stripe.com` to **ALLOWED_CURL_HOSTS**. Stripe API uses **form-encoded** body for POST (e.g. `key=value`), not JSON for most v1 endpoints. The key is in Settings → Channels; the agent must not expose it in chat.

Base URL: `https://api.stripe.com/v1`. Official docs: https://stripe.com/docs/api

---

## Customers

- **List customers**: use the **stripe_list_customers** tool (limit optional). For raw API: `GET https://api.stripe.com/v1/customers?limit=10`. Pagination: `starting_after=<id>`.
- **Get customer**: `GET https://api.stripe.com/v1/customers/<customer_id>`.
- **Create customer** (if needed for invoice): `POST https://api.stripe.com/v1/customers` with body `email=user@example.com&name=Name`.

---

## Invoices

- **List invoices**: `GET https://api.stripe.com/v1/invoices?limit=10&customer=<customer_id>` (optional). Returns `data[].id`, `data[].amount_due`, `data[].status`, `data[].invoice_pdf`, `data[].hosted_invoice_url`.
- **Get invoice**: `GET https://api.stripe.com/v1/invoices/<invoice_id>`.
- **Create invoice**: (1) Create invoice: `POST https://api.stripe.com/v1/invoices` with body `customer=<customer_id>`. Response has `id`. (2) Add line item: `POST https://api.stripe.com/v1/invoiceitems` with body `customer=<customer_id>&amount=<amount_in_cents>&currency=usd&description=Item description`. (3) Finalize: `POST https://api.stripe.com/v1/invoices/<invoice_id>/finalize`. (4) Optional send: `POST https://api.stripe.com/v1/invoices/<invoice_id>/send`. Use idempotency header `Idempotency-Key: <unique_key>` for POST if retrying.

Requirements: Stripe secret key (starts with `sk_`) in Skills config. Do not expose in chat.
