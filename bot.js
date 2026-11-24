const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile } = require("child_process");
const { Telegraf } = require("telegraf");

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const PORT = process.env.PORT || 3000;
const WORK_DIR = path.join(__dirname, "builds");
const BUILD_SCRIPT = path.join(__dirname, "build_apk.sh");

if (!BOT_TOKEN) {
  console.error("Error: BOT_TOKEN environment variable missing ya empty hai.");
  process.exit(1);
}

// Render Web Service health check ke liye lightweight HTTP server
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot service is alive");
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {});
  }
  return sessions.get(userId);
}

function runBuildScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    execFile(
      "bash",
      [scriptPath, ...args],
      { maxBuffer: 1024 * 1024 * 50 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error((stderr || stdout || err.message).trim()));
        }
        resolve(stdout.trim());
      }
    );
  });
}

async function downloadTelegramFile(ctx, fileId, destPath) {
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href);
  if (!response.ok) {
    throw new Error(`File download failed: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

bot.start(async (ctx) => {
  sessions.set(ctx.from.id, {});
  await ctx.reply(
    [
      "APK + Website Builder Bot Ready hai.",
      "",
      "Kaise use karein:",
      "1. Apni base .apk file bhejein (Document ke roop mein).",
      "2. Website .zip bhejein ya website URL (https://...) likhein.",
      "3. /status se current files/URL check karein.",
      "4. /build likh kar updated signed .apk banayein.",
      "5. /reset se naya session shuru karein.",
    ].join("\n")
  );
});

bot.command("reset", async (ctx) => {
  const userId = ctx.from.id;
  const userDir = path.join(WORK_DIR, String(userId));
  fs.rmSync(userDir, { recursive: true, force: true });
  sessions.set(userId, {});
  await ctx.reply("Session aur purani build files clear ho gayin. Nayi APK aur website bhejein.");
});

bot.command("status", async (ctx) => {
  const session = getSession(ctx.from.id);
  await ctx.reply(
    [
      "Current Session Status:",
      `• Base APK: ${session.apkPath ? "Uploaded" : "Pending"}`,
      `• Website ZIP: ${session.zipPath ? "Uploaded" : "Not provided"}`,
      `• Website URL: ${session.websiteUrl || "Not provided"}`,
    ].join("\n")
  );
});

bot.on("document", async (ctx) => {
  const doc = ctx.message.document;
  const userId = ctx.from.id;
  const session = getSession(userId);
  const userDir = path.join(WORK_DIR, String(userId));
  fs.mkdirSync(userDir, { recursive: true });

  const fileName = (doc.file_name || "").toLowerCase();
  const statusMsg = await ctx.reply("File download ho rahi hai...");

  try {
    if (fileName.endsWith(".apk")) {
      const apkPath = path.join(userDir, "input.apk");
      await downloadTelegramFile(ctx, doc.file_id, apkPath);
      session.apkPath = apkPath;
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        "Base APK save ho gayi. Ab website .zip ya website URL bhejein."
      );
      return;
    }

    if (fileName.endsWith(".zip")) {
      const zipPath = path.join(userDir, "website.zip");
      await downloadTelegramFile(ctx, doc.file_id, zipPath);
      session.zipPath = zipPath;
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        "Website ZIP save ho gayi. Ab /build likhein (agar APK bhi bhej chuke hain)."
      );
      return;
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      "Sirf .apk ya .zip file bhejein."
    );
  } catch (err) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `Download error: ${err.message}`
    );
  }
});

bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;

  const session = getSession(ctx.from.id);
  if (/^https?:\/\/\S+$/i.test(text)) {
    session.websiteUrl = text;
    await ctx.reply(`Website URL save ho gaya:\n${text}\n\nAb /build command bhejein.`);
    return;
  }

  await ctx.reply("Kripya valid website URL (https://...) bhejein ya /build likhein.");
});

bot.command("build", async (ctx) => {
  const userId = ctx.from.id;
  const session = getSession(userId);

  if (!session.apkPath || !fs.existsSync(session.apkPath)) {
    return ctx.reply("Pehle base .apk file bhejein.");
  }
  if (!session.zipPath && !session.websiteUrl) {
    return ctx.reply("Pehle website .zip file ya website URL bhejein.");
  }

  const userDir = path.join(WORK_DIR, String(userId));
  const outputApk = path.join(userDir, "final-signed.apk");

  if (fs.existsSync(outputApk)) {
    fs.unlinkSync(outputApk);
  }

  const statusMsg = await ctx.reply("APK repack aur sign ho rahi hai... Thoda wait karein.");

  try {
    await runBuildScript(BUILD_SCRIPT, [
      session.apkPath,
      session.websiteUrl || "",
      session.zipPath || "",
      outputApk,
    ]);

    if (!fs.existsSync(outputApk)) {
      throw new Error("Final APK file nahi bani.");
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      "Build complete! Updated APK bhej raha hoon..."
    );

    await ctx.replyWithDocument({
      source: outputApk,
      filename: "updated-app.apk",
    });
  } catch (err) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `Build fail hua:\n${err.message}`
    );
  }
});

bot
  .launch()
  .then(() => {
    console.log("Telegram bot chal raha hai...");
  })
  .catch((err) => {
    console.error("Bot launch error:", err);
    process.exit(1);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
