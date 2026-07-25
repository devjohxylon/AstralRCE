import { list } from "@vercel/blob";
import { NextResponse } from "next/server";

export const revalidate = 30;

export async function GET() {
  try {
    const { blobs } = await list({ prefix: "server/" });
    const wipeBlob = blobs.find((blob) => blob.pathname === "server/wipe.json");
    if (!wipeBlob) {
      return NextResponse.json({ label: "Wipe TBA", wipeAt: null, updatedAt: null });
    }
    const res = await fetch(wipeBlob.url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: "Failed to read wipe" }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (error) {
    console.error("Wipe status read failed:", error);
    return NextResponse.json({ error: "Failed to load wipe" }, { status: 500 });
  }
}
