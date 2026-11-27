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
        temperature: 0.45,
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
    sessions.set(userId, { mock: null, pendingMockSubject: null });
  }
  const s = sessions.get(userId);
  if (!("mock" in s)) s.mock = null;
  if (!("pendingMockSubject" in s)) s.pendingMockSubject = null;
  return s;
}

async function replacePage(ctx, text, extra = {}) {
  try {
    if (ctx.callbackQuery?.message?.message_id) {
      await ctx.deleteMessage(ctx.callbackQuery.message.message_id).catch(() => {});
    }
  } catch (_) {}
  return ctx.reply(text, extra);
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

function mockModeKeyboard(subjIdx) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "🟩 Short Test (Unit • 40 Q • 40M • -1/3 • 1 Hr)",
        `mock_mode_${subjIdx}_short`
      ),
    ],
    [
      Markup.button.callback(
        "🟩 Full Course (Full Syllabus • 80 Q • 80M • -1/3 • 3 Hr)",
        `mock_mode_${subjIdx}_full`
      ),
    ],
    [Markup.button.callback("🟩 Back to Subjects", "menu_mock")],
    [Markup.button.callback("🟩 Back to Menu", "back_main")],
  ]);
}

function mockOptionKeyboard(qIndex) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🟩 A", `mock_ans_${qIndex}_A`),
      Markup.button.callback("🟩 B", `mock_ans_${qIndex}_B`),
      Markup.button.callback("🟩 C", `mock_ans_${qIndex}_C`),
      Markup.button.callback("🟩 D", `mock_ans_${qIndex}_D`),
    ],
    [
      Markup.button.callback("🟩 E (Chhodna / Skip)", `mock_ans_${qIndex}_E`),
      Markup.button.callback("🟩 Submit Test", `mock_submit_${qIndex}`),
    ],
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
    "— 🟩 PYQ (Subject-wise AI)",
    "— 🟩 Mock Test (Short 1Hr • Full 3Hr • -1/3)",
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
  sessions.set(ctx.from.id, { mock: null, pendingMockSubject: null });
  await replacePage(ctx, buildStartMessage(ctx), {
    ...inlineMenuKeyboard(),
    reply_markup: {
      ...inlineMenuKeyboard().reply_markup,
      remove_keyboard: true,
    },
  });
});

bot.action("back_main", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(ctx, buildStartMessage(ctx), inlineMenuKeyboard());
});

bot.action("menu_notes", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(
    ctx,
    "🟦 *Notes — Subject Chunein:*",
    subjectButtonsKeyboard("notes_subj", true)
  );
});

bot.action("menu_syllabus", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(
    ctx,
    "🟩 *Syllabus — Subject Chunein:*",
    subjectButtonsKeyboard("syl_subj", false)
  );
});

bot.action("menu_lecture", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(
    ctx,
    "🟩 *Lecture — Subject Chunein:*",
    subjectButtonsKeyboard("lec_subj", false)
  );
});

bot.action("menu_pyq", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(
    ctx,
    "🟩 *PYQ (Previous Year Questions) — Subject Chunein:*",
    subjectButtonsKeyboard("pyq_subj", false)
  );
});

for (let i = 0; i < SUBJECTS.length; i++) {
  const subjectName = SUBJECTS[i];

  bot.action(`notes_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await replacePage(
        ctx,
        `🟦 *${subjectName}* ke notes taiyar kiye ja rahe hain...`
      );
      const aiText = await askGemini(
        `Create clear, structured study notes and key revision points for the subject "${subjectName}". Keep it concise and easy to read on mobile.`
      );
      await ctx.reply(
        `🟦 *Notes: ${subjectName}*\n\n${aiText}`,
        subjectButtonsKeyboard("notes_subj", true)
      );
    } catch (err) {
      await ctx.reply(
        `Notes error: ${err.message}`,
        subjectButtonsKeyboard("notes_subj", true)
      );
    }
  });

  bot.action(`syl_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await replacePage(ctx, `🟩 *${subjectName}* ka syllabus load ho raha hai...`);
      const aiText = await askGemini(
        `Provide a clean unit-wise and topic-wise syllabus outline for "${subjectName}".`
      );
      await ctx.reply(
        `🟩 *Syllabus: ${subjectName}*\n\n${aiText}`,
        subjectButtonsKeyboard("syl_subj", false)
      );
    } catch (err) {
      await ctx.reply(
        `Syllabus error: ${err.message}`,
        subjectButtonsKeyboard("syl_subj", false)
      );
    }
  });

  bot.action(`lec_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await replacePage(
        ctx,
        `🟩 *${subjectName}* ke lecture topics & guide taiyar ho rahe hain...`
      );
      const aiText = await askGemini(
        `List key lecture topics, study sequence, and what to focus on in video/class lectures for "${subjectName}".`
      );
      await ctx.reply(
        `🟩 *Lecture: ${subjectName}*\n\n${aiText}`,
        subjectButtonsKeyboard("lec_subj", false)
      );
    } catch (err) {
      await ctx.reply(
        `Lecture error: ${err.message}`,
        subjectButtonsKeyboard("lec_subj", false)
      );
    }
  });

  bot.action(`pyq_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await replacePage(
        ctx,
        `🟩 *${subjectName}* ke Previous Year Questions (PYQ) taiyar ho rahe hain...`
      );
      const aiText = await askGemini(
        `Provide 6 important Previous Year Questions (PYQs) specifically for the subject "${subjectName}", each with year/exam tag, correct answer, and brief explanation.`
      );
      await ctx.reply(
        `🟩 *PYQ: ${subjectName}*\n\n${aiText}`,
        subjectButtonsKeyboard("pyq_subj", false)
      );
    } catch (err) {
      await ctx.reply(
        `PYQ error: ${err.message}`,
        subjectButtonsKeyboard("pyq_subj", false)
      );
    }
  });
}
const MOCK_CONFIGS = {
  short: {
    mode: "short",
    label: "Short Test (Unit-wise)",
    count: 40,
    totalMarks: 40,
    marksPerQ: 1,
    negativePerWrong: 1 / 3,
    durationMins: 60, // 1 hour
    timeLabel: "1 Hour (60 Min)",
    scopePrompt: "a core unit/chapter of",
  },
  full: {
    mode: "full",
    label: "Full Course Test",
    count: 80,
    totalMarks: 80,
    marksPerQ: 1,
    negativePerWrong: 1 / 3,
    durationMins: 180, // 3 hours
    timeLabel: "3 Hours (180 Min)",
    scopePrompt: "the full syllabus of",
  },
};

function parseJsonArraySafe(raw) {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}

  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    const sliced = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(sliced);
    if (Array.isArray(parsed)) return parsed;
  }
  throw new Error("Question paper JSON parse nahi ho paya.");
}

async function generateExamPaperBatch(subjectName, modeKey, startNum, batchSize) {
  const cfg = MOCK_CONFIGS[modeKey] || MOCK_CONFIGS.short;
  const prompt = [
    `Create ${batchSize} high-quality exam practice multiple-choice questions (numbered starting at ${startNum}) covering ${cfg.scopePrompt} "${subjectName}".`,
    `Focus on strong conceptual clarity, definitions, reactions/mechanisms/principles/code/communication concepts suitable for serious exam practice.`,
    `Return ONLY valid JSON (no markdown fences) as an array of ${batchSize} objects with this exact structure:`,
    `[{"unit":"Unit 1","q":"Question text","A":"Option A","B":"Option B","C":"Option C","D":"Option D","ans":"A","reason":"Concise explanation"}]`,
    `Rules: "ans" must be one of "A", "B", "C", or "D". All 4 options must be distinct and plausible.`,
  ].join("\n");

  const raw = await askGemini(prompt);
  const items = parseJsonArraySafe(raw);
  return items.slice(0, batchSize).map((item, idx) => ({
    unit: item.unit || (modeKey === "short" ? "Unit Paper" : "Full Syllabus"),
    q: item.q || `Practice Question ${startNum + idx}`,
    A: item.A || "Option A",
    B: item.B || "Option B",
    C: item.C || "Option C",
    D: item.D || "Option D",
    ans: ["A", "B", "C", "D"].includes(String(item.ans || "").toUpperCase())
      ? String(item.ans).toUpperCase()
      : "A",
    reason: item.reason || "Concept review recommended.",
  }));
}

async function generateFullExamPaper(subjectName, modeKey, ctx) {
  const cfg = MOCK_CONFIGS[modeKey] || MOCK_CONFIGS.short;
  const batchSize = 20;
  const allQuestions = [];

  for (let offset = 0; offset < cfg.count; offset += batchSize) {
    const currentBatch = Math.min(batchSize, cfg.count - offset);
    if (ctx && cfg.count > 20) {
      await replacePage(
        ctx,
        `🟩 *${subjectName}* — *${cfg.label}*\nPractice questions ban rahe hain: *${Math.min(
          offset + currentBatch,
          cfg.count
        )} / ${cfg.count}*...`
      );
    }
    const batch = await generateExamPaperBatch(
      subjectName,
      modeKey,
      offset + 1,
      currentBatch
    );
    allQuestions.push(...batch);
  }

  return allQuestions.slice(0, cfg.count);
}
async function sendMockQuestion(ctx, s) {
  const m = s.mock;
  if (!m || m.index >= m.questions.length) {
    return finishMockTest(ctx, s);
  }

  const elapsedMins = Math.max(
    0,
    Math.floor((Date.now() - m.startedAt) / 60000)
  );
  if (elapsedMins >= m.durationMins) {
    await ctx.reply("⏱️ *Time over!* Aapka paper auto-submit ho raha hai.");
    return finishMockTest(ctx, s);
  }

  const qObj = m.questions[m.index];
  const qNum = m.index + 1;
  const remainingMins = Math.max(0, m.durationMins - elapsedMins);

  const text = [
    `🟩 *${m.subject}*`,
    `📝 *${m.label}* | MM: ${m.totalMarks} | Neg: -1/3 | Left: ~${remainingMins}m`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*Q${qNum} / ${m.questions.length}* [${qObj.unit} • +${m.marksPerQ} / -1/3]:`,
    `${qObj.q}`,
    "",
    `A) ${qObj.A}`,
    `B) ${qObj.B}`,
    `C) ${qObj.C}`,
    `D) ${qObj.D}`,
    `E) Chhodna (Skip)`,
  ].join("\n");

  await replacePage(ctx, text, mockOptionKeyboard(m.index));
}

async function finishMockTest(ctx, s) {
  const m = s.mock;
  s.mock = null;
  if (!m) return;

  let correctCount = 0;
  let wrongCount = 0;
  let skippedCount = 0;
  const reviewLines = [];

  for (let idx = 0; idx < m.questions.length; idx++) {
    const qObj = m.questions[idx];
    const picked = m.answers[idx];

    if (!picked || picked === "E") {
      skippedCount++;
      reviewLines.push(
        `Q${idx + 1}: ⏭️ Chhoda (0 | Sahi: ${qObj.ans}) — ${qObj.reason}`
      );
    } else if (picked === qObj.ans) {
      correctCount++;
      reviewLines.push(`Q${idx + 1}: ✅ Sahi (${picked} • +1)`);
    } else {
      wrongCount++;
      reviewLines.push(
        `Q${idx + 1}: ❌ Galat (${picked} | Sahi: ${qObj.ans} • -1/3) — ${qObj.reason}`
      );
    }
  }

  const positiveMarks = correctCount * m.marksPerQ;
  const negativeMarks = wrongCount * m.negativePerWrong;
  const netMarks = Number((positiveMarks - negativeMarks).toFixed(2));

  const takenSecs = Math.max(1, Math.round((Date.now() - m.startedAt) / 1000));
  const mins = Math.floor(takenSecs / 60);
  const secs = takenSecs % 60;

  const summary = [
    "🟩 *EXAM PAPER RESULT SUMMARY*",
    `📚 Subject: *${m.subject}*`,
    `📋 Type: *${m.label}*`,
    "━━━━━━━━━━━━━━━━━━━━",
    `🏆 Net Score: *${netMarks} / ${m.totalMarks}*`,
    `➕ Positive Marks: *+${positiveMarks.toFixed(2)}*`,
    `➖ Negative Marks (-1/3): *-${negativeMarks.toFixed(2)}*`,
    `⏱️ Time Taken: *${mins}m ${secs}s* (Limit: ${m.timeLabel})`,
    `✅ Sahi (Correct): *${correctCount}*`,
    `❌ Galat (Wrong): *${wrongCount}*`,
    `⏭️ Chhode (Skipped): *${skippedCount}*`,
    `📊 Total Questions: *${m.questions.length}*`,
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "*Question-wise Answer Key & Review:*",
    ...reviewLines,
  ].join("\n");

  await replacePage(
    ctx,
    summary.slice(0, 3500),
    summary.length <= 3500 ? inlineMenuKeyboard() : undefined
  );
  for (let i = 3500; i < summary.length; i += 3500) {
    const part = summary.slice(i, i + 3500);
    const isLast = i + 3500 >= summary.length;
    await ctx.reply(part, isLast ? inlineMenuKeyboard() : undefined);
  }
}

bot.action("menu_mock", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(
    ctx,
    "🟩 *Mock Test — Subject Chunein:*",
    subjectButtonsKeyboard("mock_subj", false)
  );
});

for (let i = 0; i < SUBJECTS.length; i++) {
  const subjectName = SUBJECTS[i];

  bot.action(`mock_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    s.pendingMockSubject = i;

    const infoText = [
      `🟩 *Mock Test — ${subjectName}*`,
      "",
      "Apna exam paper chunein:",
      "• *Short Test (Unit-wise):* 40 Questions • 40 Marks • -1/3 Negative • *1 Hour*",
      "• *Full Course Test:* 80 Questions • 80 Marks • -1/3 Negative • *3 Hours*",
    ].join("\n");

    await replacePage(ctx, infoText, mockModeKeyboard(i));
  });

  for (const modeKey of ["short", "full"]) {
    bot.action(`mock_mode_${i}_${modeKey}`, async (ctx) => {
      await ctx.answerCbQuery();
      const s = getSession(ctx.from.id);
      const cfg = MOCK_CONFIGS[modeKey];

      try {
        await replacePage(
          ctx,
          `🟩 *${subjectName}* ke liye *${cfg.label}* (${cfg.count} Q • ${cfg.totalMarks}M • -1/3 • ${cfg.timeLabel}) ban raha hai...`
        );
        const questions = await generateFullExamPaper(subjectName, modeKey, ctx);
        s.mock = {
          subject: subjectName,
          label: cfg.label,
          totalMarks: cfg.totalMarks,
          marksPerQ: cfg.marksPerQ,
          negativePerWrong: cfg.negativePerWrong,
          durationMins: cfg.durationMins,
          timeLabel: cfg.timeLabel,
          startedAt: Date.now(),
          questions,
          index: 0,
          answers: [],
        };
        await sendMockQuestion(ctx, s);
      } catch (err) {
        await ctx.reply(`Mock test error: ${err.message}`, mockModeKeyboard(i));
      }
    });
  }
}

for (let qIdx = 0; qIdx < 80; qIdx++) {
  for (const opt of ["A", "B", "C", "D", "E"]) {
    bot.action(`mock_ans_${qIdx}_${opt}`, async (ctx) => {
      await ctx.answerCbQuery(
        opt === "E" ? "Question chhod diya gaya" : `Option ${opt} chuna gaya`
      );
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

  bot.action(`mock_submit_${qIdx}`, async (ctx) => {
    await ctx.answerCbQuery("Paper submit kiya ja raha hai...");
    const s = getSession(ctx.from.id);
    if (!s.mock) return;
    await finishMockTest(ctx, s);
  });
}
bot.command("reset", async (ctx) => {
  sessions.set(ctx.from.id, { mock: null, pendingMockSubject: null });
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
      `• Active Mock Test: ${
        s.mock
          ? `${s.mock.subject} (${s.mock.label}) — ${s.mock.index + 1}/${s.mock.questions.length}`
          : "None"
      }`,
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
