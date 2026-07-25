"use client";

import { useEffect, useState } from "react";

type ServerStatus = {
  online?: boolean;
  players?: number | null;
  maxPlayers?: number | null;
  queued?: number | null;
  hostname?: string | null;
  map?: string | null;
  updatedAt?: string | null;
};

type WipeStatus = {
  label?: string;
  wipeAt?: string | null;
  remainingMs?: number | null;
  past?: boolean;
  updatedAt?: string | null;
};

type LeaderboardMeta = {
  format?: string;
  imageUrl?: string | null;
  updatedAt?: string | null;
  leaderboards?: {
    title?: string;
    category?: string;
    entries?: { rank: number; name: string; value: number | string }[];
  }[];
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function LiveServerBoard() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [wipe, setWipe] = useState<WipeStatus | null>(null);
  const [lb, setLb] = useState<LeaderboardMeta | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [s, w, l] = await Promise.all([
        fetchJson<ServerStatus>("/api/server/status"),
        fetchJson<WipeStatus>("/api/server/wipe"),
        fetchJson<LeaderboardMeta>("/api/leaderboard"),
      ]);
      if (!alive) return;
      setStatus(s);
      setWipe(w);
      setLb(l);
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const pop =
    status?.players != null
      ? `${status.players}/${status.maxPlayers ?? "?"}${status.queued ? ` · Q${status.queued}` : ""}`
      : "—";

  const topBoard = lb?.leaderboards?.[0];

  return (
    <section className="live-server-board" aria-label="Live server status">
      <header>
        <p>{status?.hostname || "Astral Vanilla+"}</p>
        <h2>{pop}</h2>
        <p>{wipe?.label || "Wipe TBA"}</p>
      </header>

      {topBoard?.entries?.length ? (
        <ol>
          {topBoard.entries.slice(0, 10).map((row) => (
            <li key={`${row.rank}-${row.name}`}>
              <span>#{row.rank}</span> {row.name} <strong>{row.value}</strong>
            </li>
          ))}
        </ol>
      ) : lb?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={lb.imageUrl} alt="Leaderboard" />
      ) : (
        <p>No leaderboard yet</p>
      )}
    </section>
  );
}
