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

const PORT = Number(process.env.PORT) || 3000;
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
      throw new Error(
        `File download fail (${res.status}): ${item.name || "file"}`
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const lowerName = (item.name || "").toLowerCase();
    const isPdf =
      item.mime === "application/pdf" ||
      lowerName.endsWith(".pdf") ||
      (bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46);

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

// Har Subject -> Unit ke alag Notes (text + files) aur Syllabus (text + files)
const studyStore = SUBJECTS.map(() =>
  DEFAULT_UNITS.map(() => ({
    notesText: "",
    noteFiles: [],
    syllabusText: "",
    syllabusFiles: [],
    lectures: [],
  }))
);

function getUnitData(subjIdx, unitIdx) {
  if (!studyStore[subjIdx]) studyStore[subjIdx] = [];
  if (!studyStore[subjIdx][unitIdx]) {
    studyStore[subjIdx][unitIdx] = {
      notesText: "",
      noteFiles: [],
      syllabusText: "",
      syllabusFiles: [],
      lectures: [],
    };
  }
  if (!Array.isArray(studyStore[subjIdx][unitIdx].noteFiles)) {
    studyStore[subjIdx][unitIdx].noteFiles = [];
  }
  if (!Array.isArray(studyStore[subjIdx][unitIdx].syllabusFiles)) {
    studyStore[subjIdx][unitIdx].syllabusFiles = [];
  }
  if (!Array.isArray(studyStore[subjIdx][unitIdx].lectures)) {
    studyStore[subjIdx][unitIdx].lectures = [];
  }
  return studyStore[subjIdx][unitIdx];
}

const sessions = new Map();

function createFreshSession() {
  return {
    mock: null,
    pendingMockSubject: null,
    activeSubj: 0,
    activeUnit: 0,
    uploadTargetType: "notes", // "notes" | "syllabus"
    awaitingLectureVideoFor: null,
    awaitingYoutubeFor: null,
    apkUrl: "",
    sourceZipUrl: "",
    websiteZipUrl: "",
    websiteUrl: "",
  };
}

function getSession(userId) {
  if (!userId) return createFreshSession();
  if (!sessions.has(userId)) {
    sessions.set(userId, createFreshSession());
  }
  const s = sessions.get(userId);
  if (!("mock" in s)) s.mock = null;
  if (!("pendingMockSubject" in s)) s.pendingMockSubject = null;
  if (!("activeSubj" in s)) s.activeSubj = 0;
  if (!("activeUnit" in s)) s.activeUnit = 0;
  if (!("uploadTargetType" in s)) s.uploadTargetType = "notes";
  if (!("awaitingLectureVideoFor" in s)) s.awaitingLectureVideoFor = null;
  if (!("awaitingYoutubeFor" in s)) s.awaitingYoutubeFor = null;
  return s;
}
async function replacePage(ctx, text, extra = {}) {
  try {
    const msgId = ctx.callbackQuery?.message?.message_id;
    if (msgId) {
      await ctx.deleteMessage(msgId).catch(() => {});
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
  const backIcon = isNotes ? "🔵" : "🟢";
  const rows = SUBJECTS.map((subj, idx) => [
    Markup.button.callback(`${icon} ${idx + 1}. ${subj}`, `${prefix}_${idx}`),
  ]);
  rows.push([Markup.button.callback(`${backIcon} Back to Menu`, "back_main")]);
  return Markup.inlineKeyboard(rows);
}

function unitButtonsKeyboard(prefix, subjIdx, isNotes = false) {
  const icon = isNotes ? "🔵" : "🟢";
  const rows = DEFAULT_UNITS.map((unitLabel, uIdx) => [
    Markup.button.callback(
      `${icon} ${unitLabel}`,
      `${prefix}_${subjIdx}_${uIdx}`
    ),
  ]);
  if (prefix === "notes_unit") {
    rows.push([
      Markup.button.callback(
        "🔵 Merge Active Unit Files -> 1 PDF",
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
  const userName = String(
    ctx.from?.first_name || ctx.from?.username || "Student"
  );
  const userId = String(ctx.from?.id || "N/A");

  return [
    "🌸 - STUDY BOT - 🌸",
    "",
    `👤 Hello, ${userName}!`,
    "",
    "📚 Complete study material, instant access.",
    "",
    "— 🔵 Notes (Subject & Unit • Multi-PDF/Photo -> 1 PDF)",
    "— 🟢 Syllabus (Subject & Unit-wise Admin Content)",
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

async function mergeAndSendUnitFiles(ctx, sIdx, uIdx, kind = "notes") {
  const isNotes = kind === "notes";
  const uData = getUnitData(sIdx, uIdx);
  const files = isNotes ? uData.noteFiles : uData.syllabusFiles;
  const icon = isNotes ? "🔵" : "🟢";
  const label = isNotes ? "Notes" : "Syllabus";

  if (!files.length) {
    return null;
  }

  await ctx.reply(
    `${icon} ${SUBJECTS[sIdx]} — ${DEFAULT_UNITS[uIdx]} ki ${files.length} ${label} files ek PDF mein merge ho rahi hain...`
  );

  const mergedBuf = await mergeFilesToSinglePdf(files);
  const safeSubj = SUBJECTS[sIdx].replace(/[^a-zA-Z0-9]+/g, "_");
  const safeUnit = DEFAULT_UNITS[uIdx].replace(/\s+/g, "_");
  const fileName = `${safeSubj}_${safeUnit}_${label}.pdf`;

  await ctx.replyWithDocument(
    { source: mergedBuf, filename: fileName },
    {
      caption: `${icon} ${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]}) — ${label} (${files.length} files merged into 1 PDF)`,
    }
  );
  return true;
}

async function deliverUnitNotes(ctx, sIdx, uIdx) {
  const uData = getUnitData(sIdx, uIdx);
  const mergedSent = await mergeAndSendUnitFiles(ctx, sIdx, uIdx, "notes");

  if (uData.notesText) {
    await ctx.reply(
      `🔵 Notes: ${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]})\n\n${uData.notesText}`,
      unitButtonsKeyboard("notes_unit", sIdx, true)
    );
    return;
  }

  if (mergedSent) {
    await ctx.reply(
      `🔵 ${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]}) — Aur unit chunein:`,
      unitButtonsKeyboard("notes_unit", sIdx, true)
    );
    return;
  }

  await replacePage(
    ctx,
    `🔵 Notes: ${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]})\n\nIs subject aur unit ke notes abhi admin ne add nahi kiye hain.`,
    unitButtonsKeyboard("notes_unit", sIdx, true)
  );
}

async function deliverUnitSyllabus(ctx, sIdx, uIdx) {
  const uData = getUnitData(sIdx, uIdx);
  const mergedSent = await mergeAndSendUnitFiles(ctx, sIdx, uIdx, "syllabus");

  if (uData.syllabusText) {
    await ctx.reply(
      `🟢 Syllabus: ${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]})\n\n${uData.syllabusText}`,
      unitButtonsKeyboard("syl_unit", sIdx, false)
    );
    return;
  }

  if (mergedSent) {
    await ctx.reply(
      `🟢 ${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]}) — Aur unit chunein:`,
      unitButtonsKeyboard("syl_unit", sIdx, false)
    );
    return;
  }

  await replacePage(
    ctx,
    `🟢 Syllabus: ${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]})\n\nIs subject aur unit ka syllabus abhi admin ne add nahi kiya hai.`,
    unitButtonsKeyboard("syl_unit", sIdx, false)
  );
}

async function handleAdminTextCommand(ctx, text) {
  if (text.startsWith("/start")) {
    if (ctx.from?.id) {
      sessions.set(ctx.from.id, createFreshSession());
    }
    await ctx.reply(buildStartMessage(ctx), inlineMenuKeyboard());
    return true;
  }

  if (text.startsWith("/reset")) {
    if (ctx.from?.id) {
      sessions.set(ctx.from.id, createFreshSession());
    }
    await ctx.reply(
      "STUDY BOT session reset ho gaya. Naye links ya files bhejein.",
      inlineMenuKeyboard()
    );
    return true;
  }

  if (text.startsWith("/status")) {
    const s = getSession(ctx.from?.id);
    const uData = getUnitData(s.activeSubj ?? 0, s.activeUnit ?? 0);
    await ctx.reply(
      [
        "STUDY BOT Session Status:",
        `• Active Subject: ${SUBJECTS[s.activeSubj ?? 0]}`,
        `• Active Unit: ${DEFAULT_UNITS[s.activeUnit ?? 0]}`,
        `• Upload Target Mode: ${s.uploadTargetType === "syllabus" ? "Syllabus" : "Notes"}`,
        `• Unit Note Files (PDF/Photo): ${uData.noteFiles.length}`,
        `• Unit Syllabus Files (PDF/Photo): ${uData.syllabusFiles.length}`,
        `• Unit Lectures Count: ${uData.lectures.length}`,
        `• APK URL: ${s.apkUrl || "Pending"}`,
        `• Source ZIP URL: ${s.sourceZipUrl || "Not provided"}`,
        `• Website ZIP URL: ${s.websiteZipUrl || "Not provided"}`,
        `• Website URL: ${s.websiteUrl || "Not provided"}`,
      ].join("\n"),
      inlineMenuKeyboard()
    );
    return true;
  }

  if (text.startsWith("/addnotes")) {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Sirf admin hi notes add kar sakta hai.");
      return true;
    }
    const payload = text.replace(/^\/addnotes\s*/i, "").trim();
    const parts = payload.split("|").map((p) => p.trim());
    if (parts.length < 2) {
      await ctx.reply(
        "Format: /addnotes <subj_1_to_6> | <unit_1_to_5> | <optional notes text>\n(Notes text na bhi likhein to target Subject+Unit set ho jayega aur aap jitni chahein PDF/Photo bhej sakte hain)"
      );
      return true;
    }
    try {
      const { sIdx, uIdx } = parseSubjAndUnit(parts[0], parts[1]);
      const noteBody = parts.slice(2).join(" | ").trim();
      const uData = getUnitData(sIdx, uIdx);
      if (noteBody) {
        uData.notesText = uData.notesText
          ? `${uData.notesText}\n\n${noteBody}`
          : noteBody;
      }

      const s = getSession(ctx.from?.id);
      s.activeSubj = sIdx;
      s.activeUnit = uIdx;
      s.uploadTargetType = "notes";

      await ctx.reply(
        `🔵 Active target set: ${SUBJECTS[sIdx]} — ${DEFAULT_UNITS[uIdx]} (Notes).\nAb is unit ke liye jitni chahein PDFs ya Photos bhejein; user ko sab ek merged PDF mein milengi.`
      );
    } catch (err) {
      await ctx.reply(`Add notes error: ${err.message}`);
    }
    return true;
  }

  if (text.startsWith("/addsyllabus")) {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Sirf admin hi syllabus add kar sakta hai.");
      return true;
    }
    const payload = text.replace(/^\/addsyllabus\s*/i, "").trim();
    const parts = payload.split("|").map((p) => p.trim());
    if (parts.length < 2) {
      await ctx.reply(
        "Format: /addsyllabus <subj_1_to_6> | <unit_1_to_5> | <optional syllabus text>"
      );
      return true;
    }
    try {
      const { sIdx, uIdx } = parseSubjAndUnit(parts[0], parts[1]);
      const sylBody = parts.slice(2).join(" | ").trim();
      const uData = getUnitData(sIdx, uIdx);
      if (sylBody) {
        uData.syllabusText = sylBody;
      }

      const s = getSession(ctx.from?.id);
      s.activeSubj = sIdx;
      s.activeUnit = uIdx;
      s.uploadTargetType = "syllabus";

      await ctx.reply(
        `🟢 Active target set: ${SUBJECTS[sIdx]} — ${DEFAULT_UNITS[uIdx]} (Syllabus).\nAb is unit ke liye syllabus text ya PDFs/Photos bhej sakte hain.`
      );
    } catch (err) {
      await ctx.reply(`Add syllabus error: ${err.message}`);
    }
    return true;
  }

  if (text.startsWith("/addlecture")) {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Sirf admin hi lecture add kar sakta hai.");
      return true;
    }
    const payload = text.replace(/^\/addlecture\s*/i, "");
    const parts = payload.split("|").map((p) => p.trim());
    if (parts.length < 3) {
      await ctx.reply(
        "Format: /addlecture <subj_1_to_6> | <unit_1_to_5> | <lecture title> | <optional youtube_url>"
      );
      return true;
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
          `Subject: ${SUBJECTS[sIdx]}`,
          `Unit: ${DEFAULT_UNITS[uIdx]}`,
          `Title: ${title}`,
          `YouTube: ${ytUrl || "Not set (abhi link bhej sakte hain)"}`,
          "",
          "Is lecture ka YouTube link ya video file bhejne ke liye neeche buttons use karein:",
        ].join("\n"),
        lectureDetailKeyboard(sIdx, uIdx, lecIdx)
      );
    } catch (err) {
      await ctx.reply(`Add lecture error: ${err.message}`);
    }
    return true;
  }

  if (text.startsWith("/mergenotes")) {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Sirf admin hi notes merge kar sakta hai.");
      return true;
    }
    const s = getSession(ctx.from?.id);
    const payload = text.replace(/^\/mergenotes\s*/i, "").trim();
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
      const sent = await mergeAndSendUnitFiles(ctx, sIdx, uIdx, "notes");
      if (!sent) {
        await ctx.reply(
          `🔵 ${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]}) mein merge karne ke liye koi file upload nahi hui hai.`
        );
      }
    } catch (err) {
      await ctx.reply(`Merge notes error: ${err.message}`);
    }
    return true;
  }

  if (text.startsWith("/mergesyllabus")) {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Sirf admin hi syllabus merge kar sakta hai.");
      return true;
    }
    const s = getSession(ctx.from?.id);
    const payload = text.replace(/^\/mergesyllabus\s*/i, "").trim();
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
      const sent = await mergeAndSendUnitFiles(ctx, sIdx, uIdx, "syllabus");
      if (!sent) {
        await ctx.reply(
          `🟢 ${SUBJECTS[sIdx]} (${DEFAULT_UNITS[uIdx]}) mein merge karne ke liye koi syllabus file upload nahi hui hai.`
        );
      }
    } catch (err) {
      await ctx.reply(`Merge syllabus error: ${err.message}`);
    }
    return true;
  }

  return false;
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
        `🟢 ${subjectName} — ${cfg.label}\nPractice questions ban rahe hain: ${Math.min(
          offset + currentBatch,
          cfg.count
        )} / ${cfg.count}...`
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
    await ctx.reply("⏱️ Time over! Aapka paper auto-submit ho raha hai.");
    return finishMockTest(ctx, s);
  }

  const qObj = m.questions[m.index];
  const qNum = m.index + 1;
  const remainingMins = Math.max(0, m.durationMins - elapsedMins);

  const text = [
    `🟢 ${m.subject}`,
    `📝 ${m.label} | MM: ${m.totalMarks} | Neg: -1/3 | Left: ~${remainingMins}m`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `Q${qNum} / ${m.questions.length} [${qObj.unit} • +${m.marksPerQ} / -1/3]:`,
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
    "🟢 EXAM PAPER RESULT SUMMARY",
    `📚 Subject: ${m.subject}`,
    `📋 Type: ${m.label}`,
    "━━━━━━━━━━━━━━━━━━━━",
    `🏆 Net Score: ${netMarks} / ${m.totalMarks}`,
    `➕ Positive Marks: +${positiveMarks.toFixed(2)}`,
    `➖ Negative Marks (-1/3): -${negativeMarks.toFixed(2)}`,
    `⏱️ Time Taken: ${mins}m ${secs}s (Limit: ${m.timeLabel})`,
    `✅ Sahi (Correct): ${correctCount}`,
    `❌ Galat (Wrong): ${wrongCount}`,
    `⏭️ Chhode (Skipped): ${skippedCount}`,
    `📊 Total Questions: ${m.questions.length}`,
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "Question-wise Answer Key & Review:",
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
async function handleCallbackData(ctx, data) {
  await ctx.answerCbQuery().catch(() => {});
  const s = getSession(ctx.from?.id);

  if (data === "back_main") {
    await replacePage(ctx, buildStartMessage(ctx), inlineMenuKeyboard());
    return true;
  }

  if (data === "menu_notes") {
    s.uploadTargetType = "notes";
    await replacePage(
      ctx,
      "🔵 Notes — Subject Chunein:",
      subjectButtonsKeyboard("notes_subj", true)
    );
    return true;
  }

  if (data === "menu_syllabus") {
    s.uploadTargetType = "syllabus";
    await replacePage(
      ctx,
      "🟢 Syllabus — Subject Chunein:",
      subjectButtonsKeyboard("syl_subj", false)
    );
    return true;
  }

  if (data === "menu_lecture") {
    await replacePage(
      ctx,
      "🟢 Lecture — Subject Chunein:",
      subjectButtonsKeyboard("lec_subj", false)
    );
    return true;
  }

  if (data === "menu_pyq") {
    await replacePage(
      ctx,
      "🟢 PYQ (Pehle Exam Mein Aaye Hue Questions) — Subject Chunein:",
      subjectButtonsKeyboard("pyq_subj", false)
    );
    return true;
  }

  if (data === "menu_mock") {
    await replacePage(
      ctx,
      "🟢 Mock Test — Subject Chunein:",
      subjectButtonsKeyboard("mock_subj", false)
    );
    return true;
  }

  if (data.startsWith("notes_subj_")) {
    const i = Number(data.replace("notes_subj_", ""));
    const subjectName = SUBJECTS[i];
    if (!subjectName) return true;
    s.activeSubj = i;
    s.uploadTargetType = "notes";
    await replacePage(
      ctx,
      `🔵 Notes: ${subjectName}\nUnit chunein:`,
      unitButtonsKeyboard("notes_unit", i, true)
    );
    return true;
  }

  if (data.startsWith("merge_notes_btn_")) {
    const i = Number(data.replace("merge_notes_btn_", ""));
    try {
      const sent = await mergeAndSendUnitFiles(
        ctx,
        i,
        s.activeUnit ?? 0,
        "notes"
      );
      if (!sent) {
        await ctx.reply(
          `🔵 ${SUBJECTS[i]} (${DEFAULT_UNITS[s.activeUnit ?? 0]}) mein merge karne ke liye koi file upload nahi hui hai.`
        );
      }
    } catch (err) {
      await ctx.reply(`Merge error: ${err.message}`);
    }
    return true;
  }

  if (data.startsWith("syl_subj_")) {
    const i = Number(data.replace("syl_subj_", ""));
    const subjectName = SUBJECTS[i];
    if (!subjectName) return true;
    s.activeSubj = i;
    s.uploadTargetType = "syllabus";
    await replacePage(
      ctx,
      `🟢 Syllabus: ${subjectName}\nUnit chunein:`,
      unitButtonsKeyboard("syl_unit", i, false)
    );
    return true;
  }

  if (data.startsWith("lec_subj_")) {
    const i = Number(data.replace("lec_subj_", ""));
    const subjectName = SUBJECTS[i];
    if (!subjectName) return true;
    s.activeSubj = i;
    await replacePage(
      ctx,
      `🟢 Lecture: ${subjectName}\nUnit chunein:`,
      unitButtonsKeyboard("lec_unit", i, false)
    );
    return true;
  }

  if (data.startsWith("pyq_subj_")) {
    const i = Number(data.replace("pyq_subj_", ""));
    const subjectName = SUBJECTS[i];
    if (!subjectName) return true;
    try {
      await replacePage(
        ctx,
        `🟢 ${subjectName} ke pehle exam mein aaye hue PYQs nikaale ja rahe hain...`
      );
      const aiText = await askGemini(
        [
          `List ONLY authentic past examination questions (PYQs) that have previously appeared in exams for "${subjectName}".`,
          `Do NOT invent fresh hypothetical mock questions; present established past exam questions with their exam/year context (if known), clear answer, and short explanation.`,
        ].join("\n")
      );
      await replacePage(
        ctx,
        `🟢 Past Exam PYQs: ${subjectName}\n\n${aiText}`,
        subjectButtonsKeyboard("pyq_subj", false)
      );
    } catch (err) {
      await replacePage(
        ctx,
        `PYQ error: ${err.message}`,
        subjectButtonsKeyboard("pyq_subj", false)
      );
    }
    return true;
  }

  if (data.startsWith("notes_unit_")) {
    const [, , iStr, uStr] = data.split("_");
    const i = Number(iStr);
    const u = Number(uStr);
    if (!SUBJECTS[i] || !DEFAULT_UNITS[u]) return true;

    s.activeSubj = i;
    s.activeUnit = u;
    s.uploadTargetType = "notes";

    try {
      await deliverUnitNotes(ctx, i, u);
    } catch (err) {
      await replacePage(
        ctx,
        `🔵 Notes error: ${err.message}`,
        unitButtonsKeyboard("notes_unit", i, true)
      );
    }
    return true;
  }

  if (data.startsWith("syl_unit_")) {
    const [, , iStr, uStr] = data.split("_");
    const i = Number(iStr);
    const u = Number(uStr);
    if (!SUBJECTS[i] || !DEFAULT_UNITS[u]) return true;

    s.activeSubj = i;
    s.activeUnit = u;
    s.uploadTargetType = "syllabus";

    try {
      await deliverUnitSyllabus(ctx, i, u);
    } catch (err) {
      await replacePage(
        ctx,
        `🟢 Syllabus error: ${err.message}`,
        unitButtonsKeyboard("syl_unit", i, false)
      );
    }
    return true;
  }

  if (data.startsWith("lec_unit_")) {
    const [, , iStr, uStr] = data.split("_");
    const i = Number(iStr);
    const u = Number(uStr);
    const subjectName = SUBJECTS[i];
    const unitLabel = DEFAULT_UNITS[u];
    if (!subjectName || !unitLabel) return true;

    s.activeSubj = i;
    s.activeUnit = u;
    const uData = getUnitData(i, u);
    const count = uData.lectures.length;
    const text =
      count > 0
        ? `🟢 Lectures: ${subjectName} (${unitLabel})\nKul Lectures: ${count}\n\nKisi lecture par tap karein:`
        : `🟢 Lectures: ${subjectName} (${unitLabel})\nIs unit mein abhi koi lecture add nahi hua hai.\nAdmin /addlecture ${i + 1} | ${u + 1} | <Title> | <YouTube_URL> se add kar sakta hai.`;

    await replacePage(ctx, text, lectureListKeyboard(i, u));
    return true;
  }

  if (data.startsWith("open_lec_")) {
    const [, , iStr, uStr, lStr] = data.split("_");
    const i = Number(iStr);
    const u = Number(uStr);
    const l = Number(lStr);
    const uData = getUnitData(i, u);
    const lec = uData.lectures[l];
    if (!lec) return true;

    if (lec.videoFileId) {
      await ctx.replyWithVideo(lec.videoFileId, {
        caption: `🟢 ${lec.title}\nSubject: ${SUBJECTS[i]} • ${DEFAULT_UNITS[u]}${
          lec.youtubeUrl ? `\nYouTube: ${lec.youtubeUrl}` : ""
        }`,
        ...lectureDetailKeyboard(i, u, l),
      });
      return true;
    }

    const msg = [
      `🟢 ${lec.title}`,
      `Subject: ${SUBJECTS[i]}`,
      `Unit: ${DEFAULT_UNITS[u]}`,
      `YouTube Link: ${lec.youtubeUrl || "Not provided"}`,
      `Uploaded Video: ${lec.videoFileId ? "Available" : "Not uploaded"}`,
    ].join("\n");

    await replacePage(ctx, msg, lectureDetailKeyboard(i, u, l));
    return true;
  }

  if (data.startsWith("set_yt_")) {
    const [, , iStr, uStr, lStr] = data.split("_");
    const i = Number(iStr);
    const u = Number(uStr);
    const l = Number(lStr);
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Sirf admin hi YouTube link set kar sakta hai.");
      return true;
    }
    s.awaitingYoutubeFor = { subjIdx: i, unitIdx: u, lecIdx: l };
    s.awaitingLectureVideoFor = null;
    await ctx.reply(
      `🟢 ${getUnitData(i, u).lectures[l]?.title || "Lecture"} ke liye YouTube link bhejein:`
    );
    return true;
  }

  if (data.startsWith("set_vid_")) {
    const [, , iStr, uStr, lStr] = data.split("_");
    const i = Number(iStr);
    const u = Number(uStr);
    const l = Number(lStr);
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Sirf admin hi video upload kar sakta hai.");
      return true;
    }
    s.awaitingLectureVideoFor = { subjIdx: i, unitIdx: u, lecIdx: l };
    s.awaitingYoutubeFor = null;
    await ctx.reply(
      `🟢 ${getUnitData(i, u).lectures[l]?.title || "Lecture"} ke liye video file bhejein:`
    );
    return true;
  }

  if (data.startsWith("mock_subj_")) {
    const i = Number(data.replace("mock_subj_", ""));
    const subjectName = SUBJECTS[i];
    if (!subjectName) return true;
    s.pendingMockSubject = i;
    await replacePage(
      ctx,
      [
        `🟢 Mock Test — ${subjectName}`,
        "",
        "Apna exam paper chunein:",
        "• Short Test (Unit-wise): 40 Questions • 40 Marks • -1/3 Negative • 1 Hour",
        "• Full Course Test: 80 Questions • 80 Marks • -1/3 Negative • 3 Hours",
      ].join("\n"),
      mockModeKeyboard(i)
    );
    return true;
  }

  if (data.startsWith("mock_mode_")) {
    const parts = data.split("_");
    const i = Number(parts[2]);
    const modeKey = parts[3];
    const subjectName = SUBJECTS[i];
    const cfg = MOCK_CONFIGS[modeKey];
    if (!subjectName || !cfg) return true;

    try {
      await replacePage(
        ctx,
        `🟢 ${subjectName} ke liye ${cfg.label} (${cfg.count} Q • ${cfg.totalMarks}M • -1/3 • ${cfg.timeLabel}) ban raha hai...`
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
    return true;
  }

  if (data.startsWith("mock_ans_")) {
    const parts = data.split("_");
    const qIdx = Number(parts[2]);
    const opt = parts[3];
    if (!s.mock || s.mock.index !== qIdx) return true;

    s.mock.answers[qIdx] = opt;
    s.mock.index += 1;

    if (s.mock.index < s.mock.questions.length) {
      await sendMockQuestion(ctx, s);
    } else {
      await finishMockTest(ctx, s);
    }
    return true;
  }

  if (data.startsWith("mock_submit_")) {
    if (!s.mock) return true;
    await finishMockTest(ctx, s);
    return true;
  }

  return false;
}
async function handleBuildCommand(ctx, text) {
  const s = getSession(ctx.from?.id);

  if (text.startsWith("/source")) {
    if (!s.apkUrl) {
      await ctx.reply(
        "Pehle .apk file ka direct https:// link bhejein, phir /source likhein."
      );
      return true;
    }
    const tagName = `source-${ctx.from?.id || "user"}-${Date.now()}`;
    await ctx.reply(
      "STUDY BOT APK source code extraction trigger kiya ja raha hai..."
    );
    try {
      await dispatchWorkflow(SOURCE_WORKFLOW_FILE, {
        apk_url: s.apkUrl,
        tag_name: tagName,
      });
      await ctx.reply(
        [
          "Source extraction workflow trigger ho gaya!",
          `Tag: ${tagName}`,
          "GitHub Releases mein apk-source-code.zip banne ke baad uska link bhej kar /mergebuild use karein.",
        ].join("\n")
      );
    } catch (err) {
      await ctx.reply(`Source error: ${err.message}`);
    }
    return true;
  }

  if (text.startsWith("/mergebuild")) {
    if (!s.sourceZipUrl) {
      await ctx.reply("Pehle extracted source code ZIP ka https:// link bhejein.");
      return true;
    }
    if (!s.websiteZipUrl) {
      await ctx.reply(
        "Pehle website panel ki .zip file ya https:// link bhejein."
      );
      return true;
    }
    const tagName = `merged-${ctx.from?.id || "user"}-${Date.now()}`;
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
          "GitHub Releases mein merged-panel-app.apk banne ke baad download kar lein.",
        ].join("\n")
      );
    } catch (err) {
      await ctx.reply(`Merge build error: ${err.message}`);
    }
    return true;
  }

  if (text.startsWith("/build")) {
    if (!s.apkUrl) {
      await ctx.reply("Pehle base .apk ka direct https:// link bhejein.");
      return true;
    }
    if (!s.websiteUrl && !s.websiteZipUrl) {
      await ctx.reply("Pehle Website URL ya Website ZIP link/file bhejein.");
      return true;
    }
    const tagName = `build-${ctx.from?.id || "user"}-${Date.now()}`;
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
      await ctx.reply(`Build trigger fail hua:\n${err.message}`);
    }
    return true;
  }

  return false;
}

bot.catch(async (err, ctx) => {
  console.error("TELEGRAF_UNHANDLED_ERROR:", err);
  try {
    if (ctx && typeof ctx.reply === "function") {
      await ctx.reply(`STUDY BOT error: ${err?.message || "Unknown error"}`);
    }
  } catch (_) {}
});

bot.use(async (ctx, next) => {
  if (ctx.callbackQuery?.data) {
    const handled = await handleCallbackData(ctx, ctx.callbackQuery.data);
    if (handled) return;
  }

  const msg = ctx.message;
  if (!msg) return next();

  const s = getSession(ctx.from?.id);
  const sIdx = s.activeSubj ?? 0;
  const uIdx = s.activeUnit ?? 0;

  if (Array.isArray(msg.photo) && msg.photo.length > 0 && isAdmin(ctx.from?.id)) {
    try {
      const largest = msg.photo[msg.photo.length - 1];
      const fileLink = await ctx.telegram.getFileLink(largest.file_id);
      const uData = getUnitData(sIdx, uIdx);
      const isSyl = s.uploadTargetType === "syllabus";
      const list = isSyl ? uData.syllabusFiles : uData.noteFiles;
      const icon = isSyl ? "🟢" : "🔵";
      const label = isSyl ? "Syllabus" : "Notes";

      list.push({
        name: `photo_${Date.now()}.jpg`,
        url: fileLink.href,
        mime: "image/jpeg",
      });

      await ctx.reply(
        `${icon} Photo ${label} mein add ho gayi!\nSubject: ${SUBJECTS[sIdx]} • ${DEFAULT_UNITS[uIdx]}\nTotal ${label} files in unit: ${list.length}`
      );
    } catch (err) {
      await ctx.reply(`Photo error: ${err.message}`);
    }
    return;
  }

  if (msg.video && isAdmin(ctx.from?.id)) {
    const target = s.awaitingLectureVideoFor;
    if (!target) {
      await ctx.reply(
        "Kisi lecture par tap karke 'Upload / Update Video' chunein, phir video bhejein."
      );
      return;
    }
    const uData = getUnitData(target.subjIdx, target.unitIdx);
    const lec = uData.lectures[target.lecIdx];
    if (!lec) {
      await ctx.reply("Lecture nahi mila.");
      return;
    }
    lec.videoFileId = msg.video.file_id;
    s.awaitingLectureVideoFor = null;
    await ctx.reply(
      `🟢 Lecture "${lec.title}" ka video update ho gaya!`,
      lectureDetailKeyboard(target.subjIdx, target.unitIdx, target.lecIdx)
    );
    return;
  }

  if (msg.document) {
    const doc = msg.document;
    const fileName = (doc.file_name || "").toLowerCase();

    if (s.awaitingLectureVideoFor && isAdmin(ctx.from?.id)) {
      const target = s.awaitingLectureVideoFor;
      const uData = getUnitData(target.subjIdx, target.unitIdx);
      const lec = uData.lectures[target.lecIdx];
      if (lec) {
        lec.videoFileId = doc.file_id;
        s.awaitingLectureVideoFor = null;
        await ctx.reply(
          `🟢 Lecture "${lec.title}" ka video file update ho gaya!`,
          lectureDetailKeyboard(target.subjIdx, target.unitIdx, target.lecIdx)
        );
        return;
      }
    }

    if (fileName.endsWith(".pdf") && isAdmin(ctx.from?.id)) {
      try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const uData = getUnitData(sIdx, uIdx);
        const isSyl = s.uploadTargetType === "syllabus";
        const list = isSyl ? uData.syllabusFiles : uData.noteFiles;
        const icon = isSyl ? "🟢" : "🔵";
        const label = isSyl ? "Syllabus" : "Notes";

        list.push({
          name: doc.file_name || `file_${Date.now()}.pdf`,
          url: fileLink.href,
          mime: "application/pdf",
        });

        await ctx.reply(
          `${icon} PDF "${doc.file_name}" ${label} mein add ho gayi!\nSubject: ${SUBJECTS[sIdx]} • ${DEFAULT_UNITS[uIdx]}\nTotal ${label} files in unit: ${list.length}`
        );
      } catch (err) {
        await ctx.reply(`PDF upload error: ${err.message}`);
      }
      return;
    }

    if ((doc.file_size || 0) > 20 * 1024 * 1024) {
      await ctx.reply(
        "Telegram bot 20 MB se badi file direct download nahi kar sakta. Kripya 1 GB tak ki file ka direct https:// download link bhejein."
      );
      return;
    }

    if (!fileName.endsWith(".zip")) {
      await ctx.reply(
        "Badi .apk file ka direct https:// link bhejein, ya chhoti .zip file bhejein."
      );
      return;
    }

    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      if (fileName.includes("source")) {
        s.sourceZipUrl = fileLink.href;
        await ctx.reply(
          "Source ZIP link STUDY BOT session mein save ho gaya. Ab website panel ZIP/link bhej kar /mergebuild likhein."
        );
        return;
      }
      s.websiteZipUrl = fileLink.href;
      await ctx.reply(
        "Website ZIP link STUDY BOT session mein save ho gaya. Ab /build ya /mergebuild likhein."
      );
    } catch (err) {
      await ctx.reply(`ZIP link error: ${err.message}`);
    }
    return;
  }

  if (typeof msg.text === "string") {
    const text = msg.text.trim();
    if (!text) return;

    if (text.startsWith("/")) {
      const cmdHandled = await handleAdminTextCommand(ctx, text);
      if (cmdHandled) return;
      const buildHandled = await handleBuildCommand(ctx, text);
      if (buildHandled) return;
      return;
    }

    if (s.awaitingYoutubeFor && isAdmin(ctx.from?.id)) {
      if (!isHttpUrl(text)) {
        await ctx.reply("Kripya valid YouTube https:// link bhejein.");
        return;
      }
      const target = s.awaitingYoutubeFor;
      const uData = getUnitData(target.subjIdx, target.unitIdx);
      const lec = uData.lectures[target.lecIdx];
      if (lec) {
        lec.youtubeUrl = text;
        s.awaitingYoutubeFor = null;
        await ctx.reply(
          `🟢 Lecture "${lec.title}" ka YouTube link update ho gaya:\n${text}`,
          lectureDetailKeyboard(target.subjIdx, target.unitIdx, target.lecIdx)
        );
        return;
      }
    }

    if (!isHttpUrl(text)) {
      await ctx.reply("Kripya valid https:// URL bhejein ya command likhein.");
      return;
    }

    const lower = text.toLowerCase();
    const sizeBytes = await checkRemoteFileSize(text);
    if (sizeBytes !== null && sizeBytes > MAX_FILE_BYTES) {
      await ctx.reply(
        `File size ${formatMB(sizeBytes)} hai, jo 1024 MB (1 GB) limit se zyada hai.`
      );
      return;
    }

    if (lower.includes(".apk")) {
      s.apkUrl = text;
      const sizeText = sizeBytes ? ` (${formatMB(sizeBytes)})` : "";
      await ctx.reply(
        `Base APK URL save ho gaya${sizeText}.\nAb /source se source code nikal sakte hain, ya Website URL/ZIP bhej kar /build likh sakte hain.`
      );
      return;
    }

    if (lower.includes(".zip")) {
      const sizeText = sizeBytes ? ` (${formatMB(sizeBytes)})` : "";
      if (lower.includes("source") || lower.includes("apk-source")) {
        s.sourceZipUrl = text;
        await ctx.reply(
          `Source ZIP URL save ho gaya${sizeText}.\nAb website panel ZIP link bhej kar /mergebuild likhein.`
        );
        return;
      }
      s.websiteZipUrl = text;
      await ctx.reply(
        `Website ZIP URL save ho gaya${sizeText}.\nAb /build ya /mergebuild likhein.`
      );
      return;
    }

    s.websiteUrl = text;
    await ctx.reply(
      `Website URL save ho gaya:\n${text}\n\nAb /build likhein (agar APK URL bhi save kar chuke hain).`
    );
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
