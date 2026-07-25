import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

const SECRET = process.env.WEBSITE_API_SECRET;

type LeaderboardPayload = {
  type: string;
  format?: string;
  parsed?: boolean;
  primaryImageUrl?: string | null;
  images?: { url: string; name?: string | null; source?: string }[];
  leaderboards?: unknown[];
  messageId?: string;
  timestamp?: string;
};

export async function POST(request: Request) {
  if (!SECRET) {
    return NextResponse.json({ error: "WEBSITE_API_SECRET not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: LeaderboardPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.type === "leaderboard") {
    const imageUrl = body.primaryImageUrl ?? body.images?.[0]?.url;

    if (!imageUrl) {
      return NextResponse.json({ error: "No leaderboard image in payload" }, { status: 400 });
    }

    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      return NextResponse.json({ error: "Could not download Discord image" }, { status: 502 });
    }

    const extension = imageUrl.includes(".png") ? "png" : "jpg";
    const blob = await put(`leaderboard/latest.${extension}`, imageRes.body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    const meta = {
      imageUrl: blob.url,
      discordMessageId: body.messageId ?? null,
      format: body.format ?? "image",
      updatedAt: body.timestamp ?? new Date().toISOString(),
      leaderboards: body.parsed ? body.leaderboards : [],
    };

    await put("leaderboard/meta.json", JSON.stringify(meta, null, 2), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });

    return NextResponse.json({ ok: true, ...meta });
  }

  // Other relay types (kaos_activity, announcement, etc.) — extend as needed
  return NextResponse.json({ ok: true, ignored: body.type ?? "unknown" });
}
