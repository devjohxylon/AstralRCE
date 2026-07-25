import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

const SECRET = process.env.WEBSITE_API_SECRET;

type IngestPayload = {
  type: string;
  format?: string;
  parsed?: boolean;
  primaryImageUrl?: string | null;
  images?: { url: string; name?: string | null; source?: string }[];
  leaderboards?: unknown[];
  messageId?: string;
  timestamp?: string;
  createdAt?: string;
  [key: string]: unknown;
};

async function putJson(pathname: string, data: unknown) {
  await put(pathname, JSON.stringify(data, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function POST(request: Request) {
  if (!SECRET) {
    return NextResponse.json({ error: "WEBSITE_API_SECRET not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: IngestPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = body.type ?? "unknown";

  if (type === "leaderboard") {
    const imageUrl = body.primaryImageUrl ?? body.images?.[0]?.url ?? null;
    const isText = body.format === "text" || body.parsed === true;
    const hasBoards = Array.isArray(body.leaderboards) && body.leaderboards.length > 0;

    if (!imageUrl && !hasBoards && !isText) {
      return NextResponse.json({ error: "No leaderboard image or entries in payload" }, { status: 400 });
    }

    let blobUrl: string | null = null;
    if (imageUrl) {
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
      blobUrl = blob.url;
    }

    const meta = {
      imageUrl: blobUrl,
      discordMessageId: body.messageId ?? null,
      format: body.format ?? (blobUrl ? "image" : "text"),
      source: body.source ?? null,
      updatedAt: body.createdAt ?? body.timestamp ?? new Date().toISOString(),
      leaderboards: hasBoards ? body.leaderboards : [],
    };

    await putJson("leaderboard/meta.json", meta);
    return NextResponse.json({ ok: true, ...meta });
  }

  if (type === "server_status") {
    const status = {
      ...body,
      updatedAt: new Date().toISOString(),
    };
    await putJson("server/status.json", status);
    return NextResponse.json({ ok: true, type });
  }

  if (type === "wipe_status") {
    const wipe = {
      ...body,
      updatedAt: body.updatedAt ?? new Date().toISOString(),
    };
    await putJson("server/wipe.json", wipe);
    return NextResponse.json({ ok: true, type });
  }

  return NextResponse.json({ ok: true, ignored: type });
}
