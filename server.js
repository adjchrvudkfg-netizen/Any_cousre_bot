const http = require("http");
const { Telegraf, Markup } = require("telegraf");
const { PDFDocument } = require("pdf-lib");

const BOT_TOKEN = (process.env.BOT_TOKEN || "").trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

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

const DEFAULT_UNITS = ["Unit 1", "Unit 2", "Unit 3", "Unit 4", "Unit 5"];

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

function isAdmin(userId) {
  if (!ADMIN_IDS.length) return true;
  return ADMIN_IDS.includes(Number(userId));
}

async function mergeFilesToSinglePdf(items) {
  const mergedPdf = await PDFDocument.create();

  for (const item of items) {
    const res = await fetch(item.url);
    if (!res.ok) {
      throw new Error(`File download fail (${res.status}): ${item.name || "file"}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const lowerName = (item.name || "").toLowerCase();
    const isPdf =
      item.mime === "application/pdf" ||
      lowerName.endsWith(".pdf") ||
      (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

    if (isPdf) {
      const srcPdf = await PDFDocument.load(bytes);
      const pages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());
      pages.forEach((p) => mergedPdf.addPage(p));
    } else {
      let img;
      try {
        img = await mergedPdf.embedJpg(bytes);
      } catch (_) {
        img = await mergedPdf.embedPng(bytes);
      }
      const page = mergedPdf.addPage([img.width, img.height]);
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      });
    }
  }

  if (mergedPdf.getPageCount() === 0) {
    throw new Error("Merge karne ke liye koi valid PDF ya image page nahi mila.");
  }

  return Buffer.from(await mergedPdf.save());
}
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
        temperature: 0.35,
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

// studyStore[subjIdx][unitIdx] = { notesText, noteFiles: [], syllabusText, lectures: [] }
const studyStore = SUBJECTS.map(() =>
  DEFAULT_UNITS.map(() => ({
    notesText: "",
    noteFiles: [], // { name, url, mime }
    syllabusText: "",
    lectures: [], // { title, youtubeUrl, videoFileId }
  }))
);

function getUnitData(subjIdx, unitIdx) {
  if (!studyStore[subjIdx]) studyStore[subjIdx] = [];
  if (!studyStore[subjIdx][unitIdx]) {
    studyStore[subjIdx][unitIdx] = {
      notesText: "",
      noteFiles: [],
      syllabusText: "",
      lectures: [],
    };
  }
  return studyStore[subjIdx][unitIdx];
}

const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      mock: null,
      pendingMockSubject: null,
      activeSubj: 0,
      activeUnit: 0,
      awaitingLectureVideoFor: null, // { subjIdx, unitIdx, lecIdx }
      awaitingYoutubeFor: null, // { subjIdx, unitIdx, lecIdx }
    });
  }
  return sessions.get(userId);
}

async function replacePage(ctx, text, extra = {}) {
  try {
    if (ctx.callbackQuery?.message?.message_id) {
      await ctx
        .deleteMessage(ctx.callbackQuery.message.message_id)
        .catch(() => {});
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

function isYoutubeUrl(str) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(str.trim());
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
    [Markup.button.callback("🔵 Notes", "menu_notes")],
    [
      Markup.button.callback("🟢 Syllabus", "menu_syllabus"),
      Markup.button.callback("🟢 PYQ", "menu_pyq"),
    ],
    [
      Markup.button.callback("🟢 Mock Test", "menu_mock"),
      Markup.button.callback("🟢 Lecture", "menu_lecture"),
    ],
  ]);
}

function subjectButtonsKeyboard(prefix, isNotes = false) {
  const icon = isNotes ? "🔵" : "🟢";
  const rows = SUBJECTS.map((subj, idx) => [
    Markup.button.callback(`${icon} ${idx + 1}. ${subj}`, `${prefix}_${idx}`),
  ]);
  rows.push([Markup.button.callback("🟢 Back to Menu", "back_main")]);
  return Markup.inlineKeyboard(rows);
}

function unitButtonsKeyboard(prefix, subjIdx, isNotes = false) {
  const icon = isNotes ? "🔵" : "🟢";
  const rows = DEFAULT_UNITS.map((unitLabel, uIdx) => [
    Markup.button.callback(`${icon} ${unitLabel}`, `${prefix}_${subjIdx}_${uIdx}`),
  ]);
  if (prefix === "notes_unit") {
    rows.push([
      Markup.button.callback(
        "🔵 Merge All Notes Files -> 1 PDF",
        `merge_notes_btn_${subjIdx}`
      ),
    ]);
  }
  rows.push([Markup.button.callback("🟢 Back to Menu", "back_main")]);
  return Markup.inlineKeyboard(rows);
}

function lectureListKeyboard(subjIdx, unitIdx) {
  const uData = getUnitData(subjIdx, unitIdx);
  const rows = uData.lectures.map((lec, lIdx) => [
    Markup.button.callback(
      `🟢 Lecture ${lIdx + 1}: ${lec.title}`,
      `open_lec_${subjIdx}_${unitIdx}_${lIdx}`
    ),
  ]);
  rows.push([
    Markup.button.callback("🟢 Back to Units", `lec_subj_${subjIdx}`),
    Markup.button.callback("🟢 Back to Menu", "back_main"),
  ]);
  return Markup.inlineKeyboard(rows);
}

function lectureDetailKeyboard(subjIdx, unitIdx, lecIdx) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "🟢 Set / Update YouTube Link",
        `set_yt_${subjIdx}_${unitIdx}_${lecIdx}`
      ),
      Markup.button.callback(
        "🟢 Upload / Update Video",
        `set_vid_${subjIdx}_${unitIdx}_${lecIdx}`
      ),
    ],
    [
      Markup.button.callback(
        "🟢 Back to Lectures",
        `lec_unit_${subjIdx}_${unitIdx}`
      ),
      Markup.button.callback("🟢 Back to Menu", "back_main"),
    ],
  ]);
}

function mockModeKeyboard(subjIdx) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "🟢 Short Test (Unit • 40 Q • 40M • -1/3 • 1 Hr)",
        `mock_mode_${subjIdx}_short`
      ),
    ],
    [
      Markup.button.callback(
        "🟢 Full Course (Full Syllabus • 80 Q • 80M • -1/3 • 3 Hr)",
        `mock_mode_${subjIdx}_full`
      ),
    ],
    [Markup.button.callback("🟢 Back to Subjects", "menu_mock")],
    [Markup.button.callback("🟢 Back to Menu", "back_main")],
  ]);
}

function mockOptionKeyboard(qIndex) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🟢 A", `mock_ans_${qIndex}_A`),
      Markup.button.callback("🟢 B", `mock_ans_${qIndex}_B`),
      Markup.button.callback("🟢 C", `mock_ans_${qIndex}_C`),
      Markup.button.callback("🟢 D", `mock_ans_${qIndex}_D`),
    ],
    [
      Markup.button.callback("🟢 E (Chhodna / Skip)", `mock_ans_${qIndex}_E`),
      Markup.button.callback("🟢 Submit Test", `mock_submit_${qIndex}`),
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
    "— 🔵 Notes (Unit PDF/Photo Merge)",
    "— 🟢 Syllabus (Subject & Unit-wise)",
    "— 🟢 PYQ (Past Exam Questions Only)",
    "— 🟢 Mock Test (Short 1Hr • Full 3Hr • -1/3)",
    "— 🟢 Lecture (Subject -> Unit -> Lectures)",
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

function parseSubjAndUnit(rawSubj, rawUnit) {
  const sIdx = Number(rawSubj) - 1;
  const uIdx = Number(rawUnit) - 1;
  if (
    !Number.isInteger(sIdx) ||
    sIdx < 0 ||
    sIdx >= SUBJECTS.length ||
    !Number.isInteger(uIdx) ||
    uIdx < 0 ||
    uIdx >= DEFAULT_UNITS.length
  ) {
    throw new Error(
      `Invalid subject (1-${SUBJECTS.length}) ya unit (1-${DEFAULT_UNITS.length}) number.`
    );
  }
  return { sIdx, uIdx };
}

bot.command("addnotes", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("Sirf admin hi notes add kar sakta hai.");
  const payload = ctx.message.text.replace(/^\/addnotes\s*/i, "");
  const parts = payload.split("|").map((p) => p.trim());
  if (parts.length < 3) {
    return ctx.reply(
      "Format: `/addnotes <subj_1_to_6> | <unit_1_to_5> | <notes text>`",
      { parse_mode: "Markdown" }
    );
  }
  try {
    const { sIdx, uIdx } = parseSubjAndUnit(parts[0], parts[1]);
    const noteBody = parts.slice(2).join(" | ");
    const uData = getUnitData(sIdx, uIdx);
    uData.notesText = uData.notesText ? `${uData.notesText}\n\n${noteBody}` : noteBody;

    const s = getSession(ctx.from.id);
    s.activeSubj = sIdx;
    s.activeUnit = uIdx;

    await ctx.reply(
      `🔵 Notes add ho gaye!\nSubject: *${SUBJECTS[sIdx]}*\nUnit: *${DEFAULT_UNITS[uIdx]}*\n\nAb is unit ke liye PDFs/Photos bhej kar /mergenotes ${sIdx + 1} | ${uIdx + 1} chala sakte hain.`
    );
  } catch (err) {
    await ctx.reply(`Add notes error: ${err.message}`);
  }
});

bot.command("addsyllabus", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("Sirf admin hi syllabus add kar sakta hai.");
  const payload = ctx.message.text.replace(/^\/addsyllabus\s*/i, "");
  const parts = payload.split("|").map((p) => p.trim());
  if (parts.length < 3) {
    return ctx.reply(
      "Format: `/addsyllabus <subj_1_to_6> | <unit_1_to_5> | <syllabus text>`",
      { parse_mode: "Markdown" }
    );
  }
  try {
    const { sIdx, uIdx } = parseSubjAndUnit(parts[0], parts[1]);
    const sylBody = parts.slice(2).join(" | ");
    const uData = getUnitData(sIdx, uIdx);
    uData.syllabusText = sylBody;

    await ctx.reply(
      `🟢 Syllabus update ho gaya!\nSubject: *${SUBJECTS[sIdx]}*\nUnit: *${DEFAULT_UNITS[uIdx]}*`
    );
  } catch (err) {
    await ctx.reply(`Add syllabus error: ${err.message}`);
  }
});

bot.command("addlecture", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("Sirf admin hi lecture add kar sakta hai.");
  const payload = ctx.message.text.replace(/^\/addlecture\s*/i, "");
  const parts = payload.split("|").map((p) => p.trim());
  if (parts.length < 3) {
    return ctx.reply(
      "Format: `/addlecture <subj_1_to_6> | <unit_1_to_5> | <lecture title> | <optional youtube_url>`",
      { parse_mode: "Markdown" }
    );
  }
  try {
    const { sIdx, uIdx } = parseSubjAndUnit(parts[0], parts[1]);
    const title = parts[2];
    const ytUrl = parts[3] && isHttpUrl(parts[3]) ? parts[3] : "";
    const uData = getUnitData(sIdx, uIdx);

    uData.lectures.push({
      title,
      youtubeUrl: ytUrl,
      videoFileId: "",
    });
    const lecIdx = uData.lectures.length - 1;

    await ctx.reply(
      [
        `🟢 Lecture #${lecIdx + 1} add ho gaya!`,
        `Subject: *${SUBJECTS[sIdx]}*`,
        `Unit: *${DEFAULT_UNITS[uIdx]}*`,
        `Title: *${title}*`,
        `YouTube: ${ytUrl || "Not set (abhi link bhej sakte hain)"}`,
        "",
        "Is lecture ka YouTube link ya video file bhejne ke liye neeche buttons use karein:",
      ].join("\n"),
      lectureDetailKeyboard(sIdx, uIdx, lecIdx)
    );
  } catch (err) {
    await ctx.reply(`Add lecture error: ${err.message}`);
  }
});

async function mergeAndSendUnitNotes(ctx, sIdx, uIdx) {
  const uData = getUnitData(sIdx, uIdx);
  if (!uData.noteFiles.length) {
    return ctx.reply(
      `🔵 *${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]})* mein merge karne ke liye koi PDF ya Photo upload nahi hui hai.`
    );
  }

  await ctx.reply(
    `🔵 *${SUBJECTS[sIdx]} — ${DEFAULT_UNITS[uIdx]}* ki ${uData.noteFiles.length} files ek PDF mein merge ho rahi hain...`
  );

  const mergedBuf = await mergeFilesToSinglePdf(uData.noteFiles);
  const fileName = `${SUBJECTS[sIdx].replace(/[^a-zA-Z0-9]+/g, "_")}_${DEFAULT_UNITS[uIdx].replace(/\s+/g, "_")}_Notes.pdf`;

  await ctx.replyWithDocument(
    { source: mergedBuf, filename: fileName },
    {
      caption: `🔵 *${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]})* — Combined Notes PDF (${uData.noteFiles.length} files merged)`,
      ...inlineMenuKeyboard(),
    }
  );
}

bot.command("mergenotes", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply("Sirf admin hi notes merge kar sakta hai.");
  }
  const s = getSession(ctx.from.id);
  const payload = ctx.message.text.replace(/^\/mergenotes\s*/i, "").trim();

  let sIdx = s.activeSubj ?? 0;
  let uIdx = s.activeUnit ?? 0;

  if (payload) {
    const parts = payload.split("|").map((p) => p.trim());
    if (parts.length >= 2) {
      const parsed = parseSubjAndUnit(parts[0], parts[1]);
      sIdx = parsed.sIdx;
      uIdx = parsed.uIdx;
    }
  }

  try {
    await mergeAndSendUnitNotes(ctx, sIdx, uIdx);
  } catch (err) {
    await ctx.reply(`Merge notes error: ${err.message}`);
  }
});
bot.start(async (ctx) => {
  sessions.set(ctx.from.id, {
    mock: null,
    pendingMockSubject: null,
    activeSubj: 0,
    activeUnit: 0,
    awaitingLectureVideoFor: null,
    awaitingYoutubeFor: null,
  });
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

// Notes -> Subjects -> Units -> View Notes + Single Merged PDF
bot.action("menu_notes", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(
    ctx,
    "🔵 *Notes — Subject Chunein:*",
    subjectButtonsKeyboard("notes_subj", true)
  );
});

// Syllabus -> Subjects -> Units
bot.action("menu_syllabus", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(
    ctx,
    "🟢 *Syllabus — Subject Chunein:*",
    subjectButtonsKeyboard("syl_subj", false)
  );
});

// Lecture -> Subjects -> Units -> Dynamic Lectures
bot.action("menu_lecture", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(
    ctx,
    "🟢 *Lecture — Subject Chunein:*",
    subjectButtonsKeyboard("lec_subj", false)
  );
});

// PYQ -> Subjects -> Past Exam PYQs Only
bot.action("menu_pyq", async (ctx) => {
  await ctx.answerCbQuery();
  await replacePage(
    ctx,
    "🟢 *PYQ (Pehle Exam Mein Aaye Hue Questions) — Subject Chunein:*",
    subjectButtonsKeyboard("pyq_subj", false)
  );
});

for (let i = 0; i < SUBJECTS.length; i++) {
  const subjectName = SUBJECTS[i];

  bot.action(`notes_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    s.activeSubj = i;
    await replacePage(
      ctx,
      `🔵 *Notes: ${subjectName}*\nUnit chunein (ya is subject ki unit files merge karein):`,
      unitButtonsKeyboard("notes_unit", i, true)
    );
  });

  bot.action(`merge_notes_btn_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    try {
      await mergeAndSendUnitNotes(ctx, i, s.activeUnit ?? 0);
    } catch (err) {
      await ctx.reply(`Merge error: ${err.message}`);
    }
  });

  bot.action(`syl_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    await replacePage(
      ctx,
      `🟢 *Syllabus: ${subjectName}*\nUnit chunein:`,
      unitButtonsKeyboard("syl_unit", i, false)
    );
  });

  bot.action(`lec_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    await replacePage(
      ctx,
      `🟢 *Lecture: ${subjectName}*\nUnit chunein:`,
      unitButtonsKeyboard("lec_unit", i, false)
    );
  });

  bot.action(`pyq_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await replacePage(
        ctx,
        `🟢 *${subjectName}* ke pehle exam mein aaye hue PYQs nikaale ja rahe hain...`
      );
      const aiText = await askGemini(
        [
          `List ONLY authentic past examination questions (PYQs) that have previously appeared in exams for "${subjectName}".`,
          `Do NOT invent fresh hypothetical mock questions; present established past exam questions with their exam/year context (if known), clear answer, and short explanation.`,
        ].join("\n")
      );
      await replacePage(
        ctx,
        `🟢 *Past Exam PYQs: ${subjectName}*\n\n${aiText}`,
        subjectButtonsKeyboard("pyq_subj", false)
      );
    } catch (err) {
      await replacePage(
        ctx,
        `PYQ error: ${err.message}`,
        subjectButtonsKeyboard("pyq_subj", false)
      );
    }
  });

  for (let u = 0; u < DEFAULT_UNITS.length; u++) {
    const unitLabel = DEFAULT_UNITS[u];

    bot.action(`notes_unit_${i}_${u}`, async (ctx) => {
      await ctx.answerCbQuery();
      const s = getSession(ctx.from.id);
      s.activeSubj = i;
      s.activeUnit = u;

      const uData = getUnitData(i, u);
      if (uData.noteFiles.length > 0) {
        try {
          await mergeAndSendUnitNotes(ctx, i, u);
          return;
        } catch (err) {
          await ctx.reply(`PDF merge error: ${err.message}`);
        }
      }

      if (uData.notesText) {
        return replacePage(
          ctx,
          `🔵 *Notes: ${subjectName} (${unitLabel})*\n\n${uData.notesText}`,
          unitButtonsKeyboard("notes_unit", i, true)
        );
      }

      try {
        await replacePage(
          ctx,
          `🔵 *${subjectName} (${unitLabel})* ke notes taiyar kiye ja rahe hain...`
        );
        const aiText = await askGemini(
          `Create concise, well-structured revision notes for "${unitLabel}" of "${subjectName}".`
        );
        await replacePage(
          ctx,
          `🔵 *Notes: ${subjectName} (${unitLabel})*\n\n${aiText}`,
          unitButtonsKeyboard("notes_unit", i, true)
        );
      } catch (err) {
        await replacePage(
          ctx,
          `Notes error: ${err.message}`,
          unitButtonsKeyboard("notes_unit", i, true)
        );
      }
    });

    bot.action(`syl_unit_${i}_${u}`, async (ctx) => {
      await ctx.answerCbQuery();
      const uData = getUnitData(i, u);
      if (uData.syllabusText) {
        return replacePage(
          ctx,
          `🟢 *Syllabus: ${subjectName} (${unitLabel})*\n\n${uData.syllabusText}`,
          unitButtonsKeyboard("syl_unit", i, false)
        );
      }

      try {
        await replacePage(
          ctx,
          `🟢 *${subjectName} (${unitLabel})* ka syllabus load ho raha hai...`
        );
        const aiText = await askGemini(
          `Provide the detailed syllabus topics for "${unitLabel}" of "${subjectName}".`
        );
        await replacePage(
          ctx,
          `🟢 *Syllabus: ${subjectName} (${unitLabel})*\n\n${aiText}`,
          unitButtonsKeyboard("syl_unit", i, false)
        );
      } catch (err) {
        await replacePage(
          ctx,
          `Syllabus error: ${err.message}`,
          unitButtonsKeyboard("syl_unit", i, false)
        );
      }
    });

    bot.action(`lec_unit_${i}_${u}`, async (ctx) => {
      await ctx.answerCbQuery();
      const uData = getUnitData(i, u);
      const count = uData.lectures.length;

      const text =
        count > 0
          ? `🟢 *Lectures: ${subjectName} (${unitLabel})*\nKul Lectures: *${count}*\n\nKisi lecture par tap karein:`
          : `🟢 *Lectures: ${subjectName} (${unitLabel})*\nIs unit mein abhi koi lecture add nahi hua hai.\nAdmin \`/addlecture ${i + 1} | ${u + 1} | <Title> | <YouTube_URL>\` se add kar sakta hai.`;

      await replacePage(ctx, text, lectureListKeyboard(i, u));
    });

    for (let l = 0; l < 50; l++) {
      bot.action(`open_lec_${i}_${u}_${l}`, async (ctx) => {
        await ctx.answerCbQuery();
        const uData = getUnitData(i, u);
        const lec = uData.lectures[l];
        if (!lec) return;

        if (lec.videoFileId) {
          await ctx.replyWithVideo(lec.videoFileId, {
            caption: `🟢 *${lec.title}*\nSubject: ${subjectName} • ${unitLabel}${
              lec.youtubeUrl ? `\nYouTube: ${lec.youtubeUrl}` : ""
            }`,
            ...lectureDetailKeyboard(i, u, l),
          });
          return;
        }

        const msg = [
          `🟢 *${lec.title}*`,
          `Subject: *${subjectName}*`,
          `Unit: *${unitLabel}*`,
          `YouTube Link: ${lec.youtubeUrl || "Not provided"}`,
          `Uploaded Video: ${lec.videoFileId ? "Available" : "Not uploaded"}`,
        ].join("\n");

        await replacePage(ctx, msg, lectureDetailKeyboard(i, u, l));
      });

      bot.action(`set_yt_${i}_${u}_${l}`, async (ctx) => {
        await ctx.answerCbQuery();
        if (!isAdmin(ctx.from.id)) return ctx.reply("Sirf admin hi YouTube link set kar sakta hai.");
        const s = getSession(ctx.from.id);
        s.awaitingYoutubeFor = { subjIdx: i, unitIdx: u, lecIdx: l };
        s.awaitingLectureVideoFor = null;
        await ctx.reply(
          `🟢 *${getUnitData(i, u).lectures[l]?.title || "Lecture"}* ke liye YouTube link bhejein:`
        );
      });

      bot.action(`set_vid_${i}_${u}_${l}`, async (ctx) => {
        await ctx.answerCbQuery();
        if (!isAdmin(ctx.from.id)) return ctx.reply("Sirf admin hi video upload kar sakta hai.");
        const s = getSession(ctx.from.id);
        s.awaitingLectureVideoFor = { subjIdx: i, unitIdx: u, lecIdx: l };
        s.awaitingYoutubeFor = null;
        await ctx.reply(
          `🟢 *${getUnitData(i, u).lectures[l]?.title || "Lecture"}* ke liye video file bhejein:`
        );
      });
    }
  }
}
const MOCK_CONFIGS = {
  short: {
    mode: "short",
    label: "Short Test (Unit-wise)",
    count: 40,
    totalMarks: 40,
    marksPerQ: 1,
    negativePerWrong: 1 / 3,
    durationMins: 60,
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
    durationMins: 180,
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
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (Array.isArray(parsed)) return parsed;
  }
  throw new Error("Question paper JSON parse nahi ho paya.");
}

async function generateExamPaperBatch(subjectName, modeKey, startNum, batchSize) {
  const cfg = MOCK_CONFIGS[modeKey] || MOCK_CONFIGS.short;
  const prompt = [
    `Create ${batchSize} high-quality exam practice multiple-choice questions (numbered starting at ${startNum}) covering ${cfg.scopePrompt} "${subjectName}".`,
    `Return ONLY valid JSON (no markdown fences) as an array of ${batchSize} objects with this exact structure:`,
    `[{"unit":"Unit 1","q":"Question text","A":"Option A","B":"Option B","C":"Option C","D":"Option D","ans":"A","reason":"Concise explanation"}]`,
    `Rules: "ans" must be one of "A", "B", "C", or "D". All 4 options must be distinct.`,
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
        `🟢 *${subjectName}* — *${cfg.label}*\nPractice questions ban rahe hain: *${Math.min(
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

  const elapsedMins = Math.max(0, Math.floor((Date.now() - m.startedAt) / 60000));
  if (elapsedMins >= m.durationMins) {
    await ctx.reply("⏱️ *Time over!* Aapka paper auto-submit ho raha hai.");
    return finishMockTest(ctx, s);
  }

  const qObj = m.questions[m.index];
  const qNum = m.index + 1;
  const remainingMins = Math.max(0, m.durationMins - elapsedMins);

  const text = [
    `🟢 *${m.subject}*`,
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
    "🟢 *EXAM PAPER RESULT SUMMARY*",
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
    "🟢 *Mock Test — Subject Chunein:*",
    subjectButtonsKeyboard("mock_subj", false)
  );
});

for (let i = 0; i < SUBJECTS.length; i++) {
  const subjectName = SUBJECTS[i];

  bot.action(`mock_subj_${i}`, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    s.pendingMockSubject = i;
    await replacePage(
      ctx,
      [
        `🟢 *Mock Test — ${subjectName}*`,
        "",
        "Apna exam paper chunein:",
        "• *Short Test (Unit-wise):* 40 Questions • 40 Marks • -1/3 Negative • *1 Hour*",
        "• *Full Course Test:* 80 Questions • 80 Marks • -1/3 Negative • *3 Hours*",
      ].join("\n"),
      mockModeKeyboard(i)
    );
  });

  for (const modeKey of ["short", "full"]) {
    bot.action(`mock_mode_${i}_${modeKey}`, async (ctx) => {
      await ctx.answerCbQuery();
      const s = getSession(ctx.from.id);
      const cfg = MOCK_CONFIGS[modeKey];
      try {
        await replacePage(
          ctx,
          `🟢 *${subjectName}* ke liye *${cfg.label}* (${cfg.count} Q • ${cfg.totalMarks}M • -1/3 • ${cfg.timeLabel}) ban raha hai...`
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
        await replacePage(
          ctx,
          `Mock test error: ${err.message}`,
          mockModeKeyboard(i)
        );
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
  sessions.set(ctx.from.id, {
    mock: null,
    pendingMockSubject: null,
    activeSubj: 0,
    activeUnit: 0,
    awaitingLectureVideoFor: null,
    awaitingYoutubeFor: null,
  });
  await ctx.reply(
    "STUDY BOT session reset ho gaya. Naye links ya files bhejein.",
    inlineMenuKeyboard()
  );
});

bot.command("status", async (ctx) => {
  const s = getSession(ctx.from.id);
  const uData = getUnitData(s.activeSubj ?? 0, s.activeUnit ?? 0);
  await ctx.reply(
    [
      "STUDY BOT Session Status:",
      `• Active Subject: ${SUBJECTS[s.activeSubj ?? 0]}`,
      `• Active Unit: ${DEFAULT_UNITS[s.activeUnit ?? 0]}`,
      `• Staged Unit Note Files (PDF/Photo): ${uData.noteFiles.length}`,
      `• Unit Lectures Count: ${uData.lectures.length}`,
      `• APK URL: ${s.apkUrl || "Pending"}`,
      `• Source ZIP URL: ${s.sourceZipUrl || "Not provided"}`,
      `• Website ZIP URL: ${s.websiteZipUrl || "Not provided"}`,
      `• Website URL: ${s.websiteUrl || "Not provided"}`,
    ].join("\n"),
    inlineMenuKeyboard()
  );
});

// Admin photo upload -> current active subject/unit ke notes mein add (merge ready)
bot.on("photo", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (!isAdmin(ctx.from.id)) return;

  try {
    const photos = ctx.message.photo || [];
    const largest = photos[photos.length - 1];
    const fileLink = await ctx.telegram.getFileLink(largest.file_id);
    const uData = getUnitData(s.activeSubj ?? 0, s.activeUnit ?? 0);

    uData.noteFiles.push({
      name: `photo_${Date.now()}.jpg`,
      url: fileLink.href,
      mime: "image/jpeg",
    });

    await ctx.reply(
      `🔵 Photo notes mein add ho gayi! (${DEFAULT_UNITS[s.activeUnit ?? 0]} • Total files: ${uData.noteFiles.length})\nAur PDF/Photo bhejein ya /mergenotes se ek PDF banayein.`
    );
  } catch (err) {
    await ctx.reply(`Photo error: ${err.message}`);
  }
});

// Admin video upload -> selected lecture mein video update
bot.on("video", async (ctx) => {
  const s = getSession(ctx.from.id);
  if (!isAdmin(ctx.from.id)) return;

  const target = s.awaitingLectureVideoFor;
  if (!target) {
    return ctx.reply(
      "Kisi lecture par tap karke 'Upload / Update Video' chunein, phir video bhejein."
    );
  }

  const uData = getUnitData(target.subjIdx, target.unitIdx);
  const lec = uData.lectures[target.lecIdx];
  if (!lec) return ctx.reply("Lecture nahi mila.");

  lec.videoFileId = ctx.message.video.file_id;
  s.awaitingLectureVideoFor = null;

  await ctx.reply(
    `🟢 Lecture "${lec.title}" ka video update ho gaya!`,
    lectureDetailKeyboard(target.subjIdx, target.unitIdx, target.lecIdx)
  );
});

bot.on("document", async (ctx) => {
  const doc = ctx.message.document;
  const fileName = (doc.file_name || "").toLowerCase();
  const s = getSession(ctx.from.id);

  // Admin lecture video uploaded as document
  if (s.awaitingLectureVideoFor && isAdmin(ctx.from.id)) {
    const target = s.awaitingLectureVideoFor;
    const uData = getUnitData(target.subjIdx, target.unitIdx);
    const lec = uData.lectures[target.lecIdx];
    if (lec) {
      lec.videoFileId = doc.file_id;
      s.awaitingLectureVideoFor = null;
      return ctx.reply(
        `🟢 Lecture "${lec.title}" ka video file update ho gaya!`,
        lectureDetailKeyboard(target.subjIdx, target.unitIdx, target.lecIdx)
      );
    }
  }

  // Admin PDF upload -> current active subject/unit ke notes mein add (merge ready)
  if (fileName.endsWith(".pdf") && isAdmin(ctx.from.id)) {
    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const uData = getUnitData(s.activeSubj ?? 0, s.activeUnit ?? 0);
      uData.noteFiles.push({
        name: doc.file_name || `notes_${Date.now()}.pdf`,
        url: fileLink.href,
        mime: "application/pdf",
      });

      return ctx.reply(
        `🔵 PDF "${doc.file_name}" notes mein add ho gayi! (${DEFAULT_UNITS[s.activeUnit ?? 0]} • Total files: ${uData.noteFiles.length})\nAur PDF/Photo bhejein ya /mergenotes se ek single PDF banayein.`
      );
    } catch (err) {
      return ctx.reply(`PDF upload error: ${err.message}`);
    }
  }

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

  const s = getSession(ctx.from.id);

  // Admin awaiting YouTube link for a specific lecture
  if (s.awaitingYoutubeFor && isAdmin(ctx.from.id)) {
    if (!isHttpUrl(text)) {
      return ctx.reply("Kripya valid YouTube https:// link bhejein.");
    }
    const target = s.awaitingYoutubeFor;
    const uData = getUnitData(target.subjIdx, target.unitIdx);
    const lec = uData.lectures[target.lecIdx];
    if (lec) {
      lec.youtubeUrl = text;
      s.awaitingYoutubeFor = null;
      return ctx.reply(
        `🟢 Lecture "${lec.title}" ka YouTube link update ho gaya:\n${text}`,
        lectureDetailKeyboard(target.subjIdx, target.unitIdx, target.lecIdx)
      );
    }
  }

  if (!isHttpUrl(text)) {
    return ctx.reply("Kripya valid https:// URL bhejein ya command likhein.");
  }

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
