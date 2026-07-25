# Astral Bot — Server + Community + Mod + Website

Connects **directly to the Rust Console Edition server over RCON** — no KAOS required. Handles in-game feeds, stats, admin controls, Discord community, moderation, giveaways, tickets, and website sync for **Astral Vanilla+**.

## Features

### Rust server (RCON)
- Live connection to the game server with auto-reconnect
- **Killfeed** → `CHANNEL_KILLFEED` (PvP, NPC and world deaths)
- **Join / leave feed** → `CHANNEL_JOIN_LEAVE`
- **Quick chat relay** → `CHANNEL_GAME_CHAT`
- **Event alerts** (Airdrop, Cargo, Patrol Heli, Oil Rig…) → `CHANNEL_GAME_EVENTS`
- **Admin log** (bans, item spawns, kits, role changes) → `CHANNEL_ADMIN_LOG`
- **Live player count** in a voice channel name → `CHANNEL_POP_STATUS`
- Optional Discord → in-game chat bridge (`RCON_CHAT_BRIDGE`)

### Own stats + leaderboard
- Tracks kills, deaths, K/D, NPC kills, suicides and playtime per player
- `/leaderboard` and `/stats <player>` in Discord
- Auto-pushes boards to the website (no more KAOS image scraping)
- `/rcon resetstats` on wipe day

### Account linking
- `/link start <ign>` while online — instant claim, no notes
- Unlocks homes, warps, and TPR

### Teleports
- `/home set|go|list|delete` — personal homes (VIP gets more + shorter cooldown)
- `/warp go|list` + staff `/warp set|delete`
- `/tpr` `/tpa` `/tpd` — player-to-player teleport requests
- Delay + movement cancel + cooldown; optional `CHANNEL_TP_LOG`

### Admin control panel
- Open `http://localhost:3847/admin` (password = `ADMIN_PANEL_PASSWORD`)
- Live server overview, online players, kick/ban
- Full RCON console + broadcast
- Stats / leaderboard push + wipe reset
- Warp manager + force teleport
- Link manager
- Auto-messages + **scheduled RCON jobs** (auto-run commands)
- Shop / economy coming next inside this panel

### Auto-messages
- Staff `/automessage add|list|remove|toggle` — or manage in the panel

### Website sync
- Live server status (players, queue, map, uptime, FPS) → site
- Leaderboard data → site
- Optional announcements/wipes/events publish
- Legacy KAOS channel scraping still available as a fallback

### Auto-mod
- Link filter (allowlist)
- Discord invite blocker
- Scam / nitro phishing patterns
- Word filter (`.data/blocked-words.json` + `WORD_FILTER` env)
- Spam (duplicate + fast messages)
- Caps spam
- Raid join alerts + `/raidmode`

### Moderation
- `/warn` `/mute` `/kick` `/ban` `/purge`
- `/slowmode` `/lock` `/unlock` `/case`
- Auto-mute after X warnings
- Mod log channel

### Giveaways
- `/giveaway create` with 🎉 Enter button
- Role requirement, account/join age gates
- Auto-end + `/giveaway reroll`
- **VIP auto-role** on win (`grant_vip` option or `GIVEAWAY_AUTO_VIP=true`)

### Tickets
- `/ticket setup` — panel with Report / VIP / Appeal / General
- Private ticket channels for staff + user
- **Open/close logs** + staff role ping → `CHANNEL_TICKET_LOG` (or `CHANNEL_MOD_LOG`)
- **Transcript** saved to ticket log on close (`.txt` attachment)

### Community
- Welcome message + rules verify button
- `/poll` `/announce`

## Setup

1. Enable **Server Members Intent** + **Message Content Intent** in Discord Developer Portal
2. Rename the app to **Astral Bot** in the portal (General Information + Bot username)
3. Copy `.env.example` → `.env`
4. Set channel + role IDs
5. `npm install && npm run register-commands && npm start`

## Staff commands quick reference

| Command | Description |
|---------|-------------|
| `/server` | Live server info (players, map, uptime, FPS) |
| `/players` | Who's online right now |
| `/stats <player>` | A player's kills / deaths / K/D / playtime |
| `/leaderboard` | Top kills, K/D or playtime |
| `/rcon say` | Broadcast in-game |
| `/rcon console` | Raw RCON command |
| `/rcon kick` `/rcon ban` `/rcon unban` | Player control |
| `/rcon give` | Give an item to a player |
| `/rcon resetstats` | Wipe tracked stats after a server wipe |
| `/rcon pushstats` | Push leaderboard to the website now |
| `/warn` | Warn member |
| `/mute` | Timeout member |
| `/kick` `/ban` | Remove member |
| `/purge` | Delete messages |
| `/raidmode` | Lock all channels |
| `/giveaway create` | Start giveaway |
| `/ticket setup` | Post ticket panel |
| `/poll` | Quick poll |
| `/astral-leaderboard` | Sync KAOS → site |
| `/astral-status` | Bot health |
| `/astral-sync` | Backfill channel to site |

## Deploy 24/7

See [DEPLOY.md](./DEPLOY.md) for Railway hosting.
