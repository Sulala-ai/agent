---
name: post-to-x
description: >
  Posts a tweet to X (formerly Twitter) using OAuth 1.0a user authentication.
  Use this skill when the user asks to tweet, post to X/Twitter, or share an update on X.
metadata:
  {
    "sulala": {
      "requires": {
        "bins": ["python3"],
        "env": [
          "X_API_KEY",
          "X_API_SECRET",
          "X_ACCESS_TOKEN",
          "X_ACCESS_TOKEN_SECRET"
        ]
      },
      "primaryEnv": "X_ACCESS_TOKEN",
      "capabilities": ["write", "social", "automation"]
    }
  }
---

# Post to X (Twitter)

This skill posts a tweet to **:contentReference[oaicite:0]{index=0}** using **OAuth 1.0a (User Context)** authentication.

⚠️ **Important**
- App-only Bearer Tokens **cannot** post tweets.
- This skill requires **user-level OAuth 1.0a credentials** with **Read & Write** permissions.

---

## When to Use
Use this skill when the user asks to:
- Post a tweet
- Share content on X
- Announce something on Twitter/X
- Publish automated updates

---

## Requirements

### Environment Variables
```env
X_API_KEY=your_consumer_key
X_API_SECRET=your_consumer_secret
X_ACCESS_TOKEN=your_access_token
X_ACCESS_TOKEN_SECRET=your_access_token_secret