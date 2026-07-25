# Run Astral Bot 24/7

Your PC must stay on for the bot to work locally. For **24/7**, host it on Railway.

**Recommended: Railway** (~$5/month)

## Quick Railway setup

1. Push this repo to GitHub (**never commit `.env`**)
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → pick this repo
3. Open the service → **Variables** → add every key from `.env.example` (copy values from your local `.env`)
4. Deploy — logs should show `Logged in as Astral Vanilla+#xxxx`
5. Admin panel: open `https://admin.astralrce.com/admin`  
   Password = `ADMIN_PANEL_PASSWORD` (or `BOT_WEBHOOK_SECRET` if unset)

### Custom domain (`admin.astralrce.com`)

`localhost:8080` in Railway logs is **inside the container** — your browser cannot open it.

Custom domains live inside a **service**, not the project. From the project canvas, click the
bot service box first, then **Settings** → scroll to **Public Networking**.

1. Service → **Settings** → **Public Networking** → **+ Custom Domain**
2. Enter `admin.astralrce.com`, port `8080` if it asks
3. Railway gives you **two** records: a `CNAME` and a `TXT`
4. In your DNS for `astralrce.com` (Cloudflare, Namecheap, wherever it's registered), add **both**
   exactly as shown. Missing the `TXT` means the domain resolves but returns 404 — Railway uses it
   to verify ownership before routing traffic. On Cloudflare set the CNAME to **DNS only** (grey cloud).
5. Wait for the green check in Railway (usually minutes)
6. Railway Variables → add:
   ```
   ADMIN_PANEL_URL=https://admin.astralrce.com
   ADMIN_PANEL_PASSWORD=your-password
   ```
7. Open: **https://admin.astralrce.com/admin**

Keep `astralrce.com` / `www` on Vercel for the site; only the `admin` subdomain points at Railway.

Prefer the CLI? From the project folder:

```powershell
railway link
railway domain admin.astralrce.com --port 8080
```

It prints the same CNAME + TXT records to add.

To confirm the app is reachable before DNS is done, use **Generate Domain** in the same
Public Networking section and open `https://<generated>.up.railway.app/admin`.

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
