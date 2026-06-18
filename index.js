require('dotenv').config();
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  fetchLatestBaileysVersion 
} = require("@whiskeysockets/baileys");
const express = require("express");
const { createServer } = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const pino = require("pino");
const fs = require("fs");
const axios = require("axios");

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const sessionIdentifier = "tora_session";

const activeSessions = new Map(); 
const wsClients = new Map(); 
const connectionDelayTimers = new Map();

app.use(express.json());

// ═════════════════════════════════════════════════════════
// 1. WEB DASHBOARD UI
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
        .log-entry { margin-bottom: 4px; } .log-success { color: var(--success); } .log-error { color: var(--error); }
        .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: var(--error); }
        .status-dot.connected { background-color: var(--success); box-shadow: 0 0 8px var(--success); }
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

        <div class="terminal" id="terminal"><div class="log-entry">System ready to verify...</div></div>
    </div>

    <script>
        let ws; let currentMode = 'qr'; const sessionIdentifier = "${sessionIdentifier}";
        const terminal = document.getElementById('terminal'); const codeBox = document.getElementById('codeBox');
        const qrBox = document.getElementById('qrBox'); const qrImage = document.getElementById('qrImage');
        const pairingCodeText = document.getElementById('pairingCode'); const pairBtn = document.getElementById('pairBtn');
        const qrBtn = document.getElementById('qrBtn'); const phoneInput = document.getElementById('phoneNumber');
        const wsStatus = document.getElementById('ws-status'); const wsText = document.getElementById('ws-text');

        function appendLog(msg, type='info') {
            const el = document.createElement('div'); el.className = 'log-entry log-'+type;
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
                wsStatus.className = 'status-dot connected'; wsText.innerText = 'System Online'; wsText.style.color = 'var(--success)';
                ws.send(JSON.stringify({ action: 'init', sessionId: sessionIdentifier }));
            };
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'status') {
                        appendLog('State: ' + data.status);
                        if (data.status === 'CONNECTED') {
                            pairBtn.innerText = "Linked!"; qrBtn.innerText = "Linked!";
                            pairBtn.disabled = false; qrBtn.disabled = false;
                            qrBox.style.display = 'none'; codeBox.style.display = 'none';
                        }
                        if (data.status === 'DISCONNECTED') {
                            pairBtn.disabled = false; pairBtn.innerText = "Generate Pairing Code";
                            qrBtn.disabled = false; qrBtn.innerText = "Get QR Code";
                        }
                    } else if (data.type === 'error') {
                        appendLog(data.message, 'error'); 
                        pairBtn.disabled = false; pairBtn.innerText = "Try Again";
                        qrBtn.disabled = false; qrBtn.innerText = "Get QR Code";
                    } else if (data.type === 'code') {
                        codeBox.style.display = 'block'; pairingCodeText.innerText = data.code;
                        appendLog('Pairing Code Ready!', 'success'); pairBtn.disabled = false; pairBtn.innerText = "Regenerate Code";
                    } else if (data.type === 'qr') {
                        qrBox.style.display = 'block';
                        qrImage.src = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=" + encodeURIComponent(data.qr);
                        appendLog('New QR signature received.', 'success'); qrBtn.disabled = false; qrBtn.innerText = "Refresh QR";
                    }
                } catch(e){}
            };
            ws.onclose = () => {
                wsStatus.className = 'status-dot'; wsText.innerText = 'Disconnected'; wsText.style.color = 'var(--error)';
                setTimeout(connectWebSocket, 3000);
            };
        }

        function requestSession(mode) {
            let num = '';
            if (mode === 'pairing') {
                num = phoneInput.value.replace(/[^0-9]/g, '');
                if(!num) return appendLog('Please enter a valid phone number.', 'error');
            }
            if (ws && ws.readyState === WebSocket.OPEN) {
                qrBox.style.display = 'none'; codeBox.style.display = 'none';
                ws.send(JSON.stringify({ action: 'start_pairing', sessionId: sessionIdentifier, phoneNumber: num, mode: mode }));
                if(mode === 'pairing') { pairBtn.disabled = true; pairBtn.innerText = "Requesting System..."; }
                if(mode === 'qr') { qrBtn.disabled = true; qrBtn.innerText = "Requesting QR..."; }
            }
        }
        window.onload = connectWebSocket;
    </script>
</body>
</html>
  `);
});

// ═════════════════════════════════════════════════════════
// 2. WEBSOCKET ROUTING
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
// 3. CORE ENGINE & CONNECTION LOGIC
// ═════════════════════════════════════════════════════════
async function initializeWhatsAppInstance(sessionId, phoneNumber, mode) {
  const sessionPath = `./auth_info/${sessionId}`;
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

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

  try {
    if (fs.existsSync(`${sessionPath}/creds.json`)) {
      const stat = fs.statSync(`${sessionPath}/creds.json`);
      if (stat.size < 50) { 
        fs.rmSync(sessionPath, { recursive: true, force: true });
        fs.mkdirSync(sessionPath, { recursive: true });
      }
    }
  } catch(e){}

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  
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
  sock.ev.on("creds.update", saveCreds);

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
          fs.rmSync(sessionPath, { recursive: true, force: true });
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
        if (activeSessions.get(sessionId) === sock) {
          sendToSession(sessionId, { type: "error", message: "Handshake rejected. Try again." });
        }
      }
    }, 7000); 
  }

  // ═════════════════════════════════════════════════════════
  // 4. COMMAND HANDLER & API INTEGRATIONS
  // ═════════════════════════════════════════════════════════
  sock.ev.on("messages.upsert", async (chatUpdate) => {
    try {
        const mec = chatUpdate.messages[0];
        if (!mec.message) return;
        
        if (mec.key && mec.key.remoteJid === 'status@broadcast') return; 
        
        const from = mec.key.remoteJid;
        const type = Object.keys(mec.message)[0];
        
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

        // Helper function for quick replies
        const reply = async (targetJid, textContent, originalMsg) => {
            await sock.sendMessage(targetJid, { text: textContent }, { quoted: originalMsg });
        };

        switch (command) {
            case 'ping':
                const startTime = Date.now();
                await reply(from, "Calculating latency...", mec);
                const latency = Date.now() - startTime;
                await reply(from, `🚀 *Pong!* Latency: _${latency}ms_`, mec);
                break;

            case 'menu':
            case 'help':
                const menuText = `🐅 *TORA MD ENGINE* 🐅\n\n` +
                                 `*Media Commands:*\n` +
                                 `▫️ \`.song <query>\` - Download MP3 audio\n` +
                                 `▫️ \`.mp4 <url>\` - Download YouTube video\n` +
                                 `▫️ \`.fb <url>\` - Download Facebook video\n` +
                                 `▫️ \`.tt <url>\` - Download TikTok video\n` +
                                 `▫️ \`.insta <url>\` - Download IG Reel/Post\n\n` +
                                 `*Utility Commands:*\n` +
                                 `▫️ \`.ai <prompt>\` - Ask Gemini AI\n` +
                                 `▫️ \`.news\` - Get latest updates\n` +
                                 `▫️ \`.mediafire <url>\` - Extract direct link\n` +
                                 `▫️ \`.gdrive <url>\` - Extract direct link\n` +
                                 `▫️ \`.runtime\` - Check bot uptime\n` +
                                 `▫️ \`.groupinfo\` - Group metadata\n`;
                await reply(from, menuText, mec);
                break;

            case 'runtime':
                const uptime = process.uptime();
                const hours = Math.floor(uptime / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                const seconds = Math.floor(uptime % 60);
                await reply(from, `⏳ *Uptime:* _${hours}h ${minutes}m ${seconds}s_`, mec);
                break;

            case 'groupinfo':
                if (!isGroup) return reply(from, "This command can only be used in groups!", mec);
                const groupMetadata = await sock.groupMetadata(from);
                const groupDesc = groupMetadata.desc ? groupMetadata.desc : "No description set.";
                const info = `👥 *Group Name:* ${groupMetadata.subject}\n` +
                             `👑 *Creator:* ${groupMetadata.owner.split('@')[0]}\n` +
                             `👥 *Members:* ${groupMetadata.participants.length}\n\n` +
                             `📝 *Description:* ${groupDesc}`;
                await reply(from, info, mec);
                break;

            case 'song':
                if (!text) return reply(from, "Please provide a song name or URL.", mec);
                await reply(from, "⏳ Searching and downloading audio...", mec);
                try {
                    let videoUrl = text;
                    if (!text.includes("youtube.com") && !text.includes("youtu.be")) {
                        const ytSearch = await axios.get(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(text)}&type=video&key=AIzaSyCEq9oJnzf5eFhkqdLlM_ggjCifaC4kk5o`);
                        if (!ytSearch.data.items.length) return reply(from, "❌ Could not find that track.", mec);
                        videoUrl = `https://www.youtube.com/watch?v=${ytSearch.data.items[0].id.videoId}`;
                    }

                    const mp3Res = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/ytmp3/download?url=${videoUrl}&apiKey=key_6eff37305f63aa5c`);
                    const audioDlUrl = mp3Res.data?.data?.download; 
                    
                    if (audioDlUrl) {
                        await sock.sendMessage(from, { audio: { url: audioDlUrl }, mimetype: 'audio/mp4' }, { quoted: mec });
                    } else {
                        reply(from, "❌ Failed to fetch audio stream.", mec);
                    }
                } catch (e) {
                    reply(from, "⚠️ Error processing song request.", mec);
                }
                break;

            case 'mp4':
                if (!text) return reply(from, "Please provide a YouTube URL.", mec);
                await reply(from, "⏳ Fetching 720p video...", mec);
                try {
                    const mp4Res = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/ytmp4v2/download?url=${text}&quality=720&apiKey=key_6eff37305f63aa5c`);
                    const videoDlUrl = mp4Res.data?.data?.download;
                    await sock.sendMessage(from, { video: { url: videoDlUrl }, caption: "🎥 Tora MD Video Downloader" }, { quoted: mec });
                } catch (e) {
                    reply(from, "⚠️ Failed to fetch video.", mec);
                }
                break;

            case 'fb':
                if (!text) return reply(from, "Please provide a Facebook video URL.", mec);
                try {
                    const fbRes = await axios.get(`https://www.movanest.xyz/v2/fbdown?url=${encodeURIComponent(text)}`);
                    await sock.sendMessage(from, { video: { url: fbRes.data.url }, caption: "📘 Tora MD" }, { quoted: mec });
                } catch (e) {
                    reply(from, "⚠️ Error downloading FB video.", mec);
                }
                break;

            case 'tt':
                if (!text) return reply(from, "Please provide a TikTok URL.", mec);
                try {
                    const ttRes = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/tiktok?url=${text}&apiKey=key_6eff37305f63aa5c`);
                    await sock.sendMessage(from, { video: { url: ttRes.data?.data?.noWatermark }, caption: "🎵 No Watermark TT" }, { quoted: mec });
                } catch (e) {
                    reply(from, "⚠️ Error downloading TikTok.", mec);
                }
                break;

            case 'insta':
                if (!text) return reply(from, "Please provide an Instagram Reel/Post URL.", mec);
                try {
                    const igRes = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/instadown/download?url=${text}&apiKey=key_6eff37305f63aa5c`);
                    await sock.sendMessage(from, { video: { url: igRes.data?.data?.url }, caption: "📸 IG Download" }, { quoted: mec });
                } catch (e) {
                    reply(from, "⚠️ Error downloading IG media.", mec);
                }
                break;
/*
            case 'ai':
                if (!text) return reply(from, "What do you want to ask Gemini?", mec);
                try {
                    const geminiKey = 'AIzaSyA0vT-XYECtNyqGODgvW-uLEud2ywZY558';
                    const payload = { contents: [{ parts: [{ text: text }] }] };
                    const aiRes = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, payload);
                    
                    const responseText = aiRes.data.candidates[0].content.parts[0].text;
                   await reply(from, `🧠 *Gemini AI:*\n\n${responseText}`, mec);
                } catch (e) {
                    reply(from, "⚠️ Gemini API is currently unreachable.", mec);
                }
                break;

            case 'news':
                try {
                    const newsRes = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/lankadeepa/latest-news?page=1&apiKey=key_6eff37305f63aa5c`);
                    const headline = newsRes.data?.data[0]?.title || "No news available.";
                    const link = newsRes.data?.data[0]?.url || "";
                    await reply(from, `📰 *Latest Update:*\n\n${headline}\n${link}`, mec);
                } catch (e) {
                    reply(from, "⚠️ Failed to fetch news.", mec);
                }
                break; */

case 'ai':
                if (!text) return reply(from, "What do you want to ask Gemini?", mec);
                try {
                    const geminiKey = 'AIzaSyA0vT-XYECtNyqGODgvW-uLEud2ywZY558';
                    const payload = { contents: [{ parts: [{ text: text }] }] };
                    const aiRes = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, payload, {
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    const responseText = aiRes.data.candidates[0].content.parts[0].text;
                    await reply(from, `🧠 *Gemini AI:*\n\n${responseText}`, mec);
                } catch (e) {
                    console.error("AI Command Error:", e.response ? e.response.data : e.message);
                    reply(from, "⚠️ Gemini API is currently unreachable.", mec);
                }
                break;

            case 'news':
                try {
                    const newsRes = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/lankadeepa/latest-news?page=1&apiKey=key_6eff37305f63aa5c`);
                    
                    // The API might be returning an empty array if no news is found
                    if (!newsRes.data || !newsRes.data.data || newsRes.data.data.length === 0) {
                         return reply(from, "📰 API returned empty data.", mec);
                    }
                    
                    const headline = newsRes.data.data[0].title || "No title found.";
                    const link = newsRes.data.data[0].url || "";
                    await reply(from, `📰 *Latest Update:*\n\n${headline}\n${link}`, mec);
                } catch (e) {
                    console.error("News Command Error:", e.message);
                    reply(from, "⚠️ Failed to fetch news.", mec);
                }
                break;
  
          case 'mediafire':
            case 'gdrive':
                if (!text) return reply(from, `Please provide a valid ${command} link.`, mec);
                try {
                    const endpoint = command === 'mediafire' ? 'mediafire' : 'gdrive';
                    const fileRes = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/${endpoint}?url=${text}&apiKey=key_6eff37305f63aa5c`);
                    const directUrl = fileRes.data?.data?.downloadUrl || fileRes.data?.data?.url;
                    await reply(from, `📥 *Direct Download Link extracted:*\n${directUrl}`, mec);
                } catch (e) {
                    reply(from, `⚠️ Failed to extract ${command} link.`, mec);
                }
                break;

            default:
                break;
        }
    } catch (err) {
        console.error("Error handling message stream:", err);
    }
  });
}

server.listen(PORT, () => console.log(`🚀 Master Gateway online on port ${PORT}`));
