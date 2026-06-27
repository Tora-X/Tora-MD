const { initAuthCreds, BufferJSON, proto } = require("@whiskeysockets/baileys");
const { getPool } = require("./db");

/**
 * A Baileys auth-state implementation backed by Postgres instead of
 * ./auth_info JSON files. This means there's no local-disk dependency at all —
 * important on hosts like Railway where the filesystem doesn't persist
 * across deploys/restarts.
 *
 * Uses Baileys' own BufferJSON replacer/reviver so Buffers (raw key bytes)
 * round-trip correctly through JSON, the same way the built-in file-based
 * auth state does internally.
 */
async function usePostgresAuthState(sessionId) {
  const db = getPool();

  async function readData(key) {
    const res = await db.query(
      "SELECT value FROM auth_state WHERE session_id = $1 AND key = $2",
      [sessionId, key]
    );
    if (res.rows.length === 0) return null;
    return JSON.parse(res.rows[0].value, BufferJSON.reviver);
  }

  async function writeData(key, value) {
    const json = JSON.stringify(value, BufferJSON.replacer);
    await db.query(
      `INSERT INTO auth_state (session_id, key, value, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (session_id, key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now()`,
      [sessionId, key, json]
    );
  }

  async function removeData(key) {
    await db.query("DELETE FROM auth_state WHERE session_id = $1 AND key = $2", [
      sessionId,
      key,
    ]);
  }

  async function clearSession() {
    await db.query("DELETE FROM auth_state WHERE session_id = $1", [sessionId]);
  }

  const creds = (await readData("creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData("creds", creds),
    clearSession,
  };
}

module.exports = { usePostgresAuthState };
