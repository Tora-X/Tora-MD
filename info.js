const axios = require("axios");

module.exports = (register) => {
  const thinuzzKey = process.env.THINUZZ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  register("song", "Extract MP3 from YouTube", "Info", async (ctx) => {
    const query = ctx.args.join(" ");
    if (!query) return ctx.reply("❌ Please provide a query string or valid link.");
    await ctx.reply("⏳ *Processing YouTube media query array...*");
    try {
      const res = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/ytmp3/download?url=${encodeURIComponent(query)}&apiKey=${thinuzzKey}`);
      if (res.data?.status && res.data?.result?.download_url) {
        await ctx.sock.sendMessage(ctx.jid, { 
          audio: { url: res.data.result.download_url }, 
          mimetype: 'audio/mp4' 
        }, { quoted: ctx.msg });
      } else {
        ctx.reply("❌ Video track resolution failure.");
      }
    } catch (e) {
      ctx.reply(`❌ Target Endpoint Down: ${e.message}`);
    }
  });

  register("mp4", "Download high speed YouTube videos", "Info", async (ctx) => {
    const query = ctx.args.join(" ");
    if (!query) return ctx.reply("❌ Provide a valid target video path link.");
    await ctx.reply("⏳ *Buffering 720p HD stream output...*");
    try {
      const res = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/ytmp4v2/download?url=${encodeURIComponent(query)}&quality=720&apiKey=${thinuzzKey}`);
      if (res.data?.status && res.data?.result?.download_url) {
        await ctx.sock.sendMessage(ctx.jid, { 
          video: { url: res.data.result.download_url }, 
          caption: "🐅 Track Output via Tora MD Engine" 
        }, { quoted: ctx.msg });
      } else {
        ctx.reply("❌ Failed to parse payload download endpoint.");
      }
    } catch (e) {
      ctx.reply(`❌ API pipeline error: ${e.message}`);
    }
  });

  register("fb", "Extract Facebook video frames", "Info", async (ctx) => {
    const query = ctx.args.join(" ");
    if (!query) return ctx.reply("❌ Link required.");
    await ctx.reply("⏳ *Analyzing Facebook CDN profiles...*");
    try {
      const res = await axios.get(`https://www.movanest.xyz/v2/fbdown?url=${encodeURIComponent(query)}`);
      if (res.data?.status && res.data?.result?.sd) {
        await ctx.sock.sendMessage(ctx.jid, { video: { url: res.data.result.sd }, caption: "🎬 Facebook Download" }, { quoted: ctx.msg });
      } else {
        ctx.reply("❌ Media parsing failed.");
      }
    } catch (e) {
      ctx.reply(`❌ Server Exception: ${e.message}`);
    }
  });

  register("tt", "Download TikTok formats without tracking tag", "Info", async (ctx) => {
    const query = ctx.args.join(" ");
    if (!query) return ctx.reply("❌ Link required.");
    await ctx.reply("⏳ *Downloading video data block...*");
    try {
      const res = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/tiktok?url=${encodeURIComponent(query)}&apiKey=${thinuzzKey}`);
      if (res.data?.status && res.data?.result?.download_url) {
        await ctx.sock.sendMessage(ctx.jid, { video: { url: res.data.result.download_url }, caption: "🎵 TikTok Download" }, { quoted: ctx.msg });
      } else {
        ctx.reply("❌ Download request rejected by core API server.");
      }
    } catch (e) {
      ctx.reply(`❌ Error: ${e.message}`);
    }
  });

  register("insta", "Download Instagram Reels arrays", "Info", async (ctx) => {
    const query = ctx.args.join(" ");
    if (!query) return ctx.reply("❌ Link required.");
    await ctx.reply("⏳ *Acquiring Instagram target resource...*");
    try {
      const res = await axios.get(`https://mr-thinuzz-api-build.vercel.app/api/instadown/download?url=${encodeURIComponent(query)}&apiKey=${thinuzzKey}`);
      if (res.data?.status && res.data?.result?.download_url) {
        await ctx.sock.sendMessage(ctx.jid, { video: { url: res.data.result.download_url }, caption: "📸 Instagram Download" }, { quoted: ctx.msg });
      } else {
        ctx.reply("❌ Target stream parsing error.");
      }
    } catch (e) {
      ctx.reply(`❌ Connection drop: ${e.message}`);
    }
  });

  register("ai", "Inquire processing with native Gemini AI Studio Pro", "Info", async (ctx) => {
    const prompt = ctx.args.join(" ");
    if (!prompt) return ctx.reply("❌ Prompt input instruction missing.");
    try {
      const res = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        contents: [{ parts: [{ text: prompt }] }]
      });
      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      await ctx.reply(text ? text.trim() : "❌ Server output empty structure payload.");
    } catch (e) {
      ctx.reply(`❌ AI Engine processing down: ${e.message}`);
    }
  });
};
EOF
