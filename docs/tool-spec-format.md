# Tool spec format (context/<name>/tools.yaml)

Tools for integrations (Stripe, Discord, etc.) can be defined in **YAML** under `context/<name>/tools.yaml`. The spec loader reads these files at startup and registers one tool per entry. No TypeScript needed for new endpoints.

For **multi-step flows** (e.g. Bluesky post, Stripe create invoice), use **`steps`** in the YAML. The generic step executor runs each step in order; later steps can use `{{step0.id}}` (or `{{step0.blueskyDid}}` etc.) from previous responses. No custom code needed.

## Layout

- **context/stripe/README.md** — Skill instructions (what the model sees).
- **context/stripe/tools.yaml** — Tool definitions for that integration.

Same pattern for `context/discord/`, etc. The loader scans every subdir of `AGENT_CONTEXT_PATH` (or `context` if unset) for a `tools.yaml` file.

## YAML schema

```yaml
tools:
  - name: stripe_list_customers      # Tool name (must be unique).
    description: "One-line description for the model."
    profile: full                    # full | messaging | coding | minimal
    auth: stripe_secret_key          # stripe_secret_key | discord_bot_token | none
    request:
      method: GET                    # GET | POST
      url: https://api.example.com/v1/items
      queryParams: { limit: limit, customer: customer_id }  # API param -> arg name
      # For POST with JSON body:
      bodyType: json
      bodyKeys: [content]
      # Or form-encoded body (param name -> arg name):
      # bodyType: form
      # body: { customer: customer_id, amount: amount_cents }
    parameters:
      - name: limit
        type: number
        description: Max items (default 10, max 100)
        default: 10
      - name: customer_id
        type: string
        description: Optional customer ID
    response:
      listPath: data                 # Key in JSON that holds the array (Stripe-style)
      rootIsArray: true             # Or response is the array (Discord-style)
      itemKeys: [id, email, name]   # Keys to return per item
      outputKey: customers          # Key in our response
      countKey: count
      # For single object:
      singleKeys: [id, amount_due, status]
      outputKey: message_id        # Special: returns { ok: true, message_id: id }
```

## Auth types (fixed in code)

- **stripe_secret_key** — Settings → Payment or `STRIPE_SECRET_KEY`.
- **discord_bot_token** — Settings → Channels (Discord) or `DISCORD_BOT_TOKEN`.
- **portal** — Portal gateway: `PORTAL_GATEWAY_URL` + `PORTAL_API_KEY` (used by Bluesky and other Portal proxy tools).
- **none** — No auth header.

## Multi-step flows (`steps`)

Use **`steps`** instead of **`request`** when the tool needs multiple HTTP calls. Each step can reference previous step responses via `{{step0.id}}`, `{{step0.blueskyDid}}`, etc.

- **step.url** — May use `{{argName}}`, `{{base}}` (when `auth: portal`), and `{{step0.x}}` (from previous step JSON; use `responsePath` to expose one field as `stepN`).
- **step.bodyType: form** — Form-encoded body. **body** is a map: form param name → arg name or `"{{step0.id}}"`.
- **step.bodyType: json** + **step.bodyTemplate** — Nested JSON; values can be `"{{text}}"`, `"{{step0.blueskyDid}}"`, `"{{$now}}"` (ISO timestamp).
- **step.responsePath** — Path in response to store for next steps (e.g. `id`). Omit to expose the full response as `stepN`.
- **step.when** — Optional arg name; run this step only when that arg is truthy.
- **transformArgs** — Compute missing args before steps, e.g. `{ amount_cents: "amount_dollars * 100" }`.
- **response** / **responseExtra** — Applied to the last step’s response; **responseExtra** can use `"{{step2.id}}"` etc.

Example (Stripe create invoice): three steps (create invoice → add line item → finalize), `responsePath: id` on step 0, step 2 URL `.../invoices/{{step0}}/finalize`. Example (Bluesky): two steps (use connection → bsky-request), `bodyTemplate` with `{{step0.blueskyDid}}`, `{{text}}`, `{{$now}}`.

## URL and params

- **Path params**: Use `{{arg_name}}` in `url`; values come from args.
- **Query params**: `queryParams` is a map `{ "API param name": "arg name" }` (e.g. `customer: customer_id` for Stripe).
- **POST body (single request)**: `bodyType: json` and `bodyKeys: [content]`; or `bodyType: form` and `body: { param: arg_name }`.

## Response shaping

- **List**: `listPath` (e.g. `data`) or `rootIsArray: true`, plus `itemKeys`, `outputKey`, `countKey`. Returns `{ [outputKey]: [...], [countKey]: length }`.
- **Single**: `singleKeys` and optional `outputKey`. If `outputKey: message_id` and response has `id`, returns `{ ok: true, message_id: id }`.

Required parameters are validated before the request; missing or empty required args return `{ error: "<name> is required" }`.
