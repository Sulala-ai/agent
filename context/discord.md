---
name: discord
description: Use Discord (servers, channels, send messages) via Settings → Channels. Do not use list_integrations_connections for Discord—it only lists OAuth apps. Use discord_list_guilds, discord_list_channels, and discord_send_message (token from Settings → Channels).
metadata:
  {
    "sulala": {
      "emoji": "🎮",
      "requires": { "env": ["DISCORD_BOT_TOKEN"] }
    }
  }
---

# Discord

Discord is configured in **Settings → Channels (Discord)** or via **DISCORD_BOT_TOKEN** in the agent env. **Do not call list_integrations_connections for Discord**—that tool only returns OAuth connections (Gmail, Slack, etc.). Discord uses a bot token, not OAuth.

Use the dedicated tools (they use the token from Settings):
- **discord_list_guilds** — list servers (guilds) the bot is in. Returns guild id and name.
- **discord_list_channels** — list channels in a guild. Requires guild_id from discord_list_guilds. Returns channel id, name, type (0=text, 2=voice, 4=category).
- **discord_send_message** — send a message to a channel. Requires channel_id and content (max 2000 chars).

---

## Flow

1. **discord_list_guilds** — get server (guild) ids and names.
2. **discord_list_channels** with `guild_id` — get channel ids (type 0 = text channel).
3. **discord_send_message** with `channel_id` and `content` — send the message.

Requirements: Bot must be added to the server and have permissions to read channels and send messages.
