const path = require("path");
const http = require("http");
const { Telegraf } = require("telegraf");

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const PORT = process.env.PORT || 3000;
const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB

const GITHUB_OWNER = (process.env.GITHUB_OWNER || "").trim();
const GITHUB_REPO = (process.env.GITHUB_REPO || "").trim();
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || "").trim();
const WORKFLOW_FILE = (process.env.WORKFLOW_FILE || "build-apk.yml").trim();
const GITHUB_BRANCH = (process.env.GITHUB_BRANCH || "main").trim();

if (!BOT_TOKEN) {
  console.error("Error: BOT_TOKEN environment variable missing ya empty hai.");
  process.exit(1);
}

// Render Web Service health check ke liye HTTP server
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot service is alive");
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

const bot = new Telegraf(BOT_TOKEN);

// userId -> { apkUrl?: string, websiteZipUrl?: string, websiteUrl?: string }
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {});
  }
  return sessions.get(userId);
}

function isHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function checkRemoteFileSize(url) {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") || 0);
    return Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    return null;
  }
}

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function triggerGitHubBuild({ apkUrl, websiteUrl, websiteZipUrl, tagName }) {
  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
    throw new Error("GITHUB_OWNER, GITHUB_REPO, ya GITHUB_TOKEN env missing hai.");
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: GITHUB_BRANCH,
      inputs: {
        apk_url: apkUrl || "",
        website_url: websiteUrl || "",
        website_zip_url: websiteZipUrl || "",
        tag_name: tagName,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub Actions dispatch fail (${res.status}): ${errText}`);
  }
}

bot.start(async (ctx) => {
  sessions.set(ctx.from.id, {});
  await ctx.reply(
    [
      "APK + Website Builder Bot (1 GB Support) Ready hai.",
      "",
      "Kaise use karein:",
      "1. Base .apk ka direct download link (https://.../.apk) bhejein (1 GB tak).",
      "2. Website .zip ka direct link (https://.../.zip), chhoti .zip file, ya website URL bhejein.",
      "3. /status se current inputs check karein.",
      "4. /build likh kar GitHub Actions se APK build start karein.",
      "5. /reset se session clear karein.",
    ].join("\n")
  );
});

bot.command("reset", async (ctx) => {
  sessions.set(ctx.from.id, {});
  await ctx.reply("Session reset ho gaya. Naya APK link aur website link/URL bhejein.");
});

bot.command("status", async (ctx) => {
  const s = getSession(ctx.from.id);
  await ctx.reply(
    [
      "Current Session Status:",
      `• APK URL: ${s.apkUrl || "Pending"}`,
      `• Website ZIP URL: ${s.websiteZipUrl || "Not provided"}`,
      `• Website URL: ${s.websiteUrl || "Not provided"}`,
    ].join("\n")
  );
});

// Chhoti .zip files ke liye Telegram document support (20 MB limit tak)
bot.on("document", async (ctx) => {
  const doc = ctx.message.document;
  const fileName = (doc.file_name || "").toLowerCase();

  if ((doc.file_size || 0) > 20 * 1024 * 1024) {
    return ctx.reply(
      "Telegram bot 20 MB se badi file direct download nahi kar sakta[span_1](start_span)[span_1](end_span). Kripya 1 GB tak ki file ka direct https:// download link bhejein."
    );
  }

  if (!fileName.endsWith(".zip")) {
    return ctx.reply(
      "Badi .apk file ka direct https:// link bhejein, ya chhoti .zip file bhejein."
    );
  }

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const s = getSession(ctx.from.id);
    s.websiteZipUrl = fileLink.href;
    await ctx.reply("Website ZIP link session mein save ho gaya. Ab /build likhein.");
  } catch (err) {
    await ctx.reply(`ZIP link error: ${err.message}`);
  }
});

// Direct URLs (APK link, Website ZIP link, ya Website URL)
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;

  if (!isHttpUrl(text)) {
    return ctx.reply("Kripya valid https:// URL bhejein ya /build likhein.");
  }

  const s = getSession(ctx.from.id);
  const lower = text.toLowerCase();

  const sizeBytes = await checkRemoteFileSize(text);
  if (sizeBytes !== null && sizeBytes > MAX_FILE_BYTES) {
    return ctx.reply(
      `File size ${formatMB(sizeBytes)} hai, jo 1024 MB (1 GB) limit se zyada hai.`
    );
  }

  if (lower.includes(".apk")) {
    s.apkUrl = text;
    const sizeText = sizeBytes ? ` (${formatMB(sizeBytes)})` : "";
    return ctx.reply(
      `Base APK URL save ho gaya${sizeText}.\nAb Website URL ya Website ZIP link bhejein, phir /build likhein.`
    );
  }

  if (lower.includes(".zip")) {
    s.websiteZipUrl = text;
    const sizeText = sizeBytes ? ` (${formatMB(sizeBytes)})` : "";
    return ctx.reply(
      `Website ZIP URL save ho gaya${sizeText}.\nAb /build likhein.`
    );
  }

  s.websiteUrl = text;
  return ctx.reply(
    `Website URL save ho gaya:\n${text}\n\nAb /build likhein (agar APK URL bhi save kar chuke hain).`
  );
});

bot.command("build", async (ctx) => {
  const s = getSession(ctx.from.id);

  if (!s.apkUrl) {
    return ctx.reply("Pehle base .apk ka direct https:// link bhejein.");
  }
  if (!s.websiteUrl && !s.websiteZipUrl) {
    return ctx.reply("Pehle Website URL ya Website ZIP link/file bhejein.");
  }

  const tagName = `build-${ctx.from.id}-${Date.now()}`;
  const statusMsg = await ctx.reply("GitHub Actions workflow trigger ho raha hai...");

  try {
    await triggerGitHubBuild({
      apkUrl: s.apkUrl,
      websiteUrl: s.websiteUrl || "",
      websiteZipUrl: s.websiteZipUrl || "",
      tagName,
    });

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      [
        "Build workflow start ho gaya hai!",
        `Tag: ${tagName}`,
        "GitHub repository ke Actions / Releases tab mein progress aur final APK dekhein.",
      ].join("\n")
    );
  } catch (err) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `Build trigger fail hua:\n${err.message}`
    );
  }
});

bot
  .launch()
  .then(() => {
    console.log("Telegram bot (1 GB URL mode) chal raha hai...");
  })
  .catch((err) => {
    console.error("Bot launch error:", err);
    process.exit(1);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
