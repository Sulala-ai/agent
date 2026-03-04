---
name: news
description: Fetch news and articles via the Perigon API. Use when the user asks for news, headlines, or articles on a topic.
homepage: https://www.perigon.io
metadata:
  {
    "sulala": {
      "emoji": "📰",
      "requires": { "bins": ["curl"], "env": ["PERIGON_API_KEY"] }
    }
  }
---

# News (Perigon API)

Use **run_command** with `curl` to fetch articles from the Perigon API. Add `curl` to ALLOWED_BINARIES.

Requires `PERIGON_API_KEY`. Set it in `.env` or in the skill config (dashboard Skills page). Config key in `skills.entries.news` is `PERIGON_API_KEY`.

**IMPORTANT:** Use `binary: "sh"` and `args: ["-c", "curl ..."]` so `$PERIGON_API_KEY` expands, or pass the key in the URL when calling curl.

## When to Use

- "Get me the latest news"
- "Headlines about [topic]"
- "Find articles on [subject]"

## API

Base URL: `https://api.perigon.io/v1`

### All articles (recent)

```bash
curl -s -X GET "https://api.perigon.io/v1/articles/all?apiKey=$PERIGON_API_KEY" -H "Content-Type: application/json"
```

### With query (topic, keyword)

Append `&q=keyword` to the URL. Example:

```bash
curl -s -X GET "https://api.perigon.io/v1/articles/all?apiKey=$PERIGON_API_KEY&q=climate" -H "Content-Type: application/json"
```

### Reading key from config

If `PERIGON_API_KEY` is not set in the environment, read from Sulala config:

```
CONFIG_PATH="${SULALA_CONFIG_PATH:-$HOME/.sulala/config.json}"
PERIGON_API_KEY=$(cat "$CONFIG_PATH" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); e=d.get('skills',{}).get('entries',{}).get('news',{}); print(e.get('PERIGON_API_KEY',''))" 2>/dev/null)
```

Then use `$PERIGON_API_KEY` in the curl URL.

## Response

Returns JSON with an array of articles (title, description, url, source, published date, etc.). Parse with `python3 -c "import sys,json; d=json.load(sys.stdin); ..."` to summarize or filter for the user.

## Notes

- Get an API key at https://www.perigon.io
- Add `api.perigon.io` to ALLOWED_CURL_HOSTS if you restrict curl by host.
