require('dotenv').config();
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const express = require("express");
const { createServer } = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const prefix = process.env.PREFIX || ".";

const commands = new Map();
const activeSessions = new Map(); 
const wsClients = new Map(); 

function registerCommand(name, description, category, handler) {
  commands.set(name.toLowerCase(), { name, description, category, handler });
}

require("./general")(registerCommand);
require("./admin")(registerCommand);
require("./info")(registerCommand);
require("./fun")(registerCommand);

app.use(express.json());

app.get("/", (req, res) => {
  const uiPath = path.resolve("./UI.html");
  if (fs.existsSync(uiPath)) {
    res.sendFile(uiPath);
  } else {
    res.status(404).send("Dashboard UI.html missing at root directory");
  }
});

wss.on("connection", (ws) => {
  let boundSessionId = null;

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.action === "init") {
        boundSessionId = data.sessionId;
        if (!wsClients.has(boundSessionId)) wsClients.set(boundSessionId, new Set());
        wsClients.get(boundSessionId).add(ws);
        
        if (activeSessions.has(boundSessionId)) {
          ws.send(JSON.stringify({ type: "status", status: "CONNECTED" }));
        }
      }

      if (data.action === "start_pairing") {
        const { sessionId, phoneNumber, mode } = data;
        boundSessionId = sessionId;
        
        if (!wsClients.has(boundSessionId)) wsClients.set(boundSessionId, new Set());
        wsClients.get(boundSessionId).add(ws);

        initializeWhatsAppInstance(sessionId, phoneNumber, mode);
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
    }
  });

  ws.on("close", () => {
    if (boundSessionId && wsClients.has(boundSessionId)) {
      wsClients.get(boundSessionId).delete(ws);
    }
  });
});

function sendToSession(sessionId, payload) {
  const clients = wsClients.get(sessionId);
  if (clients) {
    const dataString = JSON.stringify(payload);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(dataString);
      }
    });
  }
}

async function initializeWhatsAppInstance(sessionId, phoneNumber, mode) {
  const sessionPath = `./auth_info/${sessionId}`;
  
  // 🛠️ THE FIX: Force create the directory structure so Baileys doesn't crash on ENOENT
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  if (activeSessions.has(sessionId)) {
    try { activeSessions.get(sessionId).end(); } catch(_) {}
    activeSessions.delete(sessionId);
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const sock = makeWASocket({
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome')
  });

  activeSessions.set(sessionId, sock);
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      sendToSession(sessionId, { type: "qr", qr });
    }

    if (connection === "connecting") {
      sendToSession(sessionId, { type: "status", status: "CONNECTING" });
    }

    if (connection === "open") {
      sendToSession(sessionId, { type: "status", status: "CONNECTED" });
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      sendToSession(sessionId, { type: "status", status: "DISCONNECTED" });

      if (reason !== DisconnectReason.loggedOut) {
        setTimeout(() => initializeWhatsAppInstance(sessionId, phoneNumber, mode), 5000);
      } else {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        activeSessions.delete(sessionId);
      }
    }
  });

  if (mode === "pairing" && !state.creds.registered) {
    setTimeout(async () => {
      try {
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, "");
        if (!cleanNumber) {
          sendToSession(sessionId, { type: "error", message: "Invalid Phone Number Format." });
          return;
        }
        
        const code = await sock.requestPairingCode(cleanNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
        sendToSession(sessionId, { type: "code", code: formattedCode });
      } catch (err) {
        sendToSession(sessionId, { type: "error", message: "Pairing code timeout. Falling back to QR system." });
        initializeWhatsAppInstance(sessionId, phoneNumber, "qr");
      }
    }, 3000); 
  }

  sock.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      const msg = chatUpdate.messages[0];
      if (!msg.message || msg.key.fromMe) return;
      const from = msg.key.remoteJid;
      const isGroup = from.endsWith("@g.us");
      const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if (!body.startsWith(prefix)) return;

      const args = body.slice(prefix.length).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();
      const cmd = commands.get(commandName);
      if (!cmd) return;

      const senderNumber = (msg.key.participant || msg.key.remoteJid).split("@")[0];
      const ctx = {
        sock, msg, jid: from, args, isGroup, senderNumber, prefix, commands,
        reply: async (text) => { await sock.sendMessage(from, { text }, { quoted: msg }); }
      };
      await cmd.handler(ctx);
    } catch (e) { console.error(e); }
  });
}

app.get("/api/status", (req, res) => {
  res.json({ status: "online", instances: Array.from(activeSessions.keys()) });
});

server.listen(PORT, () => console.log(`🚀 Master Dashboard Gateway online on port ${PORT}`));
