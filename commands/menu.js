const config = require("../config");

module.exports = {
  name: "menu",
  description: "Show available commands",
  async execute(sock, msg, args, ctx) {
    const text =
      `╭─────────────────╮\n` +
      `   🤖 *BOT MENU*\n` +
      `╰─────────────────╯\n\n` +
      `${config.prefix}menu — show this menu\n\n` +
      `_More commands coming soon._`;

    await sock.sendMessage(ctx.jid, { text }, { quoted: msg });
  },
};
