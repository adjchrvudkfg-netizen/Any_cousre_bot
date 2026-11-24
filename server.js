const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const TELEGRAM_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : "";
const TELEGRAM_FILE_API = BOT_TOKEN ? `https://api.telegram.org/file/bot${BOT_TOKEN}` : "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const DB_FILE = path.join(__dirname, "study_material_db.json");
const activeTests = {};
const aiChatSessions = {};
const pendingNotesUpload = {};
const DEFAULT_CATEGORIES = {
  Pharmacy: ["B.Pharma", "D.Pharma"],
  Engineering: ["B.Tech", "Diploma"],
  Programming: ["Python", "JavaScript", "Java"]
};

const DEFAULT_YEARS = {
  "Pharmacy|B.Pharma": ["1st Year", "2nd Year", "3rd Year", "4th Year"],
  "Pharmacy|D.Pharma": ["1st Year", "2nd Year"],
  "Engineering|B.Tech": ["1st Year", "2nd Year", "3rd Year", "4th Year"],
  "Engineering|Diploma": ["1st Year", "2nd Year", "3rd Year"],
  "Programming|Python": ["1st Year"],
  "Programming|JavaScript": ["1st Year"],
  "Programming|Java": ["1st Year"]
};

const DEFAULT_SEMESTERS = {
  "Pharmacy|B.Pharma|1st Year": ["Semester 1", "Semester 2"],
  "Pharmacy|B.Pharma|2nd Year": ["Semester 3", "Semester 4"],
  "Pharmacy|B.Pharma|3rd Year": ["Semester 5", "Semester 6"],
  "Pharmacy|B.Pharma|4th Year": ["Semester 7", "Semester 8"],
  "Pharmacy|D.Pharma|1st Year": ["Year 1 Syllabus"],
  "Pharmacy|D.Pharma|2nd Year": ["Year 2 Syllabus"],
  "Engineering|B.Tech|1st Year": ["Semester 1", "Semester 2"],
  "Engineering|B.Tech|2nd Year": ["Semester 3", "Semester 4"],
  "Engineering|B.Tech|3rd Year": ["Semester 5", "Semester 6"],
  "Engineering|B.Tech|4th Year": ["Semester 7", "Semester 8"],
  "Engineering|Diploma|1st Year": ["Semester 1", "Semester 2"],
  "Engineering|Diploma|2nd Year": ["Semester 3", "Semester 4"],
  "Engineering|Diploma|3rd Year": ["Semester 5", "Semester 6"],
  "Programming|Python|1st Year": ["Semester 1"],
  "Programming|JavaScript|1st Year": ["Semester 1"],
  "Programming|Java|1st Year": ["Semester 1"]
};

let db = {
  categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
  customYears: JSON.parse(JSON.stringify(DEFAULT_YEARS)),
  customSemesters: JSON.parse(JSON.stringify(DEFAULT_SEMESTERS)),
  topics: {},
  handwrittenNotes: {},
  users: {}
};

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      db.categories = raw.categories && Object.keys(raw.categories).length
        ? raw.categories
        : JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
      db.customYears = raw.customYears || JSON.parse(JSON.stringify(DEFAULT_YEARS));
      db.customSemesters = raw.customSemesters || JSON.parse(JSON.stringify(DEFAULT_SEMESTERS));
      db.topics = raw.topics || {};
      db.handwrittenNotes = raw.handwrittenNotes || {};
      db.users = raw.users || {};
    } else {
      persistAll();
    }
  } catch (e) {
    console.error("DB Load Error:", e.message);
  }
}

function persistAll() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("DB Save Error:", e.message);
  }
}

loadDb();
function isAdmin(userId) {
  if (!ADMIN_IDS.length) return true;
  return ADMIN_IDS.includes(String(userId));
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Blue / Green button helper (supports style if client accepts it + clean label)
function makeBtn(text, callbackData, tone = "green") {
  const btn = { text, callback_data: callbackData };
  if (tone === "blue") {
    btn.style = "primary";
  } else if (tone === "green") {
    btn.style = "success";
  }
  return btn;
}

function getUser(chatId) {
  const key = String(chatId);
  if (!db.users[key]) {
    db.users[key] = {
      selectedCategory: null,
      selectedCourse: null,
      selectedYear: null,
      selectedSemester: null,
      selectedSubject: null,
      selectedUnit: null,
      selectedFeature: null,
      lastMessageId: null
    };
  }
  return db.users[key];
}

function getCategoryList() {
  return Object.keys(db.categories || {});
}

function getCoursesForCategory(catName) {
  return (db.categories && db.categories[catName]) || [];
}

function getYearsForCourse(catName, courseName) {
  return db.customYears[`${catName}|${courseName}`] || ["1st Year", "2nd Year"];
}

function getSemestersForYear(catName, courseName, yearName) {
  return db.customSemesters[`${catName}|${courseName}|${yearName}`] || ["Semester 1", "Semester 2"];
}

async function sendTelegramMessage(chatId, text, extra = {}) {
  if (!TELEGRAM_API) return null;
  try {
    const res = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...extra
    });
    return res.data?.result || null;
  } catch (err) {
    console.error("SendMessage Error:", err.response?.data || err.message);
    return null;
  }
}

async function deletePrevMessage(chatId, user) {
  if (!TELEGRAM_API || !user?.lastMessageId) return;
  try {
    await axios.post(`${TELEGRAM_API}/deleteMessage`, {
      chat_id: chatId,
      message_id: user.lastMessageId
    });
  } catch (_) {}
  user.lastMessageId = null;
}

async function sendLongMessage(chatId, text, extra = {}) {
  const MAX_LEN = 3800;
  const cleanText = String(text || "");
  for (let i = 0; i < cleanText.length; i += MAX_LEN) {
    const chunk = cleanText.slice(i, i + MAX_LEN);
    const isLast = i + MAX_LEN >= cleanText.length;
    await sendTelegramMessage(chatId, chunk, isLast ? extra : {});
  }
}
async function askGemini(partsArray, useGoogleSearch = true, temperature = 0.35) {
  if (!GEMINI_API_KEY) {
    return "⚠️ Server par GEMINI_API_KEY set nahi hai. Render Environment Variables mein GEMINI_API_KEY add karein.";
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: partsArray
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: 4096
    }
  };

  if (useGoogleSearch) {
    payload.tools = [{ googleSearch: {} }];
  }

  try {
    const res = await axios.post(GEMINI_URL, payload, { timeout: 60000 });
    const candParts = res.data?.candidates?.[0]?.content?.parts || [];
    const output = candParts.map((p) => p.text || "").join("\n").trim();
    return output || "⚠️ Response generate nahi ho paya. Dobara try karein.";
  } catch (err) {
    console.error("Gemini API Error:", err.response?.data || err.message);
    return "⚠️ AI service temporarily unavailable hai. Thodi der baad try karein.";
  }
}

// Admin ke photo/image se saara text nikal kar structured notes banana (sirf text output)
async function extractStructuredNotesFromImage(fileBuffer, mimeType, meta) {
  const base64Data = fileBuffer.toString("base64");
  const prompt = `Is image/photo mein jo bhi likha hua hai uska ek-ek word padh kar poora text structured notes mein badlo.
Course: ${meta.course} | Year: ${meta.year} | Semester: ${meta.sem} | Subject: ${meta.subject} | Unit: ${meta.unit}

Strict Format Rules (sirf isi format mein likho):
${meta.unit} - ${meta.subject}

Main Heading
Heading - Definition (agar definition hai to definition likho, warna clear points likho)

Rules:
- Photo mein jitna bhi matter/text likha hai usme se kuch bhi miss mat karo.
- Koi image ya link mat do, sirf clean text notes do.`;

  return askGemini(
    [
      { inlineData: { mimeType: mimeType || "image/jpeg", data: base64Data } },
      { text: prompt }
    ],
    false,
    0.2
  );
}
// PYQ: Sirf pichhle saalon mein aaye hue asli questions
async function generatePastPYQs(course, year, sem, subject, unit) {
  const prompt = `Google Search ka use karke sirf pichhle saalon (Previous Years) ke exam papers mein pehle se aaye hue asli questions (PYQs) nikalo. Naye banaya hua koi question mat add karna:

Course: ${course}
Year: ${year}
Semester: ${sem}
Subject: ${subject}
Unit: ${unit}

Format:
1. 2 Marks Questions (Previous Year Asked)
2. 5 Marks Questions (Previous Year Asked — saal/frequency agar mile to likho)
3. 10 Marks Long Questions (Previous Year Asked)
Har question ke saath uska short/clear exam answer bhi do.`;

  return askGemini([{ text: prompt }], true, 0.25);
}

// Mock Test: Har baar bilkul naye questions (Full Course vs Single Unit)
async function generateFreshMockPaper(mode, course, year, sem, subject, unit) {
  const isFull = mode === "full";
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const prompt = isFull
    ? `Tum ek exam paper setter ho. Seed [${nonce}] ke basis par FULL SYLLABUS ke liye bilkul NAYE questions ka Mock Test Paper banao (pichhle test se repeat mat karna):

Course: ${course}
Year: ${year}
Semester: ${sem}
Subject: ${subject}
Total Marks: 75 | Time Allowed: 3 Hours (180 Minutes)

- Section A: 10 MCQs (2 Marks each = 20 Marks) from all units with options A, B, C, D.
- Section B: 3 Long Questions (Attempt any 2, 10 Marks each = 20 Marks).
- Section C: 9 Short Questions (Attempt any 7, 5 Marks each = 35 Marks).

Answer key abhi mat likhna.`
    : `Tum ek exam paper setter ho. Seed [${nonce}] ke basis par ONLY ONE UNIT ke liye bilkul NAYE questions ka Mock Test Paper banao:

Course: ${course}
Year: ${year}
Semester: ${sem}
Subject: ${subject}
Unit: ${unit}
Total Marks: 30 | Time Allowed: 1 Hour (60 Minutes)

- Section A: 5 MCQs (1 Mark each = 5 Marks) from ${unit} with options A, B, C, D.
- Section B: 2 Long Questions (Attempt any 1, 10 Marks).
- Section C: 4 Short Questions (Attempt any 3, 5 Marks each = 15 Marks).

Answer key abhi mat likhna.`;

  return askGemini([{ text: prompt }], true, 0.75);
}

// AI Assistant: Jo pucha jaye uska jawab
async function askAiAssistant(chatId, userQuestion, user) {
  if (!aiChatSessions[chatId]) aiChatSessions[chatId] = [];
  aiChatSessions[chatId].push(`Student: ${userQuestion}`);
  if (aiChatSessions[chatId].length > 8) {
    aiChatSessions[chatId] = aiChatSessions[chatId].slice(-8);
  }

  const contextStr = user.selectedCourse
    ? `Context: ${user.selectedCourse} | ${user.selectedYear || ""} | ${user.selectedSemester || ""} | ${user.selectedSubject || ""}\n`
    : "";

  const prompt = `${contextStr}A student is asking a question in a study bot. Give a clear, accurate, and helpful answer:\n\n${aiChatSessions[chatId].join("\n")}`;
  const reply = await askGemini([{ text: prompt }], true, 0.4);
  aiChatSessions[chatId].push(`Assistant: ${reply}`);
  return reply;
}

// Links: Google se Admit Card aur Result ke links
async function fetchOfficialLinks(course, year, sem) {
  const queryText = [course, year, sem].filter(Boolean).join(" ");
  const prompt = `Google Search ka use karke "${queryText || "university exam"}" ke Admit Card aur Result check karne ke official/authentic web links aur portal names dhundho.
Har link ke saath batayein ki wo kis kaam ke liye hai (Admit Card ya Result) aur students use kaise check kar sakte hain.`;

  return askGemini([{ text: prompt }], true, 0.2);
}
async function startMockTest(chatId, mode, course, year, sem, subject, unit) {
  if (activeTests[chatId]?.timer) {
    clearTimeout(activeTests[chatId].timer);
  }

  const isFull = mode === "full";
  const durationMinutes = isFull ? 180 : 60;
  const totalMarks = isFull ? 75 : 30;
  const scopeLabel = isFull ? "Full Course (All Units)" : `Single Unit (${unit})`;

  await sendTelegramMessage(
    chatId,
    `🎯 <b>Mock Test Ban Raha Hai...</b>\n` +
      `📘 <b>Subject:</b> ${escapeHtml(subject)}\n` +
      `📚 <b>Scope:</b> ${escapeHtml(scopeLabel)}\n` +
      `📝 <b>Marks:</b> ${totalMarks} | ⏱️ <b>Time:</b> ${durationMinutes} Minutes`
  );

  const paper = await generateFreshMockPaper(mode, course, year, sem, subject, unit);
  const endTime = Date.now() + durationMinutes * 60 * 1000;

  const timer = setTimeout(async () => {
    if (activeTests[chatId]) {
      await finishMockTest(chatId, true);
    }
  }, durationMinutes * 60 * 1000);

  activeTests[chatId] = {
    paper,
    mode,
    course,
    year,
    sem,
    subject,
    unit: isFull ? "Full Course" : unit,
    totalMarks,
    durationMinutes,
    endTime,
    timer
  };

  await sendLongMessage(
    chatId,
    `📝 <b>MOCK TEST STARTED</b>\n` +
      `📘 <b>${escapeHtml(subject)}</b> (${escapeHtml(scopeLabel)})\n` +
      `💯 <b>Full Marks:</b> ${totalMarks} | ⏱️ <b>Time:</b> ${durationMinutes} Minutes\n\n` +
      `${escapeHtml(paper)}\n\n` +
      `Apne answers likh kar bhejein ya neeche button dabayein:`,
    {
      reply_markup: {
        inline_keyboard: [
          [makeBtn("⏱️ Remaining Time", "mock_time_left", "green")],
          [makeBtn("✅ Submit Test & Answers", "mock_submit", "green")]
        ]
      }
    }
  );
}

async function finishMockTest(chatId, isAutoTimeUp = false) {
  const session = activeTests[chatId];
  if (!session) {
    await sendTelegramMessage(chatId, "⚠️ Abhi koi active Mock Test nahi chal raha hai.");
    return;
  }

  clearTimeout(session.timer);
  delete activeTests[chatId];

  const header = isAutoTimeUp
    ? "⏰ <b>TIME OVER!</b> Test automatically submit ho gaya hai.\n\n"
    : "✅ <b>TEST SUBMITTED!</b>\n\n";

  const ansPrompt = `Niche diye gaye Mock Test paper ki complete Answer Key aur solutions likho:\n\n${session.paper}`;
  const solutions = await askGemini([{ text: ansPrompt }], false, 0.25);

  await sendLongMessage(
    chatId,
    `${header}📊 <b>ANSWER KEY (${escapeHtml(session.subject)} — ${escapeHtml(session.unit)}):</b>\n\n${escapeHtml(solutions)}`,
    {
      reply_markup: {
        inline_keyboard: [[makeBtn("🔙 Main Menu", "main_menu", "green")]]
      }
    }
  );
}
async function showStartDashboard(chatId, userId, username, user) {
  await deletePrevMessage(chatId, user);
  user.selectedCategory = null;
  user.selectedCourse = null;
  user.selectedYear = null;
  user.selectedSemester = null;
  user.selectedSubject = null;
  user.selectedUnit = null;
  user.selectedFeature = null;
  persistAll();

  const roleText = isAdmin(userId) ? "Admin" : "Student";
  const displayName = username ? `@${escapeHtml(username)}` : `User ${escapeHtml(String(userId))}`;

  const welcomeText =
    `🌸 <b>- STUDY MATERIAL BOT -</b> 🌸\n\n` +
    `👤 Hello, <b>${displayName}</b>!\n\n` +
    `📚 <b>Your Complete Study Assistant</b>\n\n` +
    `— 📖 <b>Syllabus</b> (Subject &gt; Units &amp; Topics)\n` +
    `— ✍️ <b>Hand Written Notes</b> (Structured Text Format)\n` +
    `— 📜 <b>PYQ Question</b> (Past Exam Questions + Answers)\n` +
    `— 🎯 <b>Mock Test</b> (Full Course &amp; Single Unit + Timer)\n` +
    `— 🤖 <b>AI Assistant</b> (Ask Any Study Question)\n` +
    `— 🔗 <b>Links</b> (Admit Card &amp; Result via Google)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>User ID:</b> <code>${escapeHtml(String(userId))}</code>\n` +
    `🎖️ <b>Access:</b> <b>${roleText}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<i>Tap any button below to begin.</i>`;

  const keyboard = [
    [
      makeBtn("📘 Syllabus", "feat_syllabus", "blue"),
      makeBtn("✍️ Hand Written Notes", "feat_notes", "blue")
    ],
    [
      makeBtn("📜 PYQ Question", "feat_pyq", "green"),
      makeBtn("🎯 Mock Test", "feat_mock", "green")
    ],
    [
      makeBtn("🤖 AI Assistant", "feat_ai", "green"),
      makeBtn("🔗 Links", "feat_links", "blue")
    ]
  ];

  const sent = await sendTelegramMessage(chatId, welcomeText, {
    reply_markup: { inline_keyboard: keyboard }
  });
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}
async function showCategoriesForFeature(chatId, user, featCode) {
  user.selectedFeature = featCode;
  persistAll();
  await deletePrevMessage(chatId, user);

  const catList = getCategoryList();
  const rows = [];
  for (let i = 0; i < catList.length; i += 2) {
    const r = [makeBtn(`📂 ${catList[i]}`, `fcat_${featCode}_${i}`, "green")];
    if (catList[i + 1]) {
      r.push(makeBtn(`📂 ${catList[i + 1]}`, `fcat_${featCode}_${i + 1}`, "green"));
    }
    rows.push(r);
  }
  rows.push([makeBtn("🔙 Main Menu", "main_menu", "green")]);

  const sent = await sendTelegramMessage(chatId, "📂 <b>Category</b> chunein:", {
    reply_markup: { inline_keyboard: rows }
  });
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function showCoursesForFeature(chatId, user, featCode, cIdx) {
  const catName = getCategoryList()[cIdx];
  if (!catName) return showCategoriesForFeature(chatId, user, featCode);

  user.selectedCategory = catName;
  persistAll();
  await deletePrevMessage(chatId, user);

  const courses = getCoursesForCategory(catName);
  const rows = courses.map((crs, sIdx) => [
    makeBtn(`📘 ${crs}`, `fcrs_${featCode}_${cIdx}_${sIdx}`, "green")
  ]);
  rows.push([makeBtn("🔙 Back", `feat_${featCode}`, "green")]);

  const sent = await sendTelegramMessage(chatId, `📂 <b>${escapeHtml(catName)}</b> — Course chunein:`, {
    reply_markup: { inline_keyboard: rows }
  });
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function showYearsForFeature(chatId, user, featCode, cIdx, sIdx) {
  const catName = getCategoryList()[cIdx];
  const courseName = getCoursesForCategory(catName)[sIdx];
  if (!catName || !courseName) return showCategoriesForFeature(chatId, user, featCode);

  user.selectedCategory = catName;
  user.selectedCourse = courseName;
  persistAll();
  await deletePrevMessage(chatId, user);

  const years = getYearsForCourse(catName, courseName);
  const rows = years.map((yr, yIdx) => [
    makeBtn(`📅 ${yr}`, `fyr_${featCode}_${cIdx}_${sIdx}_${yIdx}`, "green")
  ]);
  rows.push([makeBtn("🔙 Back", `fcat_${featCode}_${cIdx}`, "green")]);

  const sent = await sendTelegramMessage(chatId, `📘 <b>${escapeHtml(courseName)}</b> — Year chunein:`, {
    reply_markup: { inline_keyboard: rows }
  });
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function showSemestersForFeature(chatId, user, featCode, cIdx, sIdx, yIdx) {
  const catName = getCategoryList()[cIdx];
  const courseName = getCoursesForCategory(catName)[sIdx];
  const yearName = getYearsForCourse(catName, courseName)[yIdx];
  if (!catName || !courseName || !yearName) return showCategoriesForFeature(chatId, user, featCode);

  user.selectedCategory = catName;
  user.selectedCourse = courseName;
  user.selectedYear = yearName;
  persistAll();

  if (featCode === "links") {
    const linkInfo = await fetchOfficialLinks(courseName, yearName, "");
    await sendLongMessage(
      chatId,
      `🔗 <b>ADMIT CARD &amp; RESULT LINKS (${escapeHtml(courseName)} — ${escapeHtml(yearName)}):</b>\n\n${escapeHtml(linkInfo)}`,
      { reply_markup: { inline_keyboard: [[makeBtn("🔙 Main Menu", "main_menu", "green")]] } }
    );
    return;
  }

  await deletePrevMessage(chatId, user);
  const sems = getSemestersForYear(catName, courseName, yearName);
  const rows = sems.map((sem, mIdx) => [
    makeBtn(`🗓️ ${sem}`, `fsem_${featCode}_${cIdx}_${sIdx}_${yIdx}_${mIdx}`, "green")
  ]);
  rows.push([makeBtn("🔙 Back", `fcrs_${featCode}_${cIdx}_${sIdx}`, "green")]);

  const sent = await sendTelegramMessage(chatId, `📅 <b>${escapeHtml(yearName)}</b> — Semester chunein:`, {
    reply_markup: { inline_keyboard: rows }
  });
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}
function getSubjectsList(user) {
  const prefix = `${user.selectedCategory}|${user.selectedCourse}|${user.selectedYear}|${user.selectedSemester}|`;
  const set = new Set();

  Object.keys(db.topics || {}).forEach((k) => {
    if (k.startsWith(prefix)) {
      const subj = k.slice(prefix.length).split("|")[0];
      if (subj) set.add(subj);
    }
  });

  if (set.size === 0 && user.selectedCategory === "Pharmacy" && user.selectedCourse === "B.Pharma") {
    if (user.selectedSemester === "Semester 1") {
      ["Introduction to Pharmacognosy", "Human Anatomy and Physiology I", "Pharmaceutical Analysis I", "Pharmaceutics I"].forEach((s) => set.add(s));
    } else if (user.selectedSemester === "Semester 2") {
      ["Pharmaceutical Organic Chemistry I", "Human Anatomy and Physiology II", "Biochemistry", "Pathophysiology"].forEach((s) => set.add(s));
    }
  }

  return Array.from(set);
}

function getUnitsList(user, subjectName) {
  const prefix = `${user.selectedCategory}|${user.selectedCourse}|${user.selectedYear}|${user.selectedSemester}|${subjectName}|`;
  const set = new Set();

  Object.keys(db.topics || {}).forEach((k) => {
    if (k.startsWith(prefix)) {
      const unit = k.slice(prefix.length);
      if (unit) set.add(unit);
    }
  });

  if (set.size === 0) {
    ["Unit 1", "Unit 2", "Unit 3", "Unit 4", "Unit 5"].forEach((u) => set.add(u));
  }

  return Array.from(set);
}

async function showSubjectsForFeature(chatId, user, featCode, cIdx, sIdx, yIdx, mIdx) {
  const catName = getCategoryList()[cIdx];
  const courseName = getCoursesForCategory(catName)[sIdx];
  const yearName = getYearsForCourse(catName, courseName)[yIdx];
  const semName = getSemestersForYear(catName, courseName, yearName)[mIdx];

  user.selectedCategory = catName;
  user.selectedCourse = courseName;
  user.selectedYear = yearName;
  user.selectedSemester = semName;
  persistAll();

  if (featCode === "links") {
    const linkInfo = await fetchOfficialLinks(courseName, yearName, semName);
    await sendLongMessage(
      chatId,
      `🔗 <b>ADMIT CARD &amp; RESULT LINKS (${escapeHtml(courseName)} — ${escapeHtml(semName)}):</b>\n\n${escapeHtml(linkInfo)}`,
      { reply_markup: { inline_keyboard: [[makeBtn("🔙 Main Menu", "main_menu", "green")]] } }
    );
    return;
  }

  await deletePrevMessage(chatId, user);
  const subjects = getSubjectsList(user);
  const rows = subjects.map((subj, subIdx) => [
    makeBtn(`📖 ${subj}`, `fsub_${featCode}_${cIdx}_${sIdx}_${yIdx}_${mIdx}_${subIdx}`, "green")
  ]);
  rows.push([makeBtn("🔙 Back", `fyr_${featCode}_${cIdx}_${sIdx}_${yIdx}`, "green")]);

  const sent = await sendTelegramMessage(chatId, `🗓️ <b>${escapeHtml(semName)}</b> — Subject chunein:`, {
    reply_markup: { inline_keyboard: rows }
  });
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function showUnitsForFeature(chatId, user, featCode, cIdx, sIdx, yIdx, mIdx, subIdx) {
  const subjects = getSubjectsList(user);
  const subjectName = subjects[subIdx];
  if (!subjectName) return showCategoriesForFeature(chatId, user, featCode);

  user.selectedSubject = subjectName;
  persistAll();
  await deletePrevMessage(chatId, user);

  const rows = [];
  if (featCode === "mock") {
    rows.push([
      makeBtn("📚 Full Course Mock Test (75M | 3h)", `run_mfull_${cIdx}_${sIdx}_${yIdx}_${mIdx}_${subIdx}_0`, "green")
    ]);
  }

  const units = getUnitsList(user, subjectName);
  units.forEach((unitName, uIdx) => {
    const tone = featCode === "syllabus" || featCode === "notes" ? "blue" : "green";
    rows.push([
      makeBtn(`📑 ${unitName}`, `run_${featCode}_${cIdx}_${sIdx}_${yIdx}_${mIdx}_${subIdx}_${uIdx}`, tone)
    ]);
  });

  rows.push([makeBtn("🔙 Back", `fsem_${featCode}_${cIdx}_${sIdx}_${yIdx}_${mIdx}`, "green")]);

  const sent = await sendTelegramMessage(
    chatId,
    `📖 <b>${escapeHtml(subjectName)}</b> — Unit chunein:`,
    { reply_markup: { inline_keyboard: rows } }
  );
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function executeFeatureOnUnit(chatId, user, featCode, cIdx, sIdx, yIdx, mIdx, subIdx, uIdx) {
  const catName = getCategoryList()[cIdx];
  const courseName = getCoursesForCategory(catName)[sIdx];
  const yearName = getYearsForCourse(catName, courseName)[yIdx];
  const semName = getSemestersForYear(catName, courseName, yearName)[mIdx];
  const ctx = { selectedCategory: catName, selectedCourse: courseName, selectedYear: yearName, selectedSemester: semName };
  const subjectName = getSubjectsList(ctx)[subIdx];
  const unitName = getUnitsList(ctx, subjectName)[uIdx];

  user.selectedSubject = subjectName;
  user.selectedUnit = unitName;
  persistAll();

  if (featCode === "syllabus") {
    const key = `${catName}|${courseName}|${yearName}|${semName}|${subjectName}|${unitName}`;
    const saved = db.topics[key] || "Is unit ka syllabus abhi admin ne add nahi kiya hai.";
    await sendLongMessage(
      chatId,
      `📘 <b>SYLLABUS: ${escapeHtml(subjectName)} — ${escapeHtml(unitName)}</b>\n\n${escapeHtml(saved)}`,
      { reply_markup: { inline_keyboard: [[makeBtn("🔙 Main Menu", "main_menu", "green")]] } }
    );
    return;
  }

  if (featCode === "notes") {
    const key = `${catName}|${courseName}|${yearName}|${semName}|${subjectName}|${unitName}`;
    const noteText = db.handwrittenNotes[key];
    if (!noteText) {
      await sendTelegramMessage(
        chatId,
        `✍️ <b>${escapeHtml(subjectName)} — ${escapeHtml(unitName)}</b> ke notes abhi admin ne upload nahi kiye hain.`,
        { reply_markup: { inline_keyboard: [[makeBtn("🔙 Main Menu", "main_menu", "green")]] } }
      );
      return;
    }
    await sendLongMessage(chatId, escapeHtml(noteText), {
      reply_markup: { inline_keyboard: [[makeBtn("🔙 Main Menu", "main_menu", "green")]] }
    });
    return;
  }

  if (featCode === "pyq") {
    await sendTelegramMessage(chatId, `📜 <b>Past PYQs</b> fetch ho rahe hain: <b>${escapeHtml(subjectName)} — ${escapeHtml(unitName)}</b>...`);
    const pyqOut = await generatePastPYQs(courseName, yearName, semName, subjectName, unitName);
    await sendLongMessage(
      chatId,
      `📜 <b>PYQ QUESTIONS: ${escapeHtml(subjectName)} (${escapeHtml(unitName)})</b>\n\n${escapeHtml(pyqOut)}`,
      { reply_markup: { inline_keyboard: [[makeBtn("🔙 Main Menu", "main_menu", "green")]] } }
    );
    return;
  }

  if (featCode === "mock") {
    return startMockTest(chatId, "unit", courseName, yearName, semName, subjectName, unitName);
  }
}
async function handleAdminCommands(chatId, userId, text) {
  if (!isAdmin(userId)) return false;

  if (text.startsWith("/add_cat ")) {
    const catName = text.replace("/add_cat ", "").trim();
    if (!catName) return sendTelegramMessage(chatId, "⚠️ Use: /add_cat CategoryName"), true;
    if (!db.categories[catName]) db.categories[catName] = [];
    persistAll();
    return sendTelegramMessage(chatId, `✅ Category added: <b>${escapeHtml(catName)}</b>`), true;
  }

  if (text.startsWith("/add_course ")) {
    const [catName, courseName] = text.replace("/add_course ", "").split("|").map((s) => s.trim());
    if (!catName || !courseName) return sendTelegramMessage(chatId, "⚠️ Use: /add_course Category | Course"), true;
    if (!db.categories[catName]) db.categories[catName] = [];
    if (!db.categories[catName].includes(courseName)) db.categories[catName].push(courseName);
    persistAll();
    return sendTelegramMessage(chatId, `✅ Course added: <b>${escapeHtml(courseName)}</b>`), true;
  }

  if (text.startsWith("/add_topic ")) {
    const parts = text.replace("/add_topic ", "").split("|").map((s) => s.trim());
    if (parts.length < 7) {
      return sendTelegramMessage(chatId, "⚠️ Use: /add_topic Category | Course | Year | Semester | Subject | Unit | Topics"), true;
    }
    const [catName, courseName, yearName, semName, subjectName, unitName, ...rest] = parts;
    db.topics[`${catName}|${courseName}|${yearName}|${semName}|${subjectName}|${unitName}`] = rest.join(" | ");
    persistAll();
    return sendTelegramMessage(chatId, `✅ Syllabus saved: <b>${escapeHtml(subjectName)} — ${escapeHtml(unitName)}</b>`), true;
  }

  // Admin: Notes add karna (photo bhejkar OCR text save karne ke liye)
  if (text.startsWith("/add_note_photo ")) {
    const parts = text.replace("/add_note_photo ", "").split("|").map((s) => s.trim());
    if (parts.length < 6) {
      return sendTelegramMessage(
        chatId,
        "⚠️ Use: /add_note_photo Category | Course | Year | Semester | Subject | Unit\nPhir notes ki photo bhejein."
      ), true;
    }
    const [catName, courseName, yearName, semName, subjectName, unitName] = parts;
    pendingNotesUpload[userId] = { catName, courseName, yearName, semName, subjectName, unitName };
    return sendTelegramMessage(
      chatId,
      `📸 Ab <b>${escapeHtml(subjectName)} — ${escapeHtml(unitName)}</b> ke notes ki <b>photo</b> bhejein. Bot uska text nikal kar notes mein save kar dega.`
    ), true;
  }

  // Admin: Direct text notes add karna
  if (text.startsWith("/add_note ")) {
    const parts = text.replace("/add_note ", "").split("|").map((s) => s.trim());
    if (parts.length < 7) {
      return sendTelegramMessage(chatId, "⚠️ Use: /add_note Category | Course | Year | Semester | Subject | Unit | NotesText"), true;
    }
    const [catName, courseName, yearName, semName, subjectName, unitName, ...noteParts] = parts;
    const key = `${catName}|${courseName}|${yearName}|${semName}|${subjectName}|${unitName}`;
    db.handwrittenNotes[key] = noteParts.join(" | ");
    persistAll();
    return sendTelegramMessage(chatId, `✅ Notes saved: <b>${escapeHtml(subjectName)} — ${escapeHtml(unitName)}</b>`), true;
  }

  // Admin: Notes hatana
  if (text.startsWith("/del_note ")) {
    const parts = text.replace("/del_note ", "").split("|").map((s) => s.trim());
    if (parts.length < 6) {
      return sendTelegramMessage(chatId, "⚠️ Use: /del_note Category | Course | Year | Semester | Subject | Unit"), true;
    }
    const [catName, courseName, yearName, semName, subjectName, unitName] = parts;
    const key = `${catName}|${courseName}|${yearName}|${semName}|${subjectName}|${unitName}`;
    if (db.handwrittenNotes[key]) {
      delete db.handwrittenNotes[key];
      persistAll();
      return sendTelegramMessage(chatId, `🗑️ Notes deleted: <b>${escapeHtml(subjectName)} — ${escapeHtml(unitName)}</b>`), true;
    }
    return sendTelegramMessage(chatId, "⚠️ Ye notes nahi mile."), true;
  }

  // Admin: Unit/Syllabus hatana
  if (text.startsWith("/del_unit ")) {
    const parts = text.replace("/del_unit ", "").split("|").map((s) => s.trim());
    if (parts.length < 6) {
      return sendTelegramMessage(chatId, "⚠️ Use: /del_unit Category | Course | Year | Semester | Subject | Unit"), true;
    }
    const [catName, courseName, yearName, semName, subjectName, unitName] = parts;
    const key = `${catName}|${courseName}|${yearName}|${semName}|${subjectName}|${unitName}`;
    if (db.topics[key]) {
      delete db.topics[key];
      persistAll();
      return sendTelegramMessage(chatId, `🗑️ Syllabus unit deleted: <b>${escapeHtml(unitName)}</b>`), true;
    }
    return sendTelegramMessage(chatId, "⚠️ Ye unit nahi mili."), true;
  }

  if (text.startsWith("/del_course ")) {
    const parts = text.replace("/del_course ", "").split("|").map((s) => s.trim());
    const catName = parts[0];
    const courseName = parts.slice(1).join(" | ").trim();
    if (!catName || !courseName || !db.categories[catName]) {
      return sendTelegramMessage(chatId, "⚠️ Use: /del_course Category | CourseName"), true;
    }
    db.categories[catName] = db.categories[catName].filter((c) => c !== courseName);
    persistAll();
    return sendTelegramMessage(chatId, `🗑️ Course removed: <b>${escapeHtml(courseName)}</b>`), true;
  }

  return false;
}
async function handleCallbackQuery(cq) {
  const chatId = cq.message.chat.id;
  const userId = cq.from?.id;
  const username = cq.from?.username || cq.from?.first_name || "";
  const data = cq.data || "";
  const user = getUser(chatId);

  if (TELEGRAM_API) {
    try {
      await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, { callback_query_id: cq.id });
    } catch (_) {}
  }

  if (data === "main_menu") return showStartDashboard(chatId, userId, username, user);

  if (data.startsWith("feat_")) {
    const featCode = data.replace("feat_", "");
    if (featCode === "ai") {
      user.selectedFeature = "ai";
      persistAll();
      return sendTelegramMessage(chatId, "🤖 <b>AI Assistant Ready!</b>\nApna sawal likh kar bhejein:");
    }
    return showCategoriesForFeature(chatId, user, featCode);
  }

  if (data.startsWith("fcat_")) {
    const [, featCode, cIdx] = data.split("_");
    return showCoursesForFeature(chatId, user, featCode, Number(cIdx));
  }

  if (data.startsWith("fcrs_")) {
    const [, featCode, cIdx, sIdx] = data.split("_");
    return showYearsForFeature(chatId, user, featCode, Number(cIdx), Number(sIdx));
  }

  if (data.startsWith("fyr_")) {
    const [, featCode, cIdx, sIdx, yIdx] = data.split("_");
    return showSemestersForFeature(chatId, user, featCode, Number(cIdx), Number(sIdx), Number(yIdx));
  }

  if (data.startsWith("fsem_")) {
    const [, featCode, cIdx, sIdx, yIdx, mIdx] = data.split("_");
    return showSubjectsForFeature(chatId, user, featCode, Number(cIdx), Number(sIdx), Number(yIdx), Number(mIdx));
  }

  if (data.startsWith("fsub_")) {
    const [, featCode, cIdx, sIdx, yIdx, mIdx, subIdx] = data.split("_");
    return showUnitsForFeature(chatId, user, featCode, Number(cIdx), Number(sIdx), Number(yIdx), Number(mIdx), Number(subIdx));
  }

  if (data.startsWith("run_mfull_")) {
    const [, , cIdx, sIdx, yIdx, mIdx, subIdx] = data.split("_").map(Number);
    const catName = getCategoryList()[cIdx];
    const courseName = getCoursesForCategory(catName)[sIdx];
    const yearName = getYearsForCourse(catName, courseName)[yIdx];
    const semName = getSemestersForYear(catName, courseName, yearName)[mIdx];
    const subjectName = getSubjectsList({ selectedCategory: catName, selectedCourse: courseName, selectedYear: yearName, selectedSemester: semName })[subIdx];
    return startMockTest(chatId, "full", courseName, yearName, semName, subjectName, "Full Course");
  }

  if (data.startsWith("run_")) {
    const [, featCode, cIdx, sIdx, yIdx, mIdx, subIdx, uIdx] = data.split("_");
    return executeFeatureOnUnit(chatId, user, featCode, Number(cIdx), Number(sIdx), Number(yIdx), Number(mIdx), Number(subIdx), Number(uIdx));
  }

  if (data === "mock_time_left") {
    const session = activeTests[chatId];
    if (!session) return sendTelegramMessage(chatId, "⚠️ Koi active Mock Test nahi hai.");
    const remMs = Math.max(0, session.endTime - Date.now());
    const mins = Math.floor(remMs / 60000);
    const secs = Math.floor((remMs % 60000) / 1000);
    return sendTelegramMessage(chatId, `⏱️ <b>Time Remaining:</b> ${mins}m ${secs}s`);
  }

  if (data === "mock_submit") {
    return finishMockTest(chatId, false);
  }
}

async function handlePhotoUpload(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;

  if (!isAdmin(userId) || !pendingNotesUpload[userId]) {
    return sendTelegramMessage(
      chatId,
      "ℹ️ Notes mein photo add karne ke liye pehle admin command bhejein:\n<code>/add_note_photo Category | Course | Year | Semester | Subject | Unit</code>"
    );
  }

  const meta = pendingNotesUpload[userId];
  delete pendingNotesUpload[userId];

  const photoArr = msg.photo || [];
  const bestPhoto = photoArr[photoArr.length - 1];
  if (!bestPhoto?.file_id || !TELEGRAM_API || !TELEGRAM_FILE_API) {
    return sendTelegramMessage(chatId, "⚠️ Photo read nahi ho paayi.");
  }

  await sendTelegramMessage(chatId, "🔍 Photo ka text padh kar notes taiyar kiye ja rahe hain...");

  try {
    const fileInfo = await axios.get(`${TELEGRAM_API}/getFile?file_id=${bestPhoto.file_id}`);
    const filePath = fileInfo.data?.result?.file_path;
    const imgRes = await axios.get(`${TELEGRAM_FILE_API}/${filePath}`, { responseType: "arraybuffer" });
    const structuredText = await extractStructuredNotesFromImage(Buffer.from(imgRes.data), "image/jpeg", {
      course: meta.courseName,
      year: meta.yearName,
      sem: meta.semName,
      subject: meta.subjectName,
      unit: meta.unitName
    });

    const key = `${meta.catName}|${meta.courseName}|${meta.yearName}|${meta.semName}|${meta.subjectName}|${meta.unitName}`;
    db.handwrittenNotes[key] = structuredText;
    persistAll();

    await sendLongMessage(
      chatId,
      `✅ <b>Notes Text Saved!</b>\n\n${escapeHtml(structuredText)}`,
      { reply_markup: { inline_keyboard: [[makeBtn("🔙 Main Menu", "main_menu", "green")]] } }
    );
  } catch (err) {
    console.error("Photo OCR Error:", err.message);
    await sendTelegramMessage(chatId, "⚠️ Photo se text nikalne mein error aaya.");
  }
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const username = msg.from?.username || msg.from?.first_name || "";
  const user = getUser(chatId);

  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    return handlePhotoUpload(msg);
  }

  if (msg.document) {
    return sendTelegramMessage(
      chatId,
      "📄 File/PDF ke bajay <b>Photo</b> bhejein (ya <code>/add_note</code> se text notes daalein) taaki bot uska poora text nikal kar notes mein de sake."
    );
  }

  const text = (msg.text || "").trim();
  if (!text) return;

  if (text === "/start" || text === "/menu") {
    return showStartDashboard(chatId, userId, username, user);
  }

  if (await handleAdminCommands(chatId, userId, text)) return;

  if (activeTests[chatId]) {
    return sendTelegramMessage(
      chatId,
      "✍️ Aapka answer record kar liya gaya hai. Test khatam hone par <b>Submit Test &amp; Answers</b> dabayein."
    );
  }

  const aiReply = await askAiAssistant(chatId, text, user);
  await sendLongMessage(chatId, aiReply, {
    reply_markup: { inline_keyboard: [[makeBtn("🔙 Main Menu", "main_menu", "green")]] }
  });
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body;
    if (update?.message) {
      await handleMessage(update.message);
    } else if (update?.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
  } catch (err) {
    console.error("Webhook Error:", err.message);
  }
});
app.get("/", (req, res) => {
  res.status(200).send("Study Material Bot Server is Running.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
