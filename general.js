module.exports = (register) => {
  register("help", "Show all available commands", "General", async (ctx) => {
    const categories = {};
    ctx.commands.forEach((cmd) => {
      if (!categories[cmd.category]) categories[cmd.category] = [];
      categories[cmd.category].push(`  ${ctx.prefix}${cmd.name} → ${cmd.description}`);
    });

    let menuText = "🐅 *TORA MD ENGINE SEPARATE REGISTRIES*\n\n";
    for (const [category, cmdList] of Object.entries(categories)) {
      menuText += `📂 *${category} Module*\n${cmdList.join("\n")}\n\n`;
    }
    await ctx.reply(menuText.trim());
  });

  register("ping", "Check internal execution delays", "General", async (ctx) => {
    const start = Date.now();
    await ctx.reply(`🏓 Pong! \`${Date.now() - start}ms\``);
  });
};
