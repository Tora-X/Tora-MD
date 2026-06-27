const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");

const config = require("../config");
const { usePostgresAuthState } = require("./pgAuthState");
const { handleMessage } = require("./commandHandler");
const { getMessageText } = require("./messageUtils");

const logger = pino({ level: "silent" });

let sock = null;
let wsClients = new Set();
let pairingRequested = false;

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const ws of wsClients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function registerClient(ws) {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));

  // Bring a newly-connected dashboard tab up to date immediately
  if (sock?.user) {
    ws.send(JSON.stringify({ type: "status", status: "CONNECTED" }));
  }
}

/**
 * Requests a pairing code for a phone number. Only works while the socket
 * is freshly started and not yet registered.
 */
async function requestPairingCode(phoneNumber) {
  if (!sock) throw new Error("Socket not initialized yet");
  const cleaned = phoneNumber.replace(/[^0-9]/g, "");
  const code = await sock.requestPairingCode(cleaned);
  return code.match(/.{1,4}/g)?.join("-") || code;
}

async function startSocket() {
  const { state, saveCreds } = await usePostgresAuthState(config.sessionId);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) broadcast({ type: "qr", qr });

    if (connection === "connecting") {
      broadcast({ type: "status", status: "CONNECTING" });
    } else if (connection === "open") {
      pairingRequested = false;
      broadcast({ type: "status", status: "CONNECTED" });
      console.log("✅ Connected to WhatsApp");
    } else if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      broadcast({ type: "status", status: "DISCONNECTED" });

      if (loggedOut) {
        console.log("Logged out — clear the session row in Supabase and re-pair.");
      } else {
        console.log("Connection closed, reconnecting...");
        setTimeout(startSocket, 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      if (msg.key.remoteJid === "status@broadcast") continue;

      const text = getMessageText(msg);
      await handleMessage(sock, msg, text);
    }
  });

  return sock;
}

function getSocket() {
  return sock;
}

module.exports = {
  startSocket,
  getSocket,
  registerClient,
  requestPairingCode,
};
