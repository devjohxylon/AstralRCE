import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

export const revalidate = 60;

export async function GET() {
  try {
    const { blobs } = await list({ prefix: "leaderboard/" });
    const metaBlob = blobs.find((blob) => blob.pathname === "leaderboard/meta.json");
    const imageBlob = blobs.find((blob) => blob.pathname.startsWith("leaderboard/latest."));

    if (metaBlob) {
      const metaRes = await fetch(metaBlob.url, { cache: "no-store" });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        return NextResponse.json(meta);
      }
    }

    if (imageBlob) {
      return NextResponse.json({
        imageUrl: imageBlob.url,
        updatedAt: imageBlob.uploadedAt.toISOString(),
      });
    }

    return NextResponse.json({ imageUrl: null, updatedAt: null });
  } catch (error) {
    console.error("Leaderboard read failed:", error);
    return NextResponse.json({ error: "Failed to load leaderboard" }, { status: 500 });
  }
}
