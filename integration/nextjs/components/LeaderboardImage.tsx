"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type LeaderboardData = {
  imageUrl: string | null;
  updatedAt: string | null;
};

export function LeaderboardImage() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((res) => res.json())
      .then(setData)
      .catch(() => setError("Could not load leaderboard"));
  }, []);

  if (error) return <p>{error}</p>;
  if (!data) return <p>Loading leaderboard…</p>;
  if (!data.imageUrl) return <p>Leaderboard not synced yet. Run /aces-leaderboard in Discord.</p>;

  return (
    <div>
      <Image
        src={data.imageUrl}
        alt="Server leaderboard"
        width={1200}
        height={800}
        className="w-full h-auto rounded-lg"
        unoptimized
      />
      {data.updatedAt ? (
        <p className="mt-2 text-sm opacity-70">
          Updated {new Date(data.updatedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}
