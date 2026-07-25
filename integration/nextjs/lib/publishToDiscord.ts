/**
 * Example: call from your admin API when staff publish news on the site.
 * Requires ACES_BOT_URL + BOT_WEBHOOK_SECRET on Vercel.
 */
export async function publishToDiscord(body: {
  type: "announcement" | "wipe" | "event";
  title?: string;
  content?: string;
  wipeAt?: string;
  map?: string;
  startsAt?: string;
  location?: string;
}) {
  const botUrl = process.env.ACES_BOT_URL;
  const secret = process.env.BOT_WEBHOOK_SECRET;

  if (!botUrl || !secret) {
    throw new Error("ACES_BOT_URL and BOT_WEBHOOK_SECRET must be set");
  }

  const response = await fetch(`${botUrl}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bot publish failed: ${text}`);
  }

  return response.json();
}
