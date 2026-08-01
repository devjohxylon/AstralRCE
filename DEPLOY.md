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
RCON_PORT=25800
RCON_PASSWORD=
RCON_SERVER_NAME=astral
CHANNEL_KILLFEED=
CHANNEL_JOIN_LEAVE=
CHANNEL_POP_STATUS=
CHANNEL_WIPE_STATUS=
ROLE_VIP=
VIP_KIT_ID=vip
```

Plus your other channel/role IDs. Railway sets `PORT` automatically — leave `BOT_WEBHOOK_PORT` unset in production.

### Persistent data (REQUIRED — links, VIP claims, kits, stats, keys)

Every redeploy wipes the container filesystem. **Account links, VIP once-per-wipe
claims, kits, wipe time, staff keys, and stats live in `.data`** — without a volume
they disappear (this is why `/link` "stops saving" and VIP claims reset).

1. Railway → your bot service → **Volumes** → **Add Volume**
2. Mount path: `/app/.data` (Nixpacks `cwd` is `/app`)
3. Variables → set `DATA_DIR=/app/.data`
4. Redeploy once after attaching

Confirm in logs:
```
Data directory: /app/.data (N linked account(s))
Data persistence OK ...
```

If you see `PERSISTENCE WARNING`, or the admin overview **Data** health is red, the
volume is missing or mounted on the wrong path.

### Staff slash commands (AstralAdmin)

Staff commands register with Discord permissions disabled by default. After deploy:

1. Discord → Server Settings → Integrations → your bot → **Commands**
2. Allow staff commands for the **AstralAdmin** role

Public: `/link` (start · status · unlink). Staff: `/linkadmin` (panel · force · syncrole).

### Website live boards

1. Copy files from `integration/nextjs/` into your Vercel site (ingest route, `/api/server/status`, `/api/server/wipe`, `LiveServerBoard`).
2. Match `WEBSITE_API_SECRET` on Railway and Vercel.
3. Set `WEBSITE_INGEST_URL` to `https://YOUR-SITE/api/discord/ingest`.

## After deploy checklist

- [ ] Bot online in Discord
- [ ] Logs show `RCON connected` (if testing cloud RCON)
- [ ] `/astral-status` works
- [ ] Admin panel loads at `https://YOUR-RAILWAY-URL/admin`
- [ ] Create kit `vip` in panel Kits tab (if using VIP sync)
- [ ] `WEBSITE_API_SECRET` matches Vercel
- [ ] Volume mounted on `.data`

## Slash command updates

Commands re-register automatically on bot startup. To force locally:

```powershell
npm.cmd run register-commands
```
