module.exports = (register) => {
  const ownerNumber = process.env.OWNER_NUMBER || "";

  function checkOwner(ctx) {
    return ctx.senderNumber === ownerNumber.replace(/[^0-9]/g, "");
  }

  register("kick", "Evict group member", "Admin", async (ctx) => {
    if (!ctx.isGroup) return ctx.reply("❌ Group command sequence context only.");
    const quoted = ctx.msg.message?.extendedTextMessage?.contextInfo;
    const target = quoted?.participant || ctx.args[0]?.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

    if (!target) return ctx.reply("❌ Target a specific profile frame.");
    try {
      await ctx.sock.groupParticipantsUpdate(ctx.jid, [target], "remove");
      await ctx.reply("✅ Target successfully eviscerated.");
    } catch {
      await ctx.reply("❌ Error: Missing privilege levels.");
    }
  });

  register("shutdown", "Terminate engine process trees (Owner Only)", "Admin", async (ctx) => {
    if (!checkOwner(ctx)) return ctx.reply("🚫 Error: Security validation failed.");
    await ctx.reply("🛑 *Deactivating runtime process hooks. Systems offline.*");
    setTimeout(() => process.exit(0), 1000);
  });
};
