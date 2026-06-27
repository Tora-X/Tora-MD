const express = require("express");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");

const config = require("./config");
const { initSchema } = require("./lib/db");
const {
  startSocket,
  registerClient,
  requestPairingCode,
} = require("./lib/sessionManager");

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
app.get("/health", (req, res) => res.send("ok"));

wss.on("connection", (ws) => {
  registerClient(ws);

  ws.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.action === "request-pairing-code") {
        const code = await requestPairingCode(data.phone);
        ws.send(JSON.stringify({ type: "pairing-code", code }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: "pairing-error", message: err.message }));
    }
  });
});

async function main() {
  await initSchema();
  await startSocket();

  server.listen(config.port, () => {
    console.log(`🚀 Dashboard running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal error starting bot:", err);
  process.exit(1);
});
