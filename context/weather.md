---
name: weather
description: Get current weather and forecasts (no API key required).
homepage: https://open-meteo.com/en/docs
metadata:
  {
    "sulala": {
      "emoji": "🌤️",
      "requires": { "bins": ["curl"] }
    }
  }
---

# Weather

Use **run_command** with `curl` to fetch weather from Open-Meteo (free, no API key). Add `curl` to ALLOWED_BINARIES.

## Open-Meteo

Geocoding (city → lat, lon):
```bash
curl -s "https://geocoding-api.open-meteo.com/v1/search?name=London&count=1"
```

Current weather (use lat, lon from geocoding):
```bash
curl -s "https://api.open-meteo.com/v1/forecast?latitude=51.5&longitude=-0.12&current_weather=true"
```

Returns JSON with temp, windspeed, weathercode, etc.

Docs: https://open-meteo.com/en/docs
