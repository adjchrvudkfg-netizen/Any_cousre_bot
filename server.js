const http = require("http");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
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

const SUBJECTS = [
  "Pharmaceutical analysis and organic chemistry",
  "Human anatomy and physiology 1",
  "Pharmaceutics",
  "Pharmacognosy",
  "Python",
  "Comunication skills",
];

if (!BOT_TOKEN) {
  console.error("Error: BOT_TOKEN environment variable missing ya empty hai.");
  process.exit(1);
}

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("STUDY BOT service is alive");
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

async function askGemini(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable missing hai.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim() || "";

  if (!text) {
    throw new Error("Gemini se empty response aaya.");
  }
  return text;
}
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { mock: null });
  }
  const s = sessions.get(userId);
  if (!s.mock) s.mock = null;
  return s;
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

// Notes ke buttons blue indicator (🟦) ke saath, baaki sab green indicator (🟩) ke saath
function inlineMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🟦 Notes", "menu_notes")],
    [
      Markup.button.callback("🟩 Syllabus", "menu_syllabus"),
      Markup.button.callback("🟩 PYQ", "menu_pyq"),
    ],
    [
      Markup.button.callback("🟩 Mock Test", "menu_mock"),
      Markup.button.callback("🟩 Lecture", "menu_lecture"),
    ],
  ]);
}

function subjectButtonsKeyboard(prefix, isNotes = false) {
  const icon = isNotes ? "🟦" : "🟩";
  const rows = SUBJECTS.map((subj, idx) => [
    Markup.button.callback(`${icon} ${idx + 1}. ${subj}`, `${prefix}_${idx}`),
  ]);
  rows.push([Markup.button.callback("🟩 Back to Menu", "back_main")]);
  return Markup.inlineKeyboard(rows);
}

function mockOptionKeyboard(qIndex) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🟩 A", `mock_ans_${qIndex}_A`),
      Markup.button.callback("🟩 B", `mock_ans_${qIndex}_B`),
      Markup.button.callback("🟩 C", `mock_ans_${qIndex}_C`),
      Markup.button.callback("🟩 D", `mock_ans_${qIndex}_D`),
    ],
    [Markup.button.callback("🟩 E (Chhodna / Skip)", `mock_ans_${qIndex}_E`)],
  ]);
}

function buildStartMessage(ctx) {
  const userName = ctx.from?.first_name || ctx.from?.username || "Student";
  const userId = ctx.from?.id || "N/A";

  return [
    "🌸 - STUDY BOT - 🌸",
    "",
    `👤 Hello, ${userName}!`,
    "",
    "📚 Complete study material, instant access.",
    "",
    "— 🟦 Notes (6 Subjects)",
    "— 🟩 Syllabus (6 Subjects)",
    "— 🟩 PYQ (Gemini AI)",
    "— 🟩 Mock Test (20 Questions AI)",
    "— 🟩 Lecture (6 Subjects)",
    "━━━━━━━━━━━━━━━━━━━━",
    `👤 User ID: ${userId}`,
    "📌 Study Bot: Active",
    "",
    "Tap any button below to begin.",
  ].join("\n");
}
const bot = new Telegraf(BOT_TOKEN);

bot.catch(async (err, ctx) => {
  console.error("TELEGRAF_UNHANDLED_ERROR:", err);
  try {
    if (ctx && ctx.reply) {
      await ctx.reply(`STUDY BOT error: ${err.message || "Unknown error"}`);
    }
  } catch (_) {}
});

bot.start(async (ctx) => {
  sessions.set(ctx.from.id, { mock: null });
  await ctx.reply(buildStartMessage(ctx), {
    ...inlineMenuKeyboard(),
    reply_markup: {
      ...inlineMenuKeyboard().reply_markup,
      remove_keyboard: true,
    },
  });
});

bot.action("back_main", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(buildStartMessage(ctx), inlineMenuKeyboard());
});

// Notes -> 6 Subject Buttons (Blue indicator)
bot.action("menu_notes", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "🟦 *Notes — Subject Chunein:*",
    subjectButtonsKeyboard("notes_subj", true)
  );
});

// Syllabus -> Same 6 Subject Buttons (Green indicator)
bot.action("menu_syllabus", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "🟩 *Syllabus — Subject Chunein:*",
    subjectButtonsKeyboard("syl_subj", false)
  );
});

// Lecture -> Same 6 Subject Buttons (Green indicator)
bot.action("menu_lecture", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "🟩 *Lecture — Subject Chunein:*",
    subjectButtonsKeyboard("lec_subj", false)
  );
});

for (let i = 0; i < SUBJECTS.length; i++) {
  const subjectName = SUBJECTS[i];

  bot.action(`notes_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.reply(`🟦 *${subjectName}* ke notes taiyar kiye ja rahe hain...`);
      const aiText = await askGemini(
        `Create clear, structured study notes and key revision points for the subject "${subjectName}". Keep it concise and easy to read on mobile.`
      );
      await ctx.reply(
        `🟦 *Notes: ${subjectName}*\n\n${aiText}`,
        subjectButtonsKeyboard("notes_subj", true)
      );
    } catch (err) {
      await ctx.reply(`Notes error: ${err.message}`);
    }
  });

  bot.action(`syl_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.reply(`🟩 *${subjectName}* ka syllabus load ho raha hai...`);
      const aiText = await askGemini(
        `Provide a clean unit-wise and topic-wise syllabus outline for "${subjectName}".`
      );
      await ctx.reply(
        `🟩 *Syllabus: ${subjectName}*\n\n${aiText}`,
        subjectButtonsKeyboard("syl_subj", false)
      );
    } catch (err) {
      await ctx.reply(`Syllabus error: ${err.message}`);
    }
  });

  bot.action(`lec_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.reply(`🟩 *${subjectName}* ke lecture topics & guide taiyar ho rahe hain...`);
      const aiText = await askGemini(
        `List key lecture topics, study sequence, and what to focus on in video/class lectures for "${subjectName}".`
      );
      await ctx.reply(
        `🟩 *Lecture: ${subjectName}*\n\n${aiText}`,
        subjectButtonsKeyboard("lec_subj", false)
      );
    } catch (err) {
      await ctx.reply(`Lecture error: ${err.message}`);
    }
  });
}
async function generateMockSet(subjectLabel = "All Subjects") {
  const prompt = [
    `Generate exactly 20 multiple-choice questions for "${subjectLabel}".`,
    `Return ONLY valid JSON (no markdown fences) as an array of 20 objects with this exact structure:`,
    `[{"q":"Question text","A":"Option A","B":"Option B","C":"Option C","D":"Option D","ans":"A","reason":"Short explanation"}]`,
    `Rules: "ans" must be one of "A", "B", "C", or "D". Every question must have distinct, realistic options.`,
  ].join("\n");

  const raw = await askGemini(prompt);
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Mock test questions parse nahi ho paye.");
  }
  return parsed.slice(0, 20);
}

async function sendMockQuestion(ctx, s) {
  const m = s.mock;
  if (!m || m.index >= m.questions.length) {
    return finishMockTest(ctx, s);
  }

  const qObj = m.questions[m.index];
  const qNum = m.index + 1;

  const text = [
    `🟩 *Mock Test (${qNum} / ${m.questions.length})*`,
    "",
    `*Q${qNum}.* ${qObj.q}`,
    "",
    `A) ${qObj.A}`,
    `B) ${qObj.B}`,
    `C) ${qObj.C}`,
    `D) ${qObj.D}`,
    `E) Chhodna (Skip)`,
  ].join("\n");

  await ctx.reply(text, mockOptionKeyboard(m.index));
}

async function finishMockTest(ctx, s) {
  const m = s.mock;
  s.mock = null;
  if (!m) return;

  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  const reviewLines = [];

  m.questions.forEach((qObj, idx) => {
    const picked = m.answers[idx] || "E";
    if (picked === "E") {
      skippedCount++;
      reviewLines.push(
        `Q${idx + 1}: ⏭️ Chhoda (Sahi: ${qObj.ans}) — ${qObj.reason}`
      );
    } else if (picked === qObj.ans) {
      correctCount++;
      reviewLines.push(`Q${idx + 1}: ✅ Sahi (${picked})`);
    } else {
      wrongCount++;
      reviewLines.push(
        `Q${idx + 1}: ❌ Galat (${picked} | Sahi: ${qObj.ans}) — ${qObj.reason}`
      );
    }
  });

  const summary = [
    "🟩 *Mock Test Complete — Result Summary*",
    "━━━━━━━━━━━━━━━━━━━━",
    `✅ Sahi (Correct): ${correctCount}`,
    `❌ Galat (Wrong): ${wrongCount}`,
    `⏭️ Chhode (Skipped): ${skippedCount}`,
    `📊 Total Questions: ${m.questions.length}`,
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "*Question-wise Result:*",
    ...reviewLines,
  ].join("\n");

  // Telegram message length limit (~4096 chars) ke hisaab se safe chunks
  const chunkSize = 3500;
  for (let i = 0; i < summary.length; i += chunkSize) {
    const part = summary.slice(i, i + chunkSize);
    const isLast = i + chunkSize >= summary.length;
    await ctx.reply(part, isLast ? inlineMenuKeyboard() : undefined);
  }
}

bot.action("menu_pyq", async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await ctx.reply("🟩 Gemini AI se PYQs taiyar kiye ja rahe hain...");
    const aiText = await askGemini(
      `Provide 5 important Previous Year Questions (PYQs) across Pharmaceutical analysis & organic chemistry, Human anatomy & physiology 1, Pharmaceutics, Pharmacognosy, and Python, each with its answer and brief explanation.`
    );
    await ctx.reply(`🟩 *PYQ (Gemini AI)*\n\n${aiText}`, inlineMenuKeyboard());
  } catch (err) {
    await ctx.reply(`PYQ error: ${err.message}`);
  }
});

bot.action("menu_mock", async (ctx) => {
  await ctx.answerCbQuery();
  const s = getSession(ctx.from.id);
  try {
    await ctx.reply(
      "🟩 Gemini AI se 20 questions ka Mock Test set ban raha hai, kripya thoda wait karein..."
    );
    const questions = await generateMockSet(
      SUBJECTS.join(", ")
    );
    s.mock = {
      questions,
      index: 0,
      answers: [],
    };
    await sendMockQuestion(ctx, s);
  } catch (err) {
    await ctx.reply(`Mock Test error: ${err.message}`);
  }
});

for (let qIdx = 0; qIdx < 20; qIdx++) {
  for (const opt of ["A", "B", "C", "D", "E"]) {
    bot.action(`mock_ans_${qIdx}_${opt}`, async (ctx) => {
      await ctx.answerCbQuery(opt === "E" ? "Question chhod diya gaya" : `Option ${opt} chuna gaya`);
      const s = getSession(ctx.from.id);
      if (!s.mock || s.mock.index !== qIdx) return;

      s.mock.answers[qIdx] = opt;
      s.mock.index += 1;

      if (s.mock.index < s.mock.questions.length) {
        await sendMockQuestion(ctx, s);
      } else {
        await finishMockTest(ctx, s);
      }
    });
  }
}
bot.command("reset", async (ctx) => {
  sessions.set(ctx.from.id, { mock: null });
  await ctx.reply(
    "STUDY BOT session reset ho gaya. Naye links ya files bhejein.",
    inlineMenuKeyboard()
  );
});

bot.command("status", async (ctx) => {
  const s = getSession(ctx.from.id);
  await ctx.reply(
    [
      "STUDY BOT Session Status:",
      `• APK URL: ${s.apkUrl || "Pending"}`,
      `• Source ZIP URL: ${s.sourceZipUrl || "Not provided"}`,
      `• Website ZIP URL: ${s.websiteZipUrl || "Not provided"}`,
      `• Website URL: ${s.websiteUrl || "Not provided"}`,
      `• Active Mock Test: ${s.mock ? `${s.mock.index + 1}/${s.mock.questions.length}` : "None"}`,
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
        "Source ZIP link STUDY BOT session mein save ho gaya. Ab website panel ZIP/link bhej kar /mergebuild likhein."
      );
    }

    s.websiteZipUrl = fileLink.href;
    await ctx.reply(
      "Website ZIP link STUDY BOT session mein save ho gaya. Ab /build ya /mergebuild likhein."
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
  await ctx.reply("STUDY BOT APK source code extraction trigger kiya ja raha hai...");

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
  await ctx.reply("Source + STUDY BOT merge aur APK build start ho raha hai...");

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
    console.log("STUDY BOT chal raha hai...");
  })
  .catch((err) => {
    console.error("Bot launch error:", err);
    process.exit(1);
  });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
