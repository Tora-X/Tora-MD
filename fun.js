module.exports = (register) => {
  register("choose", "Select array alternatives via | delimiter", "Fun", async (ctx) => {
    const choices = ctx.args.join(" ").split("|").map(c => c.trim()).filter(Boolean);
    if (choices.length < 2) return ctx.reply("❌ Balance multiple choices cleanly with '|'");
    const picked = choices[Math.floor(Math.random() * choices.length)];
    await ctx.reply(`🎯 Selected Alternative: *${picked}*`);
  });
};
