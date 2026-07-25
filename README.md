# Astral Bot

Discord bridge for **Astral Vanilla+** (Rust RCE). Works **alongside KAOS** — KAOS keeps running the server; Astral relays Discord channels to your website and posts site updates back into Discord.

## What it does

| Direction | Behavior |
|-----------|----------|
| **Discord → Website** | Watches `#kaos-activity`, `#leaderboard` (KAOS stats), and optionally `#announcements` |
| **Leaderboard sync** | Parses KAOS leaderboard embeds/images (including edits) and POSTs to your site |
| **Website → Discord** | Your site calls the bot webhook; Astral posts to `#announcements`, `#wipes`, or `#events` |

## Setup

### 1. Create / rename the Discord application

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → your app (or **New Application**)
2. Rename to **Astral Bot** (General Information)
3. **Bot** → set username to **Astral Bot** (or similar)
4. Enable **Message Content Intent** + **Server Members Intent**
5. Invite with scopes: `bot`, `applications.commands`

### 2. Configure channels

Copy channel IDs into `.env` (see `.env.example`).

### 3. Install and run

```bash
npm install
npm run register-commands
npm start
```

### 4. Host the bot

The bot needs a **always-on** process. See [DEPLOY.md](./DEPLOY.md).

---

## Slash commands

| Command | Description |
|---------|-------------|
| `/astral-status` | Bot uptime, watched channels, website URL |
| `/astral-leaderboard` | Push latest KAOS leaderboard message to your site |
| `/astral-sync` | Backfill recent messages from a channel to your site |

Plus moderation, giveaways, tickets — see [FEATURES.md](./FEATURES.md).

---

## Website integration

See [integration/SITE_SETUP.md](./integration/SITE_SETUP.md) and [FEATURES.md](./FEATURES.md).
