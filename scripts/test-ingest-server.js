import http from "node:http";

const PORT = Number(process.env.TEST_INGEST_PORT || 3001);
const SECRET = process.env.WEBSITE_API_SECRET || "test-secret-change-me";

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Astral test ingest server is running. POST to /api/discord/ingest\n");
    return;
  }

  if (req.method !== "POST" || !req.url?.startsWith("/api/discord/ingest")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${SECRET}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

  console.log("\n--- Ingest received ---");
  console.log(`Type: ${body.type}`);
  if (body.type === "leaderboard") {
    console.log(`Format: ${body.format ?? "unknown"} | parsed: ${body.parsed}`);
    if (body.primaryImageUrl) {
      console.log(`Image: ${body.primaryImageUrl}`);
    }
    for (const image of body.images ?? []) {
      console.log(`  [${image.source}] ${image.url}`);
    }
    for (const board of body.leaderboards ?? []) {
      console.log(`Board: ${board.title} (${board.category})`);
      for (const entry of board.entries ?? []) {
        console.log(`  #${entry.rank} ${entry.name} — ${entry.valueRaw ?? entry.value}`);
      }
    }
  } else {
    console.log(JSON.stringify(body, null, 2));
  }
  console.log("-----------------------\n");

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(PORT, () => {
  console.log(`Test ingest server: http://localhost:${PORT}/api/discord/ingest`);
  console.log(`Expecting Authorization: Bearer ${SECRET}`);
});
