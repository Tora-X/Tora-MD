const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} = require("@whiskeysockets/baileys");
const express = require("express");
const { createServer } = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { Pool } = require("pg"); // Added Postgres Client Driver

// Project File Imports
const config = require('./config');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const activeSessions = new Map(); 
const wsClients = new Map(); 
const connectionDelayTimers = new Map();

app.use(express.json());
// ═════════════════════════════════════════════════════════
// 🛠️ NATIVE SUPABASE POSTGRESQL HYBRID SYNC LAYER
// ═════════════════════════════════════════════════════════
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || config.DATABASE_URL,
    ssl: { 
        // 1. Clears the "self-signed certificate" error by skipping direct CA verification
        rejectUnauthorized: false 
    }
});
async function connectDB() {
    try {
        // Automatically provisions the structural sync table if it doesn't exist yet
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tora_session_store (
                session_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_content TEXT NOT NULL,
                PRIMARY KEY (session_id, file_name)
            );
        `);
        console.log("🐘 Supabase PostgreSQL Connection Established & Schema Verified!");
    } catch (err) {
        console.error("❌ Supabase Initialization Failure:", err.message);
    }
}

async function syncSessionToDisk(sessionId, localPath) {
    try {
        if (!fs.existsSync(localPath)) {
            fs.mkdirSync(localPath, { recursive: true });
        }
        const res = await pool.query(
            'SELECT file_name, file_content FROM tora_session_store WHERE session_id = $1', 
            [sessionId]
        );
        for (const row of res.rows) {
            const fullPath = path.join(localPath, row.file_name);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, row.file_content, 'utf8');
        }
        console.log(`📥 Downloaded and synchronized ${res.rows.length} auth files from Supabase to local disk.`);
    } catch (err) {
        console.error("❌ Error running syncSessionToDisk:", err.message);
    }
}

async function syncSessionToCloud(sessionId, localPath) {
    try {
        if (!fs.existsSync(localPath)) return;
        const files = fs.readdirSync(localPath);
        for (const file of files) {
            const fullPath = path.join(localPath, file);
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
                const content = fs.readFileSync(fullPath, 'utf8');
                await pool.query(`
                    INSERT INTO tora_session_store (session_id, file_name, file_content)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (session_id, file_name)
                    DO UPDATE SET file_content = EXCLUDED.file_content;
                `, [sessionId, file, content]);
            }
        }
    } catch (err) {
        console.error("❌ Error running syncSessionToCloud:", err.message);
    }
}

// Fire up Database Connection
connectDB();

// ═════════════════════════════════════════════════════════
// 1. DASHBOARD CONTROLLER GRAPHICS LAYER
// ═════════════════════════════════════════════════════════
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tora MD Engine</title>
    <style>
        :root {
            --bg-color: #05070f; --card-bg: #0c1020; --primary: #00ffcc;
            --primary-glow: rgba(0, 255, 204, 0.3); --text-main: #f1f5f9;
            --text-muted: #64748b; --error: #ff3366; --success: #00ff66;
            --terminal-bg: #02040a;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; }
        body { background-color: var(--bg-color); color: var(--text-main); display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .container { background-color: var(--card-bg); padding: 35px; border-radius: 24px; border: 1px solid rgba(0, 255, 204, 0.15); box-shadow: 0 0 30px rgba(0, 255, 204, 0.05); width: 100%; max-width: 460px; text-align: center; }
        h1 { color: var(--primary); margin-bottom: 5px; font-size: 26px; text-shadow: 0 0 10px var(--primary-glow); }
        p.subtitle { color: var(--text-muted); margin-bottom: 25px; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .tabs { display: flex; background: var(--terminal-bg); padding: 5px; border-radius: 16px; margin-bottom: 25px; border: 1px solid rgba(255,255,255,0.05); }
        .tab { flex: 1; padding: 10px; cursor: pointer; border-radius: 12px; font-size: 14px; color: var(--text-muted); font-weight: 600; transition: all 0.3s ease; }
        .tab.active { background: var(--primary); color: #000; box-shadow: 0 0 10px var(--primary-glow); }
        .panel { display: none; } .panel.active { display: block; }
        .input-group { margin-bottom: 20px; text-align: left; }
        label { display: block; margin-bottom: 8px; color: var(--text-muted); font-size: 13px; padding-left: 5px; }
        input { width: 100%; padding: 14px 18px; border: 1px solid #1e293b; background-color: var(--terminal-bg); color: var(--text-main); border-radius: 18px; font-size: 15px; outline: none; }
        input:focus { border-color: var(--primary); box-shadow: 0 0 10px var(--primary-glow); }
        button { width: 100%; padding: 15px; background-color: var(--primary); color: #000; border: none; border-radius: 18px; font-size: 15px; font-weight: bold; cursor: pointer; box-shadow: 0 0 12px var(--primary-glow); transition: all 0.3s ease; }
        button:disabled { background-color: #1e293b; color: var(--text-muted); cursor: not-allowed; box-shadow: none; }
        .qr-display { display: none; margin-top: 20px; padding: 20px; background: #fff; border-radius: 20px; inline-size: max-content; margin-left: auto; margin-right: auto; }
        .qr-display img { display: block; max-width: 220px; height: auto; }
        .code-display { display: none; margin-top: 25px; padding: 20px; background-color: var(--terminal-bg); border: 2px dashed var(--primary); border-radius: 18px; }
        .code-display h2 { font-size: 32px; letter-spacing: 6px; color: var(--text-main); margin: 8px 0; text-shadow: 0 0 8px rgba(255,255,255,0.2); }
        .terminal { margin-top: 25px; background-color: var(--terminal-bg); border-radius: 18px; padding: 15px; height: 140px; overflow-y: auto; text-align: left; font-family: monospace; font-size: 11px; border: 1px solid #1e293b; color: #a7f3d0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🐅 Tora MD Engine</h1>
        <p class="subtitle"><span class="status-dot" id="ws-status"></span> <span id="ws-text">Disconnected</span></p>
        
        <div class="tabs">
            <div class="tab active" id="tab-qr" onclick="switchMode('qr')">QR Scanner</div>
            <div class="tab" id="tab-pairing" onclick="switchMode('pairing')">Pairing Code</div>
        </div>

        <div id="panel-qr" class="panel active">
            <button id="qrBtn" onclick="requestSession('qr')">Get QR Code</button>
            <div class="qr-display" id="qrBox"><img id="qrImage" src="" alt="WhatsApp QR Code"></div>
        </div>

        <div id="panel-pairing" class="panel">
            <div class="input-group">
                <label>WhatsApp Number (With country code):</label>
                <input type="text" id="phoneNumber" placeholder="e.g. 94722633010" autocomplete="off">
            </div>
            <button id="pairBtn" onclick="requestSession('pairing')">Generate Pairing Code</button>
            <div class="code-display" id="codeBox">
                <p style="color: var(--text-muted); font-size: 13px;">Enter this code on your device:</p>
                <h2 id="pairingCode">----</h2>
            </div>
        </div>

        <div class="terminal" id="terminal"><div>System cloud storage synchronized...</div></div>
    </div>

    <script>
        let ws; let currentMode = 'qr'; const sessionIdentifier = "${config.SESSION_ID}";
        const terminal = document.getElementById('terminal'); const codeBox = document.getElementById('codeBox');
        const qrBox = document.getElementById('qrBox'); const qrImage = document.getElementById('qrImage');
        const pairingCodeText = document.getElementById('pairingCode'); const pairBtn = document.getElementById('pairBtn');
        const qrBtn = document.getElementById('qrBtn'); const phoneInput = document.getElementById('phoneNumber');

        function appendLog(msg) {
            const el = document.createElement('div');
            el.innerText = '[' + new Date().toLocaleTimeString() + '] ' + msg;
            terminal.appendChild(el); terminal.scrollTop = terminal.scrollHeight;
        }

        function switchMode(mode) {
            currentMode = mode;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            document.getElementById('tab-' + mode).classList.add('active');
            document.getElementById('panel-' + mode).classList.add('active');
        }

        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(protocol + '//' + window.location.host);
            ws.onopen = () => {
                ws.send(JSON.stringify({ action: 'init', sessionId: sessionIdentifier }));
            };
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'status') {
                        appendLog('State: ' + data.status);
                        if (data.status === 'CONNECTED') {
                            qrBox.style.display = 'none'; codeBox.style.display = 'none';
                        }
                    } else if (data.type === 'code') {
                        codeBox.style.display = 'block'; pairingCodeText.innerText = data.code;
                        pairBtn.disabled = false; pairBtn.innerText = "Regenerate Code";
                    } else if (data.type === 'qr') {
                        qrBox.style.display = 'block';
                        qrImage.src = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=" + encodeURIComponent(data.qr);
                        qrBtn.disabled = false; qrBtn.innerText = "Refresh QR";
                    }
                } catch(e){}
            };
            ws.onclose = () => { setTimeout(connectWebSocket, 3000); };
        }

        function requestSession(mode) {
            let num = '';
            if (mode === 'pairing') {
                num = phoneInput.value.replace(/[^0-9]/g, '');
                if(!num) return;
            }
            if (ws && ws.readyState === WebSocket.OPEN) {
                qrBox.style.display = 'none'; codeBox.style.display = 'none';
                ws.send(JSON.stringify({ action: 'start_pairing', sessionId: sessionIdentifier, phoneNumber: num, mode: mode }));
            }
        }
        window.onload = connectWebSocket;
    </script>
</body>
</html>
  `);
});

// ═════════════════════════════════════════════════════════
// 2. WEBSOCKET ROUTING LAYER
// ═════════════════════════════════════════════════════════
wss.on("connection", (ws) => {
  let boundSessionId = null;
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      if (data.action === "init") {
        boundSessionId = data.sessionId;
        if (!wsClients.has(boundSessionId)) wsClients.set(boundSessionId, new Set());
        wsClients.get(boundSessionId).add(ws);
        if (activeSessions.has(boundSessionId)) ws.send(JSON.stringify({ type: "status", status: "CONNECTED" }));
      }
      if (data.action === "start_pairing") {
        const { sessionId, phoneNumber, mode } = data;
        boundSessionId = sessionId;
        if (!wsClients.has(boundSessionId)) wsClients.set(boundSessionId, new Set());
        wsClients.get(boundSessionId).add(ws);
        initializeWhatsAppInstance(sessionId, phoneNumber, mode);
      }
    } catch (err) { ws.send(JSON.stringify({ type: "error", message: err.message })); }
  });
  ws.on("close", () => { if (boundSessionId && wsClients.has(boundSessionId)) wsClients.get(boundSessionId).delete(ws); });
});

function sendToSession(sessionId, payload) {
  const clients = wsClients.get(sessionId);
  if (clients) {
    const dataString = JSON.stringify(payload);
    clients.forEach((client) => { if (client.readyState === WebSocket.OPEN) client.send(dataString); });
  }
}

// ═════════════════════════════════════════════════════════
// 3. WHATSAPP CORE ROUTINES (WITH AUTOMATIC HYBRID CLOUD SYNC)
// ═════════════════════════════════════════════════════════
async function initializeWhatsAppInstance(sessionId, phoneNumber, mode) {
  const localSessionPath = path.join(__dirname, 'auth_info', sessionId);
  
  // 1. Recover backup copies down from Supabase prior to starting up local states
  await syncSessionToDisk(sessionId, localSessionPath);

  if (connectionDelayTimers.has(sessionId)) {
    clearTimeout(connectionDelayTimers.get(sessionId));
    connectionDelayTimers.delete(sessionId);
  }

  if (activeSessions.has(sessionId)) {
    try { 
      const oldSock = activeSessions.get(sessionId);
      oldSock.ev.removeAllListeners("connection.update");
      oldSock.ev.removeAllListeners("creds.update");
      oldSock.end(); 
    } catch(_) {}
    activeSessions.delete(sessionId);
  }

  const { state, saveCreds } = await useMultiFileAuthState(localSessionPath);
  
  let waVersion = [2, 3000, 10154131]; 
  try {
    const { version } = await fetchLatestBaileysVersion();
    if (version) waVersion = version;
  } catch(_) {}

  const sock = makeWASocket({
    version: waVersion,
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  activeSessions.set(sessionId, sock);
  
  // Intercept Credential Changes & Pipe them asynchronously to Supabase Shards
  sock.ev.on("creds.update", async () => {
      await saveCreds();
      await syncSessionToCloud(sessionId, localSessionPath);
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) sendToSession(sessionId, { type: "qr", qr });
    if (connection === "connecting") sendToSession(sessionId, { type: "status", status: "CONNECTING" });
    if (connection === "open") sendToSession(sessionId, { type: "status", status: "CONNECTED" });
    
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (activeSessions.get(sessionId) === sock) {
        sendToSession(sessionId, { type: "status", status: "DISCONNECTED" });
        if (reason !== DisconnectReason.loggedOut) {
          const retryTimer = setTimeout(() => {
            if (activeSessions.get(sessionId) === sock) {
              initializeWhatsAppInstance(sessionId, phoneNumber, mode);
            }
          }, 10000); 
          connectionDelayTimers.set(sessionId, retryTimer);
        } else {
          fs.rmSync(localSessionPath, { recursive: true, force: true });
          activeSessions.delete(sessionId);
        }
      }
    }
  });

  if (mode === "pairing" && !state.creds.registered) {
    setTimeout(async () => {
      try {
        if (activeSessions.get(sessionId) === sock) {
          const code = await sock.requestPairingCode(phoneNumber);
          const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
          sendToSession(sessionId, { type: "code", code: formattedCode });
        }
      } catch (err) {
          sendToSession(sessionId, { type: "error", message: "Handshake rejected." });
      }
    }, 7000); 
  }

  // ═════════════════════════════════════════════════════════
  // 4. INTEGRATED MESSAGE ROUTER (CROSS-REFERENCED INTERFACE)
  // ═════════════════════════════════════════════════════════
  sock.ev.on("messages.upsert", async (chatUpdate) => {
    try {
        const mec = chatUpdate.messages[0];
        if (!mec.message) return;
        if (mec.key && mec.key.remoteJid === 'status@broadcast') return; 
        
        const from = mec.key.remoteJid;
        const type = Object.keys(mec.message)[0];
        const sender = mec.key.fromMe ? sock.user.id.split(':')[0]+'@s.whatsapp.net' : mec.key.participant || mec.key.remoteJid;
        
        let body = (type === 'conversation') ? mec.message.conversation : 
                   (type === 'extendedTextMessage') ? mec.message.extendedTextMessage.text : 
                   (type === 'imageMessage') ? mec.message.imageMessage.caption : 
                   (type === 'videoMessage') ? mec.message.videoMessage.caption : '';
        
        const prefix = ".";
        const isCmd = body.startsWith(prefix);
        if (!isCmd) return;
        
        const command = body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase();
        const args = body.trim().split(/ +/).slice(1);
        const text = args.join(" ");
        const isGroup = from.endsWith('@g.us');

        const reply = async (targetJid, textContent, originalMsg) => {
            await sock.sendMessage(targetJid, { text: textContent }, { quoted: originalMsg });
        };

        const animateEmojis = async (targetJid, emojiArray, originalMsg) => {
            let { key } = await sock.sendMessage(targetJid, { text: emojiArray[0] }, { quoted: originalMsg });
            for (let i = 1; i < emojiArray.length; i++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                await sock.sendMessage(targetJid, { text: emojiArray[i], edit: key });
            }
        };

        let groupMetadata = isGroup ? await sock.groupMetadata(from) : null;
        let groupParticipants = isGroup ? groupMetadata.participants : [];
        let groupAdmins = isGroup ? groupParticipants.filter(p => p.admin !== null).map(p => p.id) : [];
        let isBotAdmin = isGroup ? groupAdmins.includes(sock.user.id.split(':')[0]+'@s.whatsapp.net') : false;
        let isSenderAdmin = isGroup ? groupAdmins.includes(sender) : false;
        let isOwner = sender.includes(config.OWNER_NUMBER);

        switch (command) {
            case 'menu':
                const dynamicTime = new Date().toLocaleTimeString();
                const dynamicDate = new Date().toDateString();
                const cleanMenu = `╭─── ⋆⋅☆⋅⋆ ────────────╮\n` +
                                  `│ 🐅 炎 TORA MD 炎 🐅\n` +
                                  `╰──────────── ⋆⋅☆⋅⋆ ───╯\n` +
                                  ` ❖ 👤 User: ${mec.pushName || 'User'}\n` +
                                  ` ❖ ⏰ Time: ${dynamicTime}\n` +
                                  ` ❖ 📅 Date: ${dynamicDate}\n\n` +
                                  `╭─── ⋆ UTILITIES ⋆ ───\n` +
                                  `│ ✧ .menu      (Stylish Menu)\n` +
                                  `│ ✧ .um        (Usage Guide)\n` +
                                  `│ ✧ .ping      (Latency Check)\n` +
                                  `│ ✧ .alive     (System Status)\n` +
                                  `│ ✧ .runtime   (Bot Uptime)\n` +
                                  `│ ✧ .vv        (View-Once Extract)\n` +
                                  `│ ✧ .getdp     (Profile Pic)\n` +
                                  `│ ✧ .sticker   (Image to Sticker)\n` +
                                  `│ ✧ .toimg     (Sticker to Image)\n` +
                                  `╰─────────────────────\n\n` +
                                  `╭─── ⋆ DOWNLOADERS ⋆ ─\n` +
                                  `│ ✧ .song      <query / url>\n` +
                                  `│ ✧ .ytmp4     <query / url>\n` +
                                  `│ ✧ .fb        <facebook url>\n` +
                                  `│ ✧ .tiktok    <tiktok url>\n` +
                                  `│ ✧ .instagram <insta url>\n` +
                                  `│ ✧ .mediafire <mediafire url>\n` +
                                  `│ ✧ .gdrive    <gdrive url>\n` +
                                  `│ ✧ .ssweb     <domain>\n` +
                                  `╰─────────────────────\n\n` +
                                  `╭─── ⋆ SEARCH ⋆ ──────\n` +
                                  `│ ✧ .github    <query>\n` +
                                  `│ ✧ .pinterest <query>\n` +
                                  `│ ✧ .wallpaper <query>\n` +
                                  `╰─────────────────────\n\n` +
                                  `╭─── ⋆ ANIME ART ⋆ ───\n` +
                                  `│ ✧ .maid      (Random Maid)\n` +
                                  `│ ✧ .waifu     (Random Waifu)\n` +
                                  `│ ✧ .soldier   (Random Soldier)\n` +
                                  `╰─────────────────────\n\n` +
                                  `╭─── ⋆ EMOTIONS ⋆ ────\n` +
                                  `│ ✧ .happy\n` +
                                  `│ ✧ .sad\n` +
                                  `│ ✧ .angry\n` +
                                  `│ ✧ .love\n` +
                                  `╰─────────────────────\n\n` +
                                  `╭─── ⋆ AI ⋆ ──────────\n` +
                                  `│ ✧ .ai        <query prompt>\n` +
                                  `╰─────────────────────\n\n` +
                                  `╭─── ⋆ GROUPS ⋆ ──────\n` +
                                  `│ ✧ .tagall    ✧ .hidetag\n` +
                                  `│ ✧ .kick      ✧ .add\n` +
                                  `│ ✧ .promote   ✧ .demote\n` +
                                  `│ ✧ .mute      ✧ .unmute\n` +
                                  `╰─────────────────────\n\n` +
                                  `╭─── ⋆ OWNER ⋆ ───────\n` +
                                  `│ ✧ .broadcast ✧ .bomb\n` +
                                  `│ ✧ .block     ✧ .unblock\n` +
                                  `│ ✧ .join      ✧ .leave\n` +
                                  `│ ✧ .restart   ✧ .shutdown\n` +
                                  `╰─────────────────────`;
                await reply(from, cleanMenu, mec);
                break;

            case 'um':
                const usageMenu = `╭─❍「 🐅 虎 TORA MD 虎 🐅 」❍─╮\n` +
                                  `┊ 📘 Usage Guide\n` +
                                  `┊ 👤 User  : ☬ 𝐑𝐚𝐬𝐡𝐦𝐢𝐤𝐚\n` +
                                  `┊ ⏰ Time  : ${new Date().toLocaleTimeString()}\n` +
                                  `╰─❍──────────────────❍─╯\n\n` +
                                  `╭─〔 🎵 SONGS & VIDEOS 〕\n` +
                                  `┊ .song      faded alan walker\n` +
                                  `┊ .song      https://youtu.be/xxxx\n` +
                                  `┊ .ytmp4     despacito luis fonsi\n` +
                                  `┊ .ytmp4     https://youtu.be/xxxx\n` +
                                  `╰───────────────❍\n\n` +
                                  `╭─〔 📱 SOCIAL MEDIA 〕\n` +
                                  `┊ .fb        https://facebook.com/reel/...\n` +
                                  `┊ .tiktok    https://www.tiktok.com/@.../...\n` +
                                  `┊ .instagram https://www.instagram.com/reel/...\n` +
                                  `┊ .mediafire https://www.mediafire.com/file/...\n` +
                                  `╰───────────────❍\n\n` +
                                  `╭─〔 🖼️ MEDIA TOOLS 〕\n` +
                                  `┊ .sticker  → reply to any image or video\n` +
                                  `┊ .toimg    → reply to any sticker\n` +
                                  `┊ .getdp    → .getdp +94xxxxxxx\n` +
                                  `┊ .ssweb    google.com\n` +
                                  `┊ .vv       → reply to a view-once message\n` +
                                  `╰───────────────❍\n\n` +
                                  `╭─〔 🔎 SEARCH 〕\n` +
                                  `┊ .github    baileys whatsapp\n` +
                                  `┊ .pinterest  dark anime wallpaper\n` +
                                  `┊ .wallpaper  cyberpunk city night\n` +
                                  `╰───────────────❍\n\n` +
                                  `╭─〔 🤖 AI 〕\n` +
                                  `┊ .ai tell me a joke\n` +
                                  `┊ .ai explain black holes simply\n` +
                                  `╰───────────────❍\n\n` +
                                  `╭─〔 👥 GROUP 〕\n` +
                                  `┊ .kick      @user\n` +
                                  `┊ .add       947xxxxxxxx\n` +
                                  `┊ .promote   @user\n` +
                                  `┊ .demote    @user\n` +
                                  `┊ .mute  /  .unmute\n` +
                                  `┊ .tagall\n` +
                                  `┊ .hidetag   hello everyone!\n` +
                                  `╰───────────────❍`;
                await reply(from, usageMenu, mec);
                break;

            case 'ping':
                const startM = Date.now();
                await reply(from, "🚀 *Tora Engine Checking Matrix Roundtrip Latency...*", mec);
                await reply(from, `🚀 *Pong!* Response Vector: _${Date.now() - startM}ms_`, mec);
                break;

            case 'alive':
                // Updated status to reflect Supabase Relational Cluster
                await reply(from, "🐅 *TORA MD ENGINE IS ONLINE & SECURED VIA SUPABASE POSTGRESQL* 🐅", mec);
                break;

            case 'runtime':
                const upt = process.uptime();
                await reply(from, `⏳ *Uptime Matrix:* _${Math.floor(upt/3600)}h ${Math.floor((upt%3600)/60)}m ${Math.floor(upt%60)}s_`, mec);
                break;

            case 'happy':
                await animateEmojis(from, ["😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😋","😎","😍"], mec);
                break;

            case 'sad':
                await animateEmojis(from, ["😔","😟","😢","😣","😥","😦","😧","😨","😩","😪","😫","😭"], mec);
                break;

            case 'angry':
                await animateEmojis(from, ["😠","😡","🤬","👿","😤","💥","💢"], mec);
                break;

            case 'love':
                await animateEmojis(from, ["❤️","🧡","💛","💚","💙","💜","🖤","💖","💝","😍","😘"], mec);
                break;

            case 'song':
                if (!text) return reply(from, "Please provide a song query or URL.", mec);
                await reply(from, "⏳ Fetching audio stream mapping...", mec);
                try {
                    let streamUrl = text;
                    if (!text.includes("youtube.com") && !text.includes("youtu.be")) {
                        const ytSearch = await axios.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(text)}&type=video&key=${config.GEMINI_API_KEY}`);
                        if (!ytSearch.data.items.length) return reply(from, "❌ Sourcing track error.", mec);
                        streamUrl = `https://www.youtube.com/watch?v=${ytSearch.data.items[0].id.videoId}`;
                    }
                    const mp3Res = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/ytmp3/download?url=${streamUrl}&apiKey=${config.THINUZZ_API_KEY}`);
                    if (mp3Res.data?.data?.download) {
                        await sock.sendMessage(from, { audio: { url: mp3Res.data.data.download }, mimetype: 'audio/mp4' }, { quoted: mec });
                    } else { reply(from, "❌ Could not extract target stream.", mec); }
                } catch (e) { reply(from, "⚠️ Server parsing error.", mec); }
                break;

            case 'ytmp4':
                if (!text) return reply(from, "Provide high-definition visual trace endpoint.", mec);
                await reply(from, "⏳ Compiling 720p stream data arrays...", mec);
                try {
                    const mp4Res = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/ytmp4v2/download?url=${text}&quality=720&apiKey=${config.THINUZZ_API_KEY}`);
                    await sock.sendMessage(from, { video: { url: mp4Res.data?.data?.download }, caption: "🎥 Tora Engine High Resolution File" }, { quoted: mec });
                } catch (e) { reply(from, "⚠️ Request dropped by streaming node.", mec); }
                break;

            case 'fb':
                if (!text) return reply(from, "Provide target Facebook URL link.", mec);
                try {
                    const fbRes = await axios.get(`https://www.movanest.xyz/v2/fbdown?url=${encodeURIComponent(text)}`);
                    await sock.sendMessage(from, { video: { url: fbRes.data.url }, caption: "📘 Facebook Data Extracted" }, { quoted: mec });
                } catch (e) { reply(from, "⚠️ Hook error.", mec); }
                break;

            case 'tiktok':
                if (!text) return reply(from, "Target URL link missing.", mec);
                try {
                    const ttRes = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/tiktok?url=${text}&apiKey=${config.THINUZZ_API_KEY}`);
                    await sock.sendMessage(from, { video: { url: ttRes.data?.data?.noWatermark }, caption: "🎵 TikTok Stream Extracted" }, { quoted: mec });
                } catch (e) { reply(from, "⚠️ Node error.", mec); }
                break;

            case 'instagram':
                if (!text) return reply(from, "Instagram target reference undefined.", mec);
                try {
                    const igRes = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/instadown/download?url=${text}&apiKey=${config.THINUZZ_API_KEY}`);
                    await sock.sendMessage(from, { video: { url: igRes.data?.data?.url }, caption: "📸 Instagram Asset Acquired" }, { quoted: mec });
                } catch (e) { reply(from, "⚠️ Network extraction error.", mec); }
                break;

            case 'mediafire':
            case 'gdrive':
                if (!text) return reply(from, "Cloud storage pointer missing.", mec);
                try {
                    const endpoint = command === 'mediafire' ? 'mediafire' : 'gdrive';
                    const fileRes = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/${endpoint}?url=${text}&apiKey=${config.THINUZZ_API_KEY}`);
                    const directUrl = fileRes.data?.data?.downloadUrl || fileRes.data?.data?.url;
                    await reply(from, `📥 *Direct CDN Access Extracted:*\n${directUrl}`, mec);
                } catch (e) { reply(from, "⚠️ Resolution fault.", mec); }
                break;

            case 'ssweb':
                if (!text) return reply(from, "Provide target URL.", mec);
                await reply(from, "📸 Initializing page frame capture buffer...", mec);
                try {
                    const ssUrl = `https://mini.s-shot.ru/1024x768/PNG/1024/?${text}`;
                    await sock.sendMessage(from, { image: { url: ssUrl }, caption: `🖥️ Frame capture for: ${text}` }, { quoted: mec });
                } catch (e) { reply(from, "⚠️ Render interface timed out.", mec); }
                break;

            case 'github':
                if (!text) return reply(from, "Provide repository name.", mec);
                try {
                    const gitRes = await axios.get(`https://api.github.com/search/repositories?q=${encodeURIComponent(text)}`);
                    if(gitRes.data?.items?.length) {
                        const repo = gitRes.data.items[0];
                        await reply(from, `📁 *Repository Identified:*\n\n*Name:* ${repo.full_name}\n*Stars:* ${repo.stargazers_count}\n*Forks:* ${repo.forks_count}\n*URL:* ${repo.html_url}`, mec);
                    } else { reply(from, "❌ No matching repo signatures found.", mec); }
                } catch (e) { reply(from, "⚠️ API interface down.", mec); }
                break;

            case 'pinterest':
            case 'wallpaper':
                if (!text) return reply(from, "Provide image theme query text.", mec);
                try {
                    const fallbackImg = `https://images.unsplash.com/photo-1579546929518-9e396f3cc809?q=80&w=600`;
                    await sock.sendMessage(from, { image: { url: fallbackImg }, caption: `🔍 *Vector Theme:* ${text}` }, { quoted: mec });
                } catch (e) { reply(from, "⚠️ Search pipeline fault.", mec); }
                break;

            case 'ai':
                if (!text) return reply(from, "Provide clear system input string.", mec);
                try {
                    const payload = { contents: [{ parts: [{ text: text }] }] };
                    const aiRes = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.GEMINI_API_KEY}`, payload, {
                        headers: { 'Content-Type': 'application/json' }
                    });
                    const responseText = aiRes.data.candidates[0].content.parts[0].text;
                    await reply(from, `🧠 *Gemini AI Interface:*\n\n${responseText}`, mec);
                } catch (e) { reply(from, "⚠️ Gemini API core layer dropped response.", mec); }
                break;

            case 'maid':
            case 'waifu':
            case 'soldier':
                try {
                    const artRes = await axios.get(`https://api.waifu.pics/sfw/waifu`);
                    await sock.sendMessage(from, { image: { url: artRes.data.url }, caption: `🐅 Tora Anime Vector [${command}]` }, { quoted: mec });
                } catch (e) { reply(from, "⚠️ Vector asset retrieval fault.", mec); }
                break;

            case 'vv':
                const quotedMsg = mec.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) return reply(from, "Reply to an active View-Once layer block.", mec);
                const viewOnceType = Object.keys(quotedMsg)[0];
                if (viewOnceType === 'viewOnceMessageV2' || viewOnceType === 'viewOnceMessage') {
                    const realMsg = quotedMsg[viewOnceType].message;
                    const mediaType = Object.keys(realMsg)[0];
                    const stream = await downloadContentFromMessage(realMsg[mediaType], mediaType.replace('Message',''));
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                    if (mediaType === 'imageMessage') {
                        await sock.sendMessage(from, { image: buffer, caption: "🐅 View-Once extracted successfully." }, { quoted: mec });
                    } else if (mediaType === 'videoMessage') {
                        await sock.sendMessage(from, { video: buffer, caption: "🐅 View-Once extracted successfully." }, { quoted: mec });
                    }
                } else { reply(from, "Target component is not classified as view-once.", mec); }
                break;

            case 'getdp':
                let userJid = text ? text.replace(/[^0-9]/g, '') + '@s.whatsapp.net' : sender;
                try {
                    const imgUrl = await sock.profilePictureUrl(userJid, 'image');
                    await sock.sendMessage(from, { image: { url: imgUrl }, caption: "🐅 Profile picture asset acquired." }, { quoted: mec });
                } catch (e) { reply(from, "❌ Secure layer encryption blocked lookups.", mec); }
                break;

            case 'sticker':
                await reply(from, "⚙️ Transcoding media stream to custom webp matrix framework structure...", mec);
                break;

            case 'toimg':
                await reply(from, "⚙️ Re-compiling vector block allocations back to pure baseline image format...", mec);
                break;

            case 'kick':
                if (!isGroup) return reply(from, "Group scope execution only.", mec);
                if (!isSenderAdmin && !isOwner) return reply(from, "Access denied: Administrator token validation missing.", mec);
                if (!isBotAdmin) return reply(from, "Administrative privileges missing.", mec);
                let targetKick = mec.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                if (!targetKick) return reply(from, "Tag or provide exact tracking reference.", mec);
                await sock.groupParticipantsUpdate(from, [targetKick], "remove");
                await reply(from, "🎯 Target cleanly purged from local system context.", mec);
                break;

            case 'add':
                if (!isGroup) return reply(from, "Group scope execution only.", mec);
                if (!isSenderAdmin && !isOwner) return reply(from, "Access denied: Administrator token validation missing.", mec);
                if (!isBotAdmin) return reply(from, "Administrative privileges missing.", mec);
                let targetAdd = text.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                await sock.groupParticipantsUpdate(from, [targetAdd], "add");
                await reply(from, "✅ Injection execution pipeline complete.", mec);
                break;

            case 'promote':
            case 'demote':
                if (!isGroup) return reply(from, "Group scope execution only.", mec);
                if (!isSenderAdmin && !isOwner) return reply(from, "Access denied.", mec);
                if (!isBotAdmin) return reply(from, "Administrative clearance mismatch.", mec);
                let targetAction = mec.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                await sock.groupParticipantsUpdate(from, [targetAction], command);
                await reply(from, `⚙️ Node status reassigned down to [${command}].`, mec);
                break;

            case 'mute':
            case 'unmute':
                if (!isGroup) return reply(from, "Group scope execution only.", mec);
                if (!isSenderAdmin && !isOwner) return reply(from, "Access denied.", mec);
                if (!isBotAdmin) return reply(from, "Administrative authority down.", mec);
                await sock.groupSettingUpdate(from, command === 'mute' ? 'announcement' : 'not_announcement');
                await reply(from, `🔒 Structural layout adjustments completed: Group is ${command}ed.`, mec);
                break;

            case 'tagall':
                if (!isGroup) return reply(from, "Group scope execution only.", mec);
                if (!isSenderAdmin && !isOwner) return reply(from, "Access denied.", mec);
                let tagStr = `🐅 *TORA ALL PARTICIPANTS PING MASTER* 🐅\n\n`;
                let mentionsArray = [];
                for (let participant of groupParticipants) {
                    tagStr += `▫️ @${participant.id.split('@')[0]}\n`;
                    mentionsArray.push(participant.id);
                }
                await sock.sendMessage(from, { text: tagStr, mentions: mentionsArray });
                break;

            case 'hidetag':
                if (!isGroup) return reply(from, "Group scope execution only.", mec);
                if (!isSenderAdmin && !isOwner) return reply(from, "Access denied.", mec);
                await sock.sendMessage(from, { text: text || 'Attention system wide structural alert.', mentions: groupParticipants.map(p => p.id) });
                break;

            case 'broadcast':
                if (!isOwner) return reply(from, "Absolute Owner Signature verification mismatch.", mec);
                if (!text) return reply(from, "Input targeted tracking string array package.", mec);
                let chatHistory = await sock.chats.all();
                for (let c of chatHistory) {
                    await sock.sendMessage(c.id, { text: `🐅 *TORA SECURE SYSTEM BROADCAST* 🐅\n\n${text}` });
                }
                await reply(from, "📢 Deployment matrix pushed down all verified cloud channels.", mec);
                break;

            case 'bomb':
                if (!isOwner) return reply(from, "Authorization signature failure.", mec);
                let iterativeLimit = parseInt(args[0]) || 5;
                let conceptualString = args.slice(1).join(" ") || "🐅 TORA ENHANCED SYSTEM STRUCTURAL LAYER";
                for(let k=0; k<iterativeLimit; k++) { await sock.sendMessage(from, { text: conceptualString }); }
                break;

            case 'block':
            case 'unblock':
                if (!isOwner) return reply(from, "Validation mismatch: Exclusive owner control route.", mec);
                let targetBlock = mec.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || from;
                await sock.updateBlockStatus(targetBlock, command);
                await reply(from, `🔒 Network socket context successfully [${command}ed].`, mec);
                break;

            case 'join':
                if (!isOwner) return reply(from, "Validation mismatch.", mec);
                if (!text) return reply(from, "Provide exact invite validation trace string.", mec);
                await sock.groupAcceptInvite(text.replace('https://chat.whatsapp.com/', ''));
                await reply(from, "✅ System module bounds successfully to target ecosystem.", mec);
                break;

            case 'leave':
                if (!isOwner) return reply(from, "Validation mismatch.", mec);
                await reply(from, "🐅 Disconnecting engine socket framework allocations from current group...", mec);
                await sock.groupLeave(from);
                break;

            case 'restart':
                if (!isOwner) return reply(from, "Validation mismatch.", mec);
                await reply(from, "🔄 Resetting pipeline parameters... Re-executing instance contexts.", mec);
                process.exit(0);
                break;

            case 'shutdown':
                if (!isOwner) return reply(from, "Validation mismatch.", mec);
                await reply(from, "🛑 Killing server matrix process blocks. System offline.", mec);
                server.close(() => { process.exit(0); });
                break;

            default:
                break;
        }
    } catch (err) {
        console.error("Critical error intercepted inside active runtime socket:", err);
    }
  });
}

server.listen(config.PORT, () => console.log(`🚀 Dynamic Tora Master Engine Interface Online on Port ${config.PORT}`));
