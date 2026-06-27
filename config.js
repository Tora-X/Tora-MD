require("dotenv").config();

module.exports = {
  prefix: process.env.PREFIX || ".",
  port: parseInt(process.env.PORT, 10) || 8080,
  sessionId: process.env.SESSION_ID || "tora_session",
  databaseUrl: process.env.DATABASE_URL,
};
