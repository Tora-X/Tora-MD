require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 8080,
    MONGODB_URI: process.env.MONGODB_URI || "mongodb+srv://sapumalpku_db_user:YOUR_ACTUAL_PASSWORD_HERE@cluster0.fck7ezm.mongodb.net/?appName=Cluster0",
    SESSION_ID: process.env.SESSION_ID || "tora_session",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "AIzaSyA0vT-XYECtNyqGODgvW-uLEud2ywZY558",
    THINUZZ_API_KEY: process.env.THINUZZ_API_KEY || "key_6eff37305f63aa5c",
    OWNER_NUMBER: "94722633010"
};
