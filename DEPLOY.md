# Run Astral Bot 24/7

Your PC must stay on for the bot to work locally. For **24/7**, host it on Railway.

**Recommended: Railway** (~$5/month)

## Quick Railway setup

1. Push this repo to GitHub (**never commit `.env`**)
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → pick this repo
3. Open the service → **Variables** → add every key from `.env.example` (copy values from your local `.env`)
4. Deploy — logs should show `Logged in as Astral Vanilla+#xxxx`
5. Admin panel: open the Railway public URL + `/admin`  
   Password = `ADMIN_PANEL_PASSWORD` (or `BOT_WEBHOOK_SECRET` if unset)

### Critical variables for RCON

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
GUILD_ID=
WEBSITE_INGEST_URL=
WEBSITE_API_SECRET=
BOT_WEBHOOK_SECRET=
ADMIN_PANEL_PASSWORD=
RCON_HOST=
RCON_PORT=
RCON_PASSWORD=
RCON_SERVER_NAME=astral
```

Plus your channel/role IDs. Railway sets `PORT` automatically — leave `BOT_WEBHOOK_PORT` unset in production.

## After deploy checklist

- [ ] Bot online in Discord
- [ ] Logs show `RCON connected` (if testing cloud RCON)
- [ ] `/astral-status` works
- [ ] Admin panel loads at `https://YOUR-RAILWAY-URL/admin`
- [ ] `WEBSITE_API_SECRET` matches Vercel

## Slash command updates

After changing commands, run locally once (uses your Discord token):

```powershell
npm.cmd run register-commands
```
