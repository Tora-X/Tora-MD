const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Schema for storing multi-device session files
const SessionSchema = new mongoose.Schema({
    sessionId: { type: String, unique: true, required: true },
    files: { type: Map, of: String }, // Maps fileName -> Base64 encoded string
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const SessionModel = mongoose.model('ToraSession', SessionSchema);

async function connectDB() {
    try {
        await mongoose.connect(config.MONGODB_URI);
        console.log("🍃 MongoDB Cluster Pipeline Connected Successfully.");
    } catch (err) {
        console.error("❌ MongoDB Initialization Failure:", err.message);
        process.exit(1);
    }
}

/**
 * Downloads session storage states from Atlas down to the local file system
 */
async function syncSessionToDisk(sessionId, localDirectory) {
    try {
        const sessionDoc = await SessionModel.findOne({ sessionId });
        if (!sessionDoc || !sessionDoc.files) {
            console.log(`ℹ️ No cloud backup found for Session [${sessionId}]. Proceeding clean.`);
            return false;
        }

        if (!fs.existsSync(localDirectory)) {
            fs.mkdirSync(localDirectory, { recursive: true });
        }

        for (const [filename, base64Content] of sessionDoc.files.entries()) {
            const fullPath = path.join(localDirectory, filename);
            const subDir = path.dirname(fullPath);
            if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
            
            fs.writeFileSync(fullPath, Buffer.from(base64Content, 'base64'));
        }
        console.log(`📥 Session state synchronized down from MongoDB cloud cache.`);
        return true;
    } catch (err) {
        console.error("⚠️ Local synchronization pull failed:", err);
        return false;
    }
}

/**
 * Encodes and uploads local session credentials to your MongoDB Cluster
 */
let backupDebounceTimer = null;
function syncSessionToCloud(sessionId, localDirectory) {
    if (backupDebounceTimer) clearTimeout(backupDebounceTimer);

    // Debounce to prevent spamming write clusters during rapid key generations
    backupDebounceTimer = setTimeout(async () => {
        try {
            if (!fs.existsSync(localDirectory)) return;

            const filesMap = {};
            const readFilesRecursively = (dir) => {
                const list = fs.readdirSync(dir);
                list.forEach((file) => {
                    const fullPath = path.join(dir, file);
                    const stat = fs.statSync(fullPath);
                    if (stat && stat.isDirectory()) {
                        readFilesRecursively(fullPath);
                    } else {
                        const relativePath = path.relative(localDirectory, fullPath);
                        const fileBuffer = fs.readFileSync(fullPath);
                        filesMap[relativePath] = fileBuffer.toString('base64');
                    }
                });
            };

            readFilesRecursively(localDirectory);

            if (Object.keys(filesMap).length === 0) return;

            await SessionModel.findOneAndUpdate(
                { sessionId },
                { files: filesMap, updatedAt: new Date() },
                { upsert: true, new: true }
            );
            console.log(`📤 Cloud Sync: Backup committed to MongoDB storage layer.`);
        } catch (err) {
            console.error("⚠️ Cloud sync push dropped:", err);
        }
    }, 2000);
}

module.exports = {
    connectDB,
    syncSessionToDisk,
    syncSessionToCloud,
    SessionModel
};
