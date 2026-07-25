# Next.js integration snippets

Copy these into your live Astral site (Vercel):

| Path | Purpose |
|---|---|
| `app/api/discord/ingest/route.ts` | Accepts RCON text leaderboards + `server_status` + `wipe_status` |
| `app/api/server/status/route.ts` | GET live pop / hostname |
| `app/api/server/wipe/route.ts` | GET wipe countdown |
| `app/api/leaderboard/route.ts` | GET leaderboard meta |
| `components/LiveServerBoard.tsx` | Drop-in live board UI |

Requires `@vercel/blob` and matching `WEBSITE_API_SECRET` with the bot.
