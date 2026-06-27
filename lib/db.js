const { Pool } = require("pg");
const config = require("../config");

let pool = null;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env and fill in your Supabase pooler connection string."
      );
    }
    pool = new Pool({
      connectionString: config.databaseUrl,
      // Supabase's cert chain isn't in Node's default trust store on most hosts.
      // This still encrypts the connection — it just skips chain verification.
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function initSchema() {
  const db = getPool();

  // Holds the Baileys auth state (creds + signal keys), keyed per session.
  // This is the only table this base version needs.
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_state (
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (session_id, key)
    );
  `);

  console.log("[db] Connected to Supabase Postgres — schema ready");
}

module.exports = { getPool, initSchema };
