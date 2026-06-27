# Tora Bot — base v1 (Supabase only, one command)

A minimal, working foundation: WhatsApp connection via Baileys, session stored
in Supabase Postgres (no local files, so it survives Railway restarts/redeploys),
a web dashboard for QR/pairing-code login, and exactly one command (`.menu`)
to prove the whole pipeline works end-to-end before we add more.

## Project structure

```
.
├── index.js                # Express + WebSocket server, boots everything
├── config.js               # Reads env vars (prefix, port, session id, db url)
├── Procfile                # Tells Railway how to start the app
├── lib/
│   ├── db.js                # Postgres pool + schema (auth_state table)
│   ├── pgAuthState.js        # Baileys auth state, stored in Postgres
│   ├── sessionManager.js     # Owns the WA socket, pushes QR/status over WS
│   ├── commandHandler.js     # Loads commands/, matches prefix, dispatches
│   └── messageUtils.js       # Extracts text from any message type
├── commands/
│   └── menu.js               # The only command right now
└── public/
    └── dashboard.html         # QR / pairing code web UI
```

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Go to **Project Settings → Database → Connection string → tab "Session"** (NOT "Direct").
   - The direct connection only resolves to IPv6, which Railway can't reach —
     you'll get `ENETUNREACH` if you use that one. The session pooler is IPv4.
3. Copy the string. It looks like:
   ```
   postgresql://postgres.abcdefghijk:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
   ```
4. If your password has special characters (`@`, `#`, `%`, etc.), URL-encode them:
   - `@` → `%40`, `#` → `%23`, `%` → `%25`
   - Easiest fix: reset the DB password to something alphanumeric only, to avoid this entirely.

You don't need to create any tables yourself — the bot creates `auth_state`
automatically on first boot.

## 2. Run locally (optional, to test before deploying)

```bash
cp .env.example .env
# paste your Supabase connection string into DATABASE_URL in .env
npm install
npm start
```

Open `http://localhost:8080` in a browser, scan the QR (or use the pairing
code tab), and send `.menu` to the bot's number from another phone.

## 3. Deploy to Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo.
3. Go to your service's **Variables** tab and add:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | your Supabase session-pooler string from step 1 |
   | `SESSION_ID` | `tora_session` (or anything — just keep it consistent) |
   | `PREFIX` | `.` (or whatever you want commands to start with) |

   Don't set `PORT` — Railway injects that automatically and `config.js`
   already reads it.
4. Railway will detect `npm start` from `package.json` (the `Procfile` is a
   backup for platforms that need it). Deploy.
5. Open the **Deployments** tab → your live URL → you'll see the dashboard.
   Scan the QR or use a pairing code to link your WhatsApp account.
6. Once connected, the session is saved in Supabase — redeploys and restarts
   won't log you out.

## Where to change things

- **Command prefix** → `PREFIX` env var (no code change needed).
- **Add a new command** → drop a file in `commands/` with this shape:
  ```js
  module.exports = {
    name: "yourcommand",
    description: "What it does",
    async execute(sock, msg, args, ctx) {
      await sock.sendMessage(ctx.jid, { text: "..." }, { quoted: msg });
    },
  };
  ```
  It's auto-loaded — nothing else to register.
- **Dashboard look** → `public/dashboard.html`, plain HTML/CSS/JS, no build step.
- **Session table name / schema** → `lib/db.js`.
- **Auth state behavior** (how login keys are read/written) → `lib/pgAuthState.js`.
  You shouldn't need to touch this unless you're debugging login issues.
- **Reconnect behavior / WS broadcast logic** → `lib/sessionManager.js`.

## Notes

- If you ever get logged out (`DisconnectReason.loggedOut`), delete the rows
  for your `SESSION_ID` from the `auth_state` table in Supabase, then
  re-scan/re-pair.
- This version intentionally has no AI command, no media downloaders, and no
  group-admin commands — those come next, once this base is confirmed working
  on Railway.
