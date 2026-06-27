const fs = require("fs");
const path = require("path");
const config = require("../config");

function loadCommands() {
  const commands = new Map();
  const commandsDir = path.join(__dirname, "..", "commands");

  for (const file of fs.readdirSync(commandsDir)) {
    if (!file.endsWith(".js")) continue;
    const command = require(path.join(commandsDir, file));
    if (!command.name || typeof command.execute !== "function") {
      console.warn(`[commands] Skipping ${file}: missing "name" or "execute"`);
      continue;
    }
    commands.set(command.name, command);
  }

  return commands;
}

const commands = loadCommands();

/**
 * ctx carries everything a command might need: the jid to reply to,
 * the raw message (for quoting), parsed args, and the sender's jid.
 */
async function handleMessage(sock, msg, text) {
  if (!text || !text.startsWith(config.prefix)) return false;

  const args = text.slice(config.prefix.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();

  const command = commands.get(commandName);
  if (!command) return false;

  const jid = msg.key.remoteJid;
  const sender = msg.key.fromMe
    ? sock.user.id.split(":")[0] + "@s.whatsapp.net"
    : msg.key.participant || msg.key.remoteJid;

  try {
    await command.execute(sock, msg, args, { jid, sender });
  } catch (err) {
    console.error(`[commands] Error running "${commandName}":`, err);
    await sock.sendMessage(jid, {
      text: "⚠️ Something went wrong running that command.",
    });
  }

  return true;
}

module.exports = { handleMessage, commands };
