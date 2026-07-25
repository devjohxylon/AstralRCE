import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

export const revalidate = 15;

export async function GET() {
  try {
    const { blobs } = await list({ prefix: "server/" });
    const statusBlob = blobs.find((blob) => blob.pathname === "server/status.json");
    if (!statusBlob) {
      return NextResponse.json({ online: false, players: null, updatedAt: null });
    }
    const res = await fetch(statusBlob.url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to read status" }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (error) {
    console.error("Server status read failed:", error);
    return NextResponse.json({ error: "Failed to load status" }, { status: 500 });
  }
}
