# Connect Aces Bot to acesrust.com (Vercel)

## Overview

```
KAOS (#leaderboard) → Aces Bot (always-on) → POST → yoursite.com/api/discord/ingest
                                                              ↓
                                                    Vercel Blob (saved image)
                                                              ↓
                                              /leaderboard page reads /api/leaderboard
```

The bot stays on Railway/VPS/your PC. Only the **ingest API** lives on Vercel.

---

## Step 1 — Shared secret

Generate a long random string (PowerShell):

```powershell
[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
```

Use the **same value** in:

| Where | Variable |
|-------|----------|
| **Vercel** (site) | `WEBSITE_API_SECRET` |
| **Aces Bot** `.env` | `WEBSITE_API_SECRET` |

---

## Step 2 — Add files to your Next.js site

Copy from this folder into your site repo:

| Copy from | Paste into your site |
|-----------|----------------------|
| `integration/nextjs/app/api/discord/ingest/route.ts` | `app/api/discord/ingest/route.ts` |
| `integration/nextjs/app/api/leaderboard/route.ts` | `app/api/leaderboard/route.ts` |
| `integration/nextjs/components/LeaderboardImage.tsx` | `components/LeaderboardImage.tsx` (optional) |

Install Vercel Blob (stores the KAOS image permanently):

```bash
npm install @vercel/blob
```

---

## Step 3 — Vercel environment variables

In [Vercel Dashboard](https://vercel.com) → your project → **Settings → Environment Variables**:

| Name | Value |
|------|--------|
| `WEBSITE_API_SECRET` | same secret as bot |
| `BLOB_READ_WRITE_TOKEN` | auto-created when you add Blob store in Vercel Storage |

To add Blob: Vercel project → **Storage** → **Create Database** → **Blob** → connect to project.

Redeploy after adding env vars.

---

## Step 4 — Update Aces Bot `.env`

```env
WEBSITE_INGEST_URL=https://acesrust.com/api/discord/ingest
WEBSITE_API_SECRET=your_same_secret_here
CHANNEL_LEADERBOARD=1519013243711000607
```

Restart the bot:

```powershell
npm.cmd start
```

Test in Discord: `/aces-leaderboard`

---

## Step 5 — Show leaderboard on your page

In your existing `/leaderboard` page:

```tsx
import { LeaderboardImage } from "@/components/LeaderboardImage";

export default function LeaderboardPage() {
  return (
    <main>
      <h1>Leaderboard</h1>
      <LeaderboardImage />
    </main>
  );
}
```

Or fetch manually:

```tsx
const res = await fetch("https://acesrust.com/api/leaderboard", { next: { revalidate: 60 } });
const data = await res.json();
// data.imageUrl — permanent Blob URL
```

---

## Step 6 — Host the bot (production)

Vercel **cannot** run the Discord bot. Use one of:

- **Railway** (easy) — connect GitHub repo, set env vars, deploy
- **Fly.io**
- **VPS** (Windows/Linux)
- Your PC (only while it's on)

The bot only needs outbound internet to Discord + your Vercel URL. It does **not** need a public URL for leaderboard sync (Discord → site).

---

## Optional — Site posts announcements to Discord

If staff publish wipes/news on the site and you want them in Discord:

1. Host bot with a public URL (Railway + port, or Cloudflare Tunnel)
2. Vercel env: `ACES_BOT_URL=https://your-bot.railway.app`
3. Vercel env: `BOT_WEBHOOK_SECRET` (same as bot `.env`)
4. Call `POST {ACES_BOT_URL}/publish` from your admin API (see `integration/nextjs/app/api/discord/publish-example.ts`)

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `fetch failed` on bot | Wrong `WEBSITE_INGEST_URL` or site not deployed |
| `401 Unauthorized` | `WEBSITE_API_SECRET` mismatch between bot and Vercel |
| `500` on ingest | Add `BLOB_READ_WRITE_TOKEN` and redeploy |
| Leaderboard page empty | Run `/aces-leaderboard` once after deploy |
| Image broken later | Use Blob storage (Discord URLs expire) — ingest route handles this |

---

## Test ingest endpoint after deploy

```powershell
curl.exe -X POST https://acesrust.com/api/discord/ingest `
  -H "Authorization: Bearer YOUR_SECRET" `
  -H "Content-Type: application/json" `
  -d "{\"type\":\"leaderboard\",\"format\":\"image\",\"primaryImageUrl\":\"https://cdn.discordapp.com/embed/avatars/0.png\",\"messageId\":\"test\"}"
```

Then open: `https://acesrust.com/api/leaderboard`
