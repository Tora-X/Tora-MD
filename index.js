require('dotenv').config();
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason,
  Browsers
} = require("@whiskeysockets/baileys");
const express = require("express");
const { createServer } = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const pino = require("pino");
const fs = require("fs");

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const prefix = process.env.PREFIX || ".";

const activeSessions = new Map(); 
const wsClients = new Map(); 
const sessionIdentifier = "tora_session";

app.use(express.json());

// Serving the custom Neon Dark UI with highly rounded elements
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tora MD | Gateway</title>
    <style>
        :root {
            --bg-color: #05070f;
            --card-bg: #0c1020;
            --primary: #00ffcc;
            --primary-glow: rgba(0, 255, 204, 0.3);
            --text-main: #f1f5f9;
            --text-muted: #64748b;
            --error: #ff3366;
            --success: #00ff66;
            --terminal-bg: #02040a;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; }
        body { background-color: var(--bg-color); color: var(--text-main); display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        
        .container { 
            background-color: var(--card-bg); 
            padding: 35px; 
            border-radius: 24px; 
            border: 1px solid rgba(0, 255, 204, 0.15);
            box-shadow: 0 0 30px rgba(0, 255, 204, 0.05); 
            width: 100%; 
            max-width: 460px; 
            text-align: center; 
        }
        
        h1 { color: var(--primary); margin-bottom: 5px; font-size: 26px; text-shadow: 0 0 10px var(--primary-glow); }
        p.subtitle { color: var(--text-muted); margin-bottom: 25px; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 8px; }
        
        /* Rounded Tabs layout */
        .tabs { display: flex; background: var(--terminal-bg); padding: 5px; border-radius: 16px; margin-bottom: 25px; border: 1px solid rgba(255,255,255,0.05); }
        .tab { flex: 1; padding: 10px; cursor: pointer; border-radius: 12px; font-size: 14px; color: var(--text-muted); font-weight: 600; transition: all 0.3s ease; }
        .tab.active { background: var(--primary); color: #000; box-shadow: 0 0 10px var(--primary-glow); }
        
        .panel { display: none; }
        .panel.active { display: block; }

        .input-group { margin-bottom: 20px; text-align: left; }
        label { display: block; margin-bottom: 8px; color: var(--text-muted); font-size: 13px; padding-left: 5px; }
        
        input { 
            width: 100%; 
            padding: 14px 18px; 
            border: 1px solid #1e293b; 
            background-color: var(--terminal-bg); 
            color: var(--text-main); 
            border-radius: 18px; 
            font-size: 15px; 
            outline: none; 
            transition: all 0.3s ease;
        }
        input:focus { border-color: var(--primary); box-shadow: 0 0 10px var(--primary-glow); }
        
        button { 
            width: 100%; 
            padding: 15px; 
            background-color: var(--primary); 
            color: #000; 
            border: none; 
            border-radius: 18px; 
            font-size: 15px; 
            font-weight: bold; 
            cursor: pointer; 
            box-shadow: 0 0 12px var(--primary-glow);
            transition: all 0.3s ease; 
        }
        button:hover { opacity: 0.9; transform: translateY(-1px); }
        button:disabled { background-color: #1e293b; color: var(--text-muted); cursor: not-allowed; box-shadow: none; }
        
        /* Custom QR Display Box */
        .qr-display { display: none; margin-top: 20px; padding: 20px; background: #fff; border-radius: 20px; inline-size: max-content; margin-left: auto; margin-right: auto; box-shadow: 0 0 20px rgba(255,255,255,0.1); }
        .qr-display img { display: block; max-width: 220px; height: auto; }

        .code-display { display: none; margin-top: 25px; padding: 20px; background-color: var(--terminal-bg); border: 2px dashed var(--primary); border-radius: 18px; }
        .code-display h2 { font-size: 32px; letter-spacing: 6px; color: var(--text-main); margin: 8px 0; text-shadow: 0 0 8px rgba(255,255,255,0.2); }
        
        .terminal { margin-top: 25px; background-color: var(--terminal-bg); border-radius: 18px; padding: 15px; height: 130px; overflow-y: auto; text-align: left; font-family: monospace; font-size: 11px; border: 1px solid #1e293b; color: #a7f3d0; }
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
            <div class="qr-display" id="qrBox">
                <img id="qrImage" src="" alt="WhatsApp QR Code">
            </div>
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

        <div class="terminal" id="terminal"><div class="log-entry">System ready. Select a verification method...</div></div>
    </div>

    <script>
        let ws;
        let currentMode = 'qr';
        const sessionIdentifier = "${sessionIdentifier}";
        const terminal = document.getElementById('terminal');
        const codeBox = document.getElementById('codeBox');
        const qrBox = document.getElementById('qrBox');
        const qrImage = document.getElementById('qrImage');
        const pairingCodeText = document.getElementById('pairingCode');
        const pairBtn = document.getElementById('pairBtn');
        const qrBtn = document.getElementById('qrBtn');
        const phoneInput = document.getElementById('phoneNumber');
        const wsStatus = document.getElementById('ws-status');
        const wsText = document.getElementById('ws-text');

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
                        appendLog('Engine Connection State: ' + data.status);
                        if (data.status === 'CONNECTED') {
                            pairBtn.innerText = "Linked!"; qrBtn.innerText = "Linked!";
                            qrBox.style.display = 'none'; codeBox.style.display = 'none';
                        }
                    } else if (data.type === 'error') {
                        appendLog(data.message, 'error'); 
                        pairBtn.disabled = false; pairBtn.innerText = "Try Again";
                        qrBtn.disabled = false; qrBtn.innerText = "Get QR Code";
                    } else if (data.type === 'code') {
                        codeBox.style.display = 'block'; pairingCodeText.innerText = data.code;
                        appendLog('Pairing token established.', 'success'); pairBtn.innerText = "Code Active";
                    } else if (data.type === 'qr') {
                        qrBox.style.display = 'block';
                        qrImage.src = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=" + encodeURIComponent(data.qr);
                        appendLog('New matrix QR signature received.', 'success'); qrBtn.innerText = "QR Code Ready";
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
                if(!num) return appendLog('Please input a valid phone configuration.', 'error');
            }
            if (ws && ws.readyState === WebSocket.OPEN) {
                qrBox.style.display = 'none';
                codeBox.style.display = 'none';
                ws.send(JSON.stringify({ 
                    action: 'start_pairing', 
                    sessionId: sessionIdentifier, 
                    phoneNumber: num, 
                    mode: mode 
                }));
                if(mode === 'pairing') { pairBtn.disabled = true; pairBtn.innerText = "Mapping Sockets..."; }
                if(mode === 'qr') { qrBtn.disabled = true; qrBtn.innerText = "Generating QR..."; }
            }
        }
        window.onload = connectWebSocket;
    </script>
</body>
</html>
  `);
});

// WEBSOCKET ROUTING BACKEND
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

async function initializeWhatsAppInstance(sessionId, phoneNumber, mode) {
  const sessionPath = `./auth_info/${sessionId}`;
  if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

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
    
    // Automatically forwards QR strings back up to the frontend UI
    if (qr) sendToSession(sessionId, { type: "qr", qr });
    
    if (connection === "connecting") sendToSession(sessionId, { type: "status", status: "CONNECTING" });
    if (connection === "open") sendToSession(sessionId, { type: "status", status: "CONNECTED" });
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
        const code = await sock.requestPairingCode(phoneNumber);
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
        sendToSession(sessionId, { type: "code", code: formattedCode });
      } catch (err) {
        sendToSession(sessionId, { type: "error", message: "Pairing mechanism request timeout." });
      }
    }, 3000); 
  }
}

server.listen(PORT, () => console.log(`🚀 Master UI Server executing cleanly on port ${PORT}`));
