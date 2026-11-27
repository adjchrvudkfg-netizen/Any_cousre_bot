const http = require("http");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const PORT = process.env.PORT || 3000;
const MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB

const GITHUB_OWNER = (process.env.GITHUB_OWNER || "").trim();
const GITHUB_REPO = (process.env.GITHUB_REPO || "").trim();
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || "").trim();
const WORKFLOW_FILE = (process.env.WORKFLOW_FILE || "build-apk.yml").trim();
const SOURCE_WORKFLOW_FILE = (
  process.env.SOURCE_WORKFLOW_FILE || "extract-source.yml"
).trim();
const MERGE_WORKFLOW_FILE = (
  process.env.MERGE_WORKFLOW_FILE || "merge-source-panel.yml"
).trim();
const GITHUB_BRANCH = (process.env.GITHUB_BRANCH || "main").trim();

if (!BOT_TOKEN) {
  console.error("Error: BOT_TOKEN environment variable missing ya empty hai.");
  process.exit(1);
}

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Study bot service is alive");
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

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

async function dispatchWorkflow(workflowFile, inputs) {
  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
    throw new Error(
      "GITHUB_OWNER, GITHUB_REPO, ya GITHUB_TOKEN env missing hai."
    );
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: GITHUB_BRANCH,
      inputs,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub Actions dispatch fail (${res.status}): ${errText}`);
  }
}

// Message ke turant neeche ("Tap any button below to begin.") dikhne wale Inline Buttons
function inlineMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📝 Notes", "menu_notes")],
    [
      Markup.button.callback("📖 Syllabus", "menu_syllabus"),
      Markup.button.callback("📄 PYQ", "menu_pyq"),
    ],
    [
      Markup.button.callback("🧪 Mock Test", "menu_mock"),
      Markup.button.callback("🎥 Lecture", "menu_lecture"),
    ],
  ]);
}

function buildStartMessage(ctx) {
  const userName =
    ctx.from?.first_name || ctx.from?.username || "Student";
  const userId = ctx.from?.id || "N/A";

  return [
    "🌸 - STUDY PANEL - 🌸",
    "",
    `👤 Hello, ${userName}!`,
    "",
    "📚 Complete study material, instant access.",
    "",
    "— 📝 Structured Notes",
    "— 📖 Complete Syllabus",
    "— 📄 Previous Year Questions (PYQ)",
    "— 🧪 Practice Mock Tests",
    "— 🎥 Video Lectures",
    "━━━━━━━━━━━━━━━━━━━━",
    `👤 User ID: ${userId}`,
    "📌 Study Mode: Active",
    "",
    "Tap any button below to begin.",
  ].join("\n");
}
const bot = new Telegraf(BOT_TOKEN);

bot.catch(async (err, ctx) => {
  console.error("TELEGRAF_UNHANDLED_ERROR:", err);
  try {
    if (ctx && ctx.reply) {
      await ctx.reply(`Study bot error: ${err.message || "Unknown error"}`);
    }
  } catch (_) {}
});

async function sendNotes(ctx) {
  await ctx.reply(
    [
      "📝 *Study Notes*",
      "",
      "• Chapter-wise short & detailed revision notes",
      "• Formula sheets & key concept summaries",
      "",
      "Apne notes topic ya link bhejein, ya /status se session check karein.",
    ].join("\n"),
    inlineMenuKeyboard()
  );
}

async function sendSyllabus(ctx) {
  await ctx.reply(
    [
      "📖 *Study Syllabus*",
      "",
      "• Subject-wise & topic-wise complete syllabus",
      "• High-weightage chapters & completion checklist",
      "",
      "Kisi subject ka syllabus dekhna hai to uska naam likhein.",
    ].join("\n"),
    inlineMenuKeyboard()
  );
}

async function sendPyq(ctx) {
  await ctx.reply(
    [
      "📄 *Study PYQ (Previous Year Questions)*",
      "",
      "• Year-wise solved & unsolved exam questions",
      "• Pattern analysis & important question bank",
      "",
      "Year ya topic likh kar PYQ filter kar sakte hain.",
    ].join("\n"),
    inlineMenuKeyboard()
  );
}

async function sendMockTest(ctx) {
  await ctx.reply(
    [
      "🧪 *Study Mock Test*",
      "",
      "• Timed practice tests & accuracy evaluation",
      "• Question-wise review & mistake tracking",
      "",
      "Test shuru karne ke liye topic ya set naam bhejein.",
    ].join("\n"),
    inlineMenuKeyboard()
  );
}

async function sendLecture(ctx) {
  await ctx.reply(
    [
      "🎥 *Study Lecture*",
      "",
      "• Recorded & live class lecture links",
      "• Topic-wise video series & revision classes",
      "",
      "Lecture ka topic ya link bhejein.",
    ].join("\n"),
    inlineMenuKeyboard()
  );
}

bot.start(async (ctx) => {
  sessions.set(ctx.from.id, {});
  // Purana bottom reply keyboard hata kar inline menu message ke saath bhejega
  await ctx.reply(buildStartMessage(ctx), {
    ...inlineMenuKeyboard(),
    reply_markup: {
      ...inlineMenuKeyboard().reply_markup,
      remove_keyboard: true,
    },
  });
});

bot.action("menu_notes", async (ctx) => {
  await ctx.answerCbQuery();
  await sendNotes(ctx);
});

bot.action("menu_syllabus", async (ctx) => {
  await ctx.answerCbQuery();
  await sendSyllabus(ctx);
});

bot.action("menu_pyq", async (ctx) => {
  await ctx.answerCbQuery();
  await sendPyq(ctx);
});

bot.action("menu_mock", async (ctx) => {
  await ctx.answerCbQuery();
  await sendMockTest(ctx);
});

bot.action("menu_lecture", async (ctx) => {
  await ctx.answerCbQuery();
  await sendLecture(ctx);
});

bot.hears(["Notes", "📝 Notes"], sendNotes);
bot.hears(["Syllabus", "📖 Syllabus"], sendSyllabus);
bot.hears(["PYQ", "📄 PYQ"], sendPyq);
bot.hears(["Mock Test", "🧪 Mock Test"], sendMockTest);
bot.hears(["Lecture", "🎥 Lecture"], sendLecture);

bot.command("reset", async (ctx) => {
  sessions.set(ctx.from.id, {});
  await ctx.reply(
    "Study session reset ho gaya. Naye links ya files bhejein.",
    inlineMenuKeyboard()
  );
});

bot.command("status", async (ctx) => {
  const s = getSession(ctx.from.id);
  await ctx.reply(
    [
      "Study Session Status:",
      `• APK URL: ${s.apkUrl || "Pending"}`,
      `• Source ZIP URL: ${s.sourceZipUrl || "Not provided"}`,
      `• Website ZIP URL: ${s.websiteZipUrl || "Not provided"}`,
      `• Website URL: ${s.websiteUrl || "Not provided"}`,
    ].join("\n"),
    inlineMenuKeyboard()
  );
});

bot.on("document", async (ctx) => {
  const doc = ctx.message.document;
  const fileName = (doc.file_name || "").toLowerCase();

  if ((doc.file_size || 0) > 20 * 1024 * 1024) {
    return ctx.reply(
      "Telegram bot 20 MB se badi file direct download nahi kar sakta. Kripya 1 GB tak ki file ka direct https:// download link bhejein."
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

    if (fileName.includes("source")) {
      s.sourceZipUrl = fileLink.href;
      return ctx.reply(
        "Source ZIP link study session mein save ho gaya. Ab website panel ZIP/link bhej kar /mergebuild likhein."
      );
    }

    s.websiteZipUrl = fileLink.href;
    await ctx.reply(
      "Website ZIP link study session mein save ho gaya. Ab /build ya /mergebuild likhein."
    );
  } catch (err) {
    await ctx.reply(`ZIP link error: ${err.message}`);
  }
});

bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;

  if (!isHttpUrl(text)) {
    return ctx.reply("Kripya valid https:// URL bhejein ya command likhein.");
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
      `Base APK URL save ho gaya${sizeText}.\nAb /source se source code nikal sakte hain, ya Website URL/ZIP bhej kar /build likh sakte hain.`
    );
  }

  if (lower.includes(".zip")) {
    const sizeText = sizeBytes ? ` (${formatMB(sizeBytes)})` : "";
    if (lower.includes("source") || lower.includes("apk-source")) {
      s.sourceZipUrl = text;
      return ctx.reply(
        `Source ZIP URL save ho gaya${sizeText}.\nAb website panel ZIP link bhej kar /mergebuild likhein.`
      );
    }
    s.websiteZipUrl = text;
    return ctx.reply(
      `Website ZIP URL save ho gaya${sizeText}.\nAb /build ya /mergebuild likhein.`
    );
  }

  s.websiteUrl = text;
  return ctx.reply(
    `Website URL save ho gaya:\n${text}\n\nAb /build likhein (agar APK URL bhi save kar chuke hain).`
  );
});
bot.command("source", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (!s.apkUrl) {
    return ctx.reply(
      "Pehle .apk file ka direct https:// link bhejein, phir /source likhein."
    );
  }

  const tagName = `source-${ctx.from.id}-${Date.now()}`;
  await ctx.reply("Study APK source code extraction trigger kiya ja raha hai...");

  try {
    await dispatchWorkflow(SOURCE_WORKFLOW_FILE, {
      apk_url: s.apkUrl,
      tag_name: tagName,
    });

    await ctx.reply(
      [
        "Source extraction workflow trigger ho gaya!",
        `Tag: ${tagName}`,
        "GitHub Releases mein `apk-source-code.zip` banne ke baad uska link bhej kar /mergebuild use karein.",
      ].join("\n")
    );
  } catch (err) {
    console.error("SOURCE_COMMAND_ERROR:", err);
    await ctx.reply(`Source error: ${err.message}`);
  }
});

bot.command("mergebuild", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (!s.sourceZipUrl) {
    return ctx.reply("Pehle extracted source code ZIP ka https:// link bhejein.");
  }
  if (!s.websiteZipUrl) {
    return ctx.reply("Pehle website panel ki .zip file ya https:// link bhejein.");
  }

  const tagName = `merged-${ctx.from.id}-${Date.now()}`;
  await ctx.reply("Source + Study Panel merge aur APK build start ho raha hai...");

  try {
    await dispatchWorkflow(MERGE_WORKFLOW_FILE, {
      source_zip_url: s.sourceZipUrl,
      panel_zip_url: s.websiteZipUrl,
      tag_name: tagName,
    });

    await ctx.reply(
      [
        "Merge & Build workflow start ho gaya!",
        `Tag: ${tagName}`,
        "GitHub Releases mein `merged-panel-app.apk` banne ke baad download kar lein.",
      ].join("\n")
    );
  } catch (err) {
    console.error("MERGEBUILD_COMMAND_ERROR:", err);
    await ctx.reply(`Merge build error: ${err.message}`);
  }
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
  await ctx.reply("GitHub Actions workflow trigger ho raha hai...");

  try {
    await dispatchWorkflow(WORKFLOW_FILE, {
      apk_url: s.apkUrl,
      website_url: s.websiteUrl || "",
      website_zip_url: s.websiteZipUrl || "",
      tag_name: tagName,
    });

    await ctx.reply(
      [
        "Build workflow start ho gaya hai!",
        `Tag: ${tagName}`,
        "GitHub repository ke Actions / Releases tab mein progress aur final APK dekhein.",
      ].join("\n")
    );
  } catch (err) {
    console.error("BUILD_COMMAND_ERROR:", err);
    await ctx.reply(`Build trigger fail hua:\n${err.message}`);
  }
});

bot
  .launch({ dropPendingUpdates: true })
  .then(() => {
    console.log("Study Telegram bot chal raha hai...");
  })
  .catch((err) => {
    console.error("Bot launch error:", err);
    process.exit(1);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
