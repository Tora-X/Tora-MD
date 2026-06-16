require('dotenv').config();
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const express = require("express");
const pino = require("pino");
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;
const prefix = process.env.PREFIX || ".";
const startTime = Date.now();

// Global Command Registry Map
const commands = new Map();

function registerCommand(name, description, category, handler) {
  commands.set(name.toLowerCase(), { name, description, category, handler });
}

// Dynamically Inject Modular File Registries
require("./general")(registerCommand);
require("./admin")(registerCommand);
require("./info")(registerCommand);
require("./fun")(registerCommand);

// Core Multi-Session Active State Map
const activeSessions = new Map();

async function startBotInstance(sessionId) {
  if (activeSessions.has(sessionId)) {
    console.log(`⚠️ [System]: Session '${sessionId}' is already initializing or running.`);
    return;
  }

  console.log(`🚀 [System]: Spawning Multi-Device instance for Session ID: ${sessionId}`);
  
  // Isolate credentials safely by Session Identifier
  const { state, saveCreds } = await useMultiFileAuthState(`auth_info/${sessionId}`);
  
  const sock = makeWASocket({
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome')
  });

  // Track active connection reference pointer
  activeSessions.set(sessionId, sock);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      console.log(`\n⚡ [Session ID: ${sessionId}] Scan this terminal QR code to link device:`);
      qrcode.generate(qr, { small: true });
    }
    
    if (connection === "close") {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut 
        : true;
      
      console.log(`🔄 [Session ID: ${sessionId}] Disconnected. Attempting automatic recovery: ${shouldReconnect}`);
      activeSessions.delete(sessionId);
      
      if (shouldReconnect) {
        setTimeout(() => startBotInstance(sessionId), 4000);
      }
    } else if (connection === "open") {
      console.log(`🐅 [Session ID: ${sessionId}] Connected Successfully & Processing Message Buffers.`);
    }
  });

  sock.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      const msg = chatUpdate.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const from = msg.key.remoteJid;
      const isGroup = from.endsWith("@g.us");
      
      const body = msg.message.conversation || 
                   msg.message.extendedTextMessage?.text || "";
                   
      if (!body.startsWith(prefix)) return;

      const args = body.slice(prefix.length).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();
      
      const cmd = commands.get(commandName);
      if (!cmd) return;

      const senderNumber = (msg.key.participant || msg.key.remoteJid).split("@")[0];

      // Build session-isolated contextual instance passkey
      const ctx = {
        sock, // Injects the exact socket connected to this specific text incoming stream
        msg,
        jid: from,
        args,
        isGroup,
        senderNumber,
        prefix,
        commands,
        reply: async (text) => {
          await sock.sendMessage(from, { text }, { quoted: msg });
        }
      };

      await cmd.handler(ctx);
    } catch (err) {
      console.error(`❌ Gateway execution exception under Session [${sessionId}]:`, err);
    }
  });
}

// REST Framework Operations Interface Management
app.use(express.json());

// API route to inject and pair additional active phone numbers on the fly
app.get("/api/start", (req, res) => {
  const { session } = req.query;
  if (!session) return res.status(400).json({ error: "Missing required 'session' query param." });
  startBotInstance(session);
  res.json({ status: "initializing", sessionId: session });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "active",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    activeSessionsCount: activeSessions.size,
    runningSessions: Array.from(activeSessions.keys()),
    totalCommandsLoaded: commands.size
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Server dashboard layer open on port: ${PORT}`);
  // Automatically trigger a default session on script launch
  startBotInstance("primary");
});
