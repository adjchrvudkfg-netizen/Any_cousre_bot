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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const DB_FILE = path.join(__dirname, "study_material_db.json");
const activeTests = {};
const pendingInputs = {};
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
  materials: {},
  uploadedPdfs: [],
  users: {}
};

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      db.categories = raw.categories && Object.keys(raw.categories).length ? raw.categories : JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
      db.customYears = raw.customYears || JSON.parse(JSON.stringify(DEFAULT_YEARS));
      db.customSemesters = raw.customSemesters || JSON.parse(JSON.stringify(DEFAULT_SEMESTERS));
      db.topics = raw.topics || {};
      db.materials = raw.materials || {};
      db.uploadedPdfs = Array.isArray(raw.uploadedPdfs) ? raw.uploadedPdfs : [];
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
      selectedMode: null,
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
  const key = `${catName}|${courseName}`;
  return db.customYears[key] || ["1st Year", "2nd Year"];
}

function getSemestersForYear(catName, courseName, yearName) {
  const key = `${catName}|${courseName}|${yearName}`;
  return db.customSemesters[key] || ["Semester 1", "Semester 2"];
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
async function askGemini(promptText, useGoogleSearch = true) {
  if (!GEMINI_API_KEY) {
    return "⚠️ Server par GEMINI_API_KEY set nahi hai. Render Environment Variables mein GEMINI_API_KEY add karein.";
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096
    }
  };

  if (useGoogleSearch) {
    payload.tools = [{ googleSearch: {} }];
  }

  try {
    const res = await axios.post(GEMINI_URL, payload, { timeout: 60000 });
    const parts = res.data?.candidates?.[0]?.content?.parts || [];
    const output = parts.map((p) => p.text || "").join("\n").trim();
    return output || "⚠️ Response generate nahi ho paya. Dobara try karein.";
  } catch (err) {
    console.error("Gemini API Error:", err.response?.data || err.message);
    return "⚠️ AI service temporarily unavailable hai. Thodi der baad try karein.";
  }
}

async function generateDetailedNotes(course, year, sem, subject, unit) {
  const cacheKey = `SCRIBD_NOTES::${course}::${year}::${sem}::${subject}::${unit}`;
  if (db.materials[cacheKey]) {
    return db.materials[cacheKey];
  }

  const prompt = `Google Search ka upyog karke PCI (Pharmacy Council of India) syllabus aur Scribd / pharmacy study resources ke mutabik niche diye gaye topic ke complete, detailed exam notes banao:

Course: ${course}
Year: ${year}
Semester: ${sem}
Subject: ${subject}
Unit: ${unit}

Niyam:
1. Har topic aur sub-topic ko poori detail mein samjhao (definition, classification, mechanism/principle/structure, advantages/disadvantages, aur pharmaceutical importance/uses).
2. Notes bilkul structured aur exam-ready hon jaise student full marks ke liye likhta hai.
3. Aakhir mein "Important Exam Questions (2M, 5M, 10M)" bhi do.
4. Markdown table ya raw HTML tags mat lagao; saaf plain text aur headings/bullets use karo.`;

  const text = await askGemini(prompt, true);
  if (!text.startsWith("⚠️")) {
    db.materials[cacheKey] = text;
    persistAll();
  }
  return text;
}

async function generatePYQs(course, year, sem, subject, unit) {
  const cacheKey = `PYQ::${course}::${year}::${sem}::${subject}::${unit}`;
  if (db.materials[cacheKey]) {
    return db.materials[cacheKey];
  }

  const prompt = `Google Search ka use karke PCI (Pharmacy Council of India) ke syllabus ke anusaar pichhle saalon (Previous Years) mein aaye hue sabhi important exam questions (PYQs) nikalo:

Course: ${course}
Year: ${year}
Semester: ${sem}
Subject: ${subject}
Unit: ${unit}

Format:
- Short / Very Short Questions (2 Marks)
- Medium / Short Answer Questions (5 Marks — jahan sambhav ho wahan frequency/year mention karo)
- Long Answer Questions (10 Marks)
Sirf genuine aur syllabus-relevant questions do.`;

  const text = await askGemini(prompt, true);
  if (!text.startsWith("⚠️")) {
    db.materials[cacheKey] = text;
    persistAll();
  }
  return text;
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
    `⏳ <b>Mock Test Taiyar Ho Raha Hai...</b>\n` +
      `📘 <b>Subject:</b> ${escapeHtml(subject)}\n` +
      `📚 <b>Mode:</b> ${escapeHtml(scopeLabel)}\n` +
      `📝 <b>Pattern:</b> ${totalMarks} Marks | ⏱️ ${durationMinutes} Minutes\n\n` +
      `PCI syllabus se naye questions ban rahe hain...`
  );

  const prompt = isFull
    ? `PCI (Pharmacy Council of India) university exam pattern ke hisaab se ek bilkul naya FULL SYLLABUS Mock Test Paper banao:
Course: ${course}
Year: ${year}
Semester: ${sem}
Subject: ${subject}
Total Marks: 75 | Time Allowed: 3 Hours (180 Minutes)

Paper Structure:
- Section A: 10 Multiple Choice Questions (2 Marks each = 20 Marks) from across the full syllabus with options (A, B, C, D).
- Section B: 3 Long Answer Questions (Attempt any 2, 10 Marks each = 20 Marks).
- Section C: 9 Short Answer Questions (Attempt any 7, 5 Marks each = 35 Marks).

Bilkul real exam question paper jaisa likho. Answer key abhi mat dena.`
    : `PCI syllabus ke hisaab se sirf ek unit ka Sessional Mock Test Paper banao:
Course: ${course}
Year: ${year}
Semester: ${sem}
Subject: ${subject}
Unit: ${unit}
Total Marks: 30 | Time Allowed: 1 Hour (60 Minutes)

Paper Structure:
- Section A: 5 Multiple Choice Questions (1 Mark each = 5 Marks) from this unit with options (A, B, C, D).
- Section B: 2 Long Answer Questions (Attempt any 1, 10 Marks).
- Section C: 4 Short Answer Questions (Attempt any 3, 5 Marks each = 15 Marks).

Bilkul exam question paper jaisa likho. Answer key abhi mat dena.`;

  const paper = await askGemini(prompt, true);
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
    unit: isFull ? "Full Syllabus" : unit,
    totalMarks,
    durationMinutes,
    endTime,
    timer
  };

  await sendLongMessage(
    chatId,
    `📝 <b>MOCK TEST SHURU!</b>\n` +
      `📘 <b>Subject:</b> ${escapeHtml(subject)} (${escapeHtml(scopeLabel)})\n` +
      `💯 <b>Max Marks:</b> ${totalMarks} | ⏱️ <b>Time:</b> ${durationMinutes} Minutes\n\n` +
      `${escapeHtml(paper)}\n\n` +
      `👉 Apne answers likh kar bhej sakte hain ya jab chahein Submit karke Answer Key dekh sakte hain:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⏱️ Bacha Hua Time Dekhein", callback_data: "mock_time_left" }],
          [{ text: "✅ Submit Test & Answer Key", callback_data: "mock_submit" }]
        ]
      }
    }
  );
}

async function finishMockTest(chatId, isAutoTimeUp = false) {
  const session = activeTests[chatId];
  if (!session) {
    await sendTelegramMessage(chatId, "⚠️ Koi active Mock Test nahi chal raha hai.");
    return;
  }

  clearTimeout(session.timer);
  delete activeTests[chatId];

  const header = isAutoTimeUp
    ? "⏰ <b>TIME SAMAPT!</b> Aapka Mock Test automatically submit ho gaya hai.\n\n"
    : "✅ <b>MOCK TEST SUBMITTED!</b>\n\n";

  const solutionPrompt = `Niche diye gaye PCI Pharmacy Mock Test paper ka complete Answer Key & Marking Guide banao (MCQs ke sahi option + Short aur Long questions ke main points):\n\n${session.paper}`;
  const solutions = await askGemini(solutionPrompt, false);

  await sendLongMessage(
    chatId,
    `${header}📊 <b>ANSWER KEY & SOLUTIONS (${session.subject} — ${session.unit}):</b>\n\n${escapeHtml(solutions)}`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
      }
    }
  );
}
async function showMainMenu(chatId, user) {
  await deletePrevMessage(chatId, user);
  user.selectedCategory = null;
  user.selectedCourse = null;
  user.selectedYear = null;
  user.selectedSemester = null;
  user.selectedSubject = null;
  user.selectedUnit = null;
  user.selectedMode = null;
  persistAll();

  const catList = getCategoryList();
  const rows = [];
  for (let i = 0; i < catList.length; i += 2) {
    const row = [{ text: `📂 ${catList[i]}`, callback_data: `cat_${i}` }];
    if (catList[i + 1]) {
      row.push({ text: `📂 ${catList[i + 1]}`, callback_data: `cat_${i + 1}` });
    }
    rows.push(row);
  }

  const sent = await sendTelegramMessage(
    chatId,
    "🎓 <b>STUDY MATERIAL BOT</b>\n\nApni <b>Category</b> chunein:",
    { reply_markup: { inline_keyboard: rows } }
  );
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function showCoursesMenu(chatId, user, cIdx) {
  const catList = getCategoryList();
  const catName = catList[cIdx];
  if (!catName) return showMainMenu(chatId, user);

  user.selectedCategory = catName;
  user.selectedCourse = null;
  user.selectedYear = null;
  user.selectedSemester = null;
  persistAll();

  await deletePrevMessage(chatId, user);
  const courses = getCoursesForCategory(catName);
  const rows = courses.map((courseName, sIdx) => [
    { text: `📘 ${courseName}`, callback_data: `crs_${cIdx}_${sIdx}` }
  ]);
  rows.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

  const sent = await sendTelegramMessage(
    chatId,
    `⚡ <b>${escapeHtml(catName.toUpperCase())}</b>\n\nApna <b>Course</b> chunein:`,
    { reply_markup: { inline_keyboard: rows } }
  );
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function showYearsMenu(chatId, user, cIdx, sIdx) {
  const catName = getCategoryList()[cIdx];
  const courseName = getCoursesForCategory(catName)[sIdx];
  if (!catName || !courseName) return showMainMenu(chatId, user);

  user.selectedCategory = catName;
  user.selectedCourse = courseName;
  persistAll();

  await deletePrevMessage(chatId, user);
  const years = getYearsForCourse(catName, courseName);
  const rows = years.map((yr, yIdx) => [
    { text: `📅 ${yr}`, callback_data: `yr_${cIdx}_${sIdx}_${yIdx}` }
  ]);
  rows.push([{ text: "🔙 Back to Courses", callback_data: `cat_${cIdx}` }]);

  const sent = await sendTelegramMessage(
    chatId,
    `📘 <b>${escapeHtml(catName)} — ${escapeHtml(courseName)}</b>\n\nApna <b>Year</b> chunein:`,
    { reply_markup: { inline_keyboard: rows } }
  );
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function showSemestersMenu(chatId, user, cIdx, sIdx, yIdx) {
  const catName = getCategoryList()[cIdx];
  const courseName = getCoursesForCategory(catName)[sIdx];
  const yearName = getYearsForCourse(catName, courseName)[yIdx];
  if (!catName || !courseName || !yearName) return showMainMenu(chatId, user);

  user.selectedCategory = catName;
  user.selectedCourse = courseName;
  user.selectedYear = yearName;
  persistAll();

  await deletePrevMessage(chatId, user);
  const sems = getSemestersForYear(catName, courseName, yearName);
  const rows = sems.map((sem, mIdx) => [
    { text: `🗓️ ${sem}`, callback_data: `sem_${cIdx}_${sIdx}_${yIdx}_${mIdx}` }
  ]);
  rows.push([{ text: "🔙 Back to Years", callback_data: `crs_${cIdx}_${sIdx}` }]);

  const sent = await sendTelegramMessage(
    chatId,
    `📅 <b>${escapeHtml(courseName)} — ${escapeHtml(yearName)}</b>\n\nApna <b>Semester / Syllabus</b> chunein:`,
    { reply_markup: { inline_keyboard: rows } }
  );
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}
function getSubjectsForCurrentContext(user) {
  const prefix = `${user.selectedCategory}|${user.selectedCourse}|${user.selectedYear}|${user.selectedSemester}|`;
  const subjSet = new Set();

  Object.keys(db.topics || {}).forEach((k) => {
    if (k.startsWith(prefix)) {
      const rest = k.slice(prefix.length);
      const subj = rest.split("|")[0];
      if (subj) subjSet.add(subj);
    }
  });

  if (subjSet.size === 0 && user.selectedCategory === "Pharmacy" && user.selectedCourse === "B.Pharma") {
    if (user.selectedSemester === "Semester 1") {
      ["Introduction to Pharmacognosy", "Human Anatomy and Physiology I", "Pharmaceutical Analysis I", "Pharmaceutics I"].forEach((s) => subjSet.add(s));
    } else if (user.selectedSemester === "Semester 2") {
      ["Pharmaceutical Organic Chemistry I", "Human Anatomy and Physiology II", "Biochemistry", "Pathophysiology", "Computer Applications in Pharmacy", "Environmental Sciences"].forEach((s) => subjSet.add(s));
    }
  }

  return Array.from(subjSet);
}

function getUnitsForSubject(user, subjectName) {
  const prefix = `${user.selectedCategory}|${user.selectedCourse}|${user.selectedYear}|${user.selectedSemester}|${subjectName}|`;
  const unitSet = new Set();

  Object.keys(db.topics || {}).forEach((k) => {
    if (k.startsWith(prefix)) {
      const unit = k.slice(prefix.length);
      if (unit) unitSet.add(unit);
    }
  });

  if (unitSet.size === 0) {
    ["Unit 1", "Unit 2", "Unit 3", "Unit 4", "Unit 5"].forEach((u) => unitSet.add(u));
  }

  return Array.from(unitSet);
}

async function showSubjectsMenu(chatId, user, cIdx, sIdx, yIdx, mIdx) {
  const catName = getCategoryList()[cIdx];
  const courseName = getCoursesForCategory(catName)[sIdx];
  const yearName = getYearsForCourse(catName, courseName)[yIdx];
  const semName = getSemestersForYear(catName, courseName, yearName)[mIdx];

  user.selectedCategory = catName;
  user.selectedCourse = courseName;
  user.selectedYear = yearName;
  user.selectedSemester = semName;
  persistAll();

  await deletePrevMessage(chatId, user);
  const subjects = getSubjectsForCurrentContext(user);
  const rows = subjects.map((subj, subIdx) => [
    { text: `📖 ${subj}`, callback_data: `sub_${cIdx}_${sIdx}_${yIdx}_${mIdx}_${subIdx}` }
  ]);
  rows.push([{ text: "🔙 Back to Semesters", callback_data: `yr_${cIdx}_${sIdx}_${yIdx}` }]);

  const sent = await sendTelegramMessage(
    chatId,
    `🗓️ <b>${escapeHtml(courseName)} — ${escapeHtml(semName)}</b>\n\nApna <b>Subject</b> chunein:`,
    { reply_markup: { inline_keyboard: rows } }
  );
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function showUnitsMenu(chatId, user, cIdx, sIdx, yIdx, mIdx, subIdx) {
  const subjects = getSubjectsForCurrentContext(user);
  const subjectName = subjects[subIdx];
  if (!subjectName) return showMainMenu(chatId, user);

  user.selectedSubject = subjectName;
  persistAll();

  await deletePrevMessage(chatId, user);
  const units = getUnitsForSubject(user, subjectName);
  const rows = units.map((u, uIdx) => [
    { text: `📑 ${u}`, callback_data: `unt_${cIdx}_${sIdx}_${yIdx}_${mIdx}_${subIdx}_${uIdx}` }
  ]);
  rows.push([{ text: "📝 Full Course Mock Test (75M | 3h)", callback_data: `mfull_${cIdx}_${sIdx}_${yIdx}_${mIdx}_${subIdx}` }]);
  rows.push([{ text: "🔙 Back to Subjects", callback_data: `sem_${cIdx}_${sIdx}_${yIdx}_${mIdx}` }]);

  const sent = await sendTelegramMessage(
    chatId,
    `📖 <b>${escapeHtml(subjectName)}</b>\n\n<b>Unit</b> chunein ya <b>Full Course Mock Test</b> start karein:`,
    { reply_markup: { inline_keyboard: rows } }
  );
  if (sent) {
    user.lastMessageId = sent.message_id;
    persistAll();
  }
}

async function showUnitActionsMenu(chatId, user, cIdx, sIdx, yIdx, mIdx, subIdx, uIdx) {
  const subjects = getSubjectsForCurrentContext(user);
  const subjectName = subjects[subIdx];
  const units = getUnitsForSubject(user, subjectName);
  const unitName = units[uIdx];
  if (!subjectName || !unitName) return showMainMenu(chatId, user);

  user.selectedSubject = subjectName;
  user.selectedUnit = unitName;
  persistAll();

  const topicKey = `${user.selectedCategory}|${user.selectedCourse}|${user.selectedYear}|${user.selectedSemester}|${subjectName}|${unitName}`;
  const savedTopic = db.topics[topicKey];

  const baseIdx = `${cIdx}_${sIdx}_${yIdx}_${mIdx}_${subIdx}_${uIdx}`;
  const rows = [
    [{ text: "📚 Detailed Notes (Scribd/PCI AI)", callback_data: `act_notes_${baseIdx}` }],
    [{ text: "📜 PYQ Questions (Previous Years)", callback_data: `act_pyq_${baseIdx}` }],
    [{ text: "🎯 Single Unit Mock Test (30M | 1h)", callback_data: `act_munit_${baseIdx}` }],
    [{ text: "📝 Full Course Mock Test (75M | 3h)", callback_data: `act_mfull_${baseIdx}` }],
    [{ text: "🔙 Back to Units", callback_data: `sub_${cIdx}_${sIdx}_${yIdx}_${mIdx}_${subIdx}` }]
  ];

  const syllabusInfo = savedTopic ? `\n\n📌 <b>Syllabus Topics:</b>\n${escapeHtml(savedTopic)}` : "";
  await sendTelegramMessage(
    chatId,
    `📑 <b>${escapeHtml(subjectName)} — ${escapeHtml(unitName)}</b>${syllabusInfo}\n\nKya chahiye?`,
    { reply_markup: { inline_keyboard: rows } }
  );
}
async function handleAdminCommand(chatId, userId, text) {
  if (!isAdmin(userId)) {
    await sendTelegramMessage(chatId, "⛔ Aapko admin commands chalane ki permission nahi hai.");
    return true;
  }

  if (text.startsWith("/add_cat ")) {
    const catName = text.replace("/add_cat ", "").trim();
    if (!catName) {
      await sendTelegramMessage(chatId, "⚠️ Use: /add_cat CategoryName");
      return true;
    }
    if (!db.categories[catName]) {
      db.categories[catName] = [];
      persistAll();
    }
    await sendTelegramMessage(chatId, `✅ Category added: <b>${escapeHtml(catName)}</b>`);
    return true;
  }

  if (text.startsWith("/add_course ")) {
    const parts = text.replace("/add_course ", "").split("|").map((s) => s.trim());
    const [catName, courseName] = parts;
    if (!catName || !courseName) {
      await sendTelegramMessage(chatId, "⚠️ Use: /add_course Category | Course");
      return true;
    }
    if (!db.categories[catName]) db.categories[catName] = [];
    if (!db.categories[catName].includes(courseName)) {
      db.categories[catName].push(courseName);
      persistAll();
    }
    await sendTelegramMessage(chatId, `✅ Course <b>${escapeHtml(courseName)}</b> added under <b>${escapeHtml(catName)}</b>`);
    return true;
  }

  if (text.startsWith("/add_year ")) {
    const parts = text.replace("/add_year ", "").split("|").map((s) => s.trim());
    const [catName, courseName, yearName] = parts;
    if (!catName || !courseName || !yearName) {
      await sendTelegramMessage(chatId, "⚠️ Use: /add_year Category | Course | Year");
      return true;
    }
    const key = `${catName}|${courseName}`;
    if (!db.customYears[key]) db.customYears[key] = [];
    if (!db.customYears[key].includes(yearName)) {
      db.customYears[key].push(yearName);
      persistAll();
    }
    await sendTelegramMessage(chatId, `✅ Year <b>${escapeHtml(yearName)}</b> added.`);
    return true;
  }

  if (text.startsWith("/add_sem ")) {
    const parts = text.replace("/add_sem ", "").split("|").map((s) => s.trim());
    const [catName, courseName, yearName, semName] = parts;
    if (!catName || !courseName || !yearName || !semName) {
      await sendTelegramMessage(chatId, "⚠️ Use: /add_sem Category | Course | Year | Semester");
      return true;
    }
    const key = `${catName}|${courseName}|${yearName}`;
    if (!db.customSemesters[key]) db.customSemesters[key] = [];
    if (!db.customSemesters[key].includes(semName)) {
      db.customSemesters[key].push(semName);
      persistAll();
    }
    await sendTelegramMessage(chatId, `✅ Semester <b>${escapeHtml(semName)}</b> added.`);
    return true;
  }

  if (text.startsWith("/add_topic ")) {
    const parts = text.replace("/add_topic ", "").split("|").map((s) => s.trim());
    if (parts.length < 7) {
      await sendTelegramMessage(
        chatId,
        "⚠️ Use: /add_topic Category | Course | Year | Semester | Subject | Unit | Topics"
      );
      return true;
    }
    const [catName, courseName, yearName, semName, subjectName, unitName, ...topicParts] = parts;
    const topicsText = topicParts.join(" | ").trim();
    const key = `${catName}|${courseName}|${yearName}|${semName}|${subjectName}|${unitName}`;
    db.topics[key] = topicsText;
    persistAll();
    await sendTelegramMessage(
      chatId,
      `✅ Topic saved for <b>${escapeHtml(subjectName)}</b> — <b>${escapeHtml(unitName)}</b>`
    );
    return true;
  }

  return false;
}
async function handleDeleteCommands(chatId, userId, text) {
  if (!isAdmin(userId)) return false;

  if (text.startsWith("/del_cat")) {
    const catName = text.replace("/del_cat", "").trim();
    if (!catName || !db.categories[catName]) {
      await sendTelegramMessage(chatId, "⚠️ Use: /del_cat CategoryName");
      return true;
    }
    delete db.categories[catName];
    persistAll();
    await sendTelegramMessage(chatId, `🗑️ Category deleted: <b>${escapeHtml(catName)}</b>`);
    return true;
  }

  if (text.startsWith("/del_course")) {
    const raw = text.replace("/del_course", "").trim();
    const parts = raw.split("|").map((s) => s.trim());
    const catName = parts[0];
    const courseName = parts.slice(1).join(" | ").trim();

    if (!catName || !courseName || !db.categories[catName]) {
      await sendTelegramMessage(chatId, "⚠️ Use: /del_course Category | CourseName");
      return true;
    }

    const beforeLen = db.categories[catName].length;
    db.categories[catName] = db.categories[catName].filter((c) => c !== courseName);
    persistAll();

    if (db.categories[catName].length < beforeLen) {
      await sendTelegramMessage(
        chatId,
        `🗑️ Course Removed: <b>${escapeHtml(courseName)}</b> from <b>${escapeHtml(catName)}</b>`
      );
    } else {
      await sendTelegramMessage(chatId, `⚠️ Course nahi mila: <b>${escapeHtml(courseName)}</b>`);
    }
    return true;
  }

  if (text.startsWith("/del_unit")) {
    const raw = text.replace("/del_unit", "").trim();
    const parts = raw.split("|").map((s) => s.trim());

    if (parts.length < 7) {
      await sendTelegramMessage(
        chatId,
        "⚠️ Use: /del_unit Category | Course | Year | Semester | StudyType | Subject | Unit"
      );
      return true;
    }

    const [catName, courseName, yearName, semName, _studyType, subjectName, unitName] = parts;
    const key = `${catName}|${courseName}|${yearName}|${semName}|${subjectName}|${unitName}`;

    if (db.topics[key]) {
      delete db.topics[key];
      persistAll();
      await sendTelegramMessage(chatId, `🗑️ Unit deleted: <b>${escapeHtml(unitName)}</b>`);
    } else {
      await sendTelegramMessage(chatId, "⚠️ Ye unit nahi mili.");
    }
    return true;
  }

  if (text.startsWith("/del_pdf")) {
    const raw = text.replace("/del_pdf", "").trim();
    const titleToDelete = raw.includes("|") ? raw.split("|").pop().trim() : raw;

    if (!titleToDelete) {
      await sendTelegramMessage(chatId, "⚠️ Use: /del_pdf TitleName");
      return true;
    }

    const beforeCount = db.uploadedPdfs.length;
    db.uploadedPdfs = db.uploadedPdfs.filter(
      (item) => String(item.title || "").toLowerCase() !== titleToDelete.toLowerCase()
    );
    persistAll();

    if (db.uploadedPdfs.length < beforeCount) {
      await sendTelegramMessage(chatId, `🗑️ Deleted: <b>${escapeHtml(titleToDelete)}</b>`);
    } else {
      await sendTelegramMessage(chatId, `⚠️ Ye note/PDF nahi mila: <b>${escapeHtml(titleToDelete)}</b>`);
    }
    return true;
  }

  return false;
}
async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data || "";
  const user = getUser(chatId);

  if (TELEGRAM_API) {
    try {
      await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
        callback_query_id: callbackQuery.id
      });
    } catch (_) {}
  }

  if (data === "main_menu") {
    return showMainMenu(chatId, user);
  }

  if (data.startsWith("cat_")) {
    const cIdx = parseInt(data.replace("cat_", ""), 10);
    return showCoursesMenu(chatId, user, cIdx);
  }

  if (data.startsWith("crs_")) {
    const [, cIdx, sIdx] = data.split("_").map(Number);
    return showYearsMenu(chatId, user, cIdx, sIdx);
  }

  if (data.startsWith("yr_")) {
    const [, cIdx, sIdx, yIdx] = data.split("_").map(Number);
    return showSemestersMenu(chatId, user, cIdx, sIdx, yIdx);
  }

  if (data.startsWith("sem_")) {
    const [, cIdx, sIdx, yIdx, mIdx] = data.split("_").map(Number);
    return showSubjectsMenu(chatId, user, cIdx, sIdx, yIdx, mIdx);
  }

  if (data.startsWith("sub_")) {
    const [, cIdx, sIdx, yIdx, mIdx, subIdx] = data.split("_").map(Number);
    return showUnitsMenu(chatId, user, cIdx, sIdx, yIdx, mIdx, subIdx);
  }

  if (data.startsWith("unt_")) {
    const [, cIdx, sIdx, yIdx, mIdx, subIdx, uIdx] = data.split("_").map(Number);
    return showUnitActionsMenu(chatId, user, cIdx, sIdx, yIdx, mIdx, subIdx, uIdx);
  }

  if (data.startsWith("mfull_")) {
    const [, cIdx, sIdx, yIdx, mIdx, subIdx] = data.split("_").map(Number);
    const catName = getCategoryList()[cIdx];
    const courseName = getCoursesForCategory(catName)[sIdx];
    const yearName = getYearsForCourse(catName, courseName)[yIdx];
    const semName = getSemestersForYear(catName, courseName, yearName)[mIdx];
    const subjectName = getSubjectsForCurrentContext({
      selectedCategory: catName,
      selectedCourse: courseName,
      selectedYear: yearName,
      selectedSemester: semName
    })[subIdx];

    return startMockTest(chatId, "full", courseName, yearName, semName, subjectName, "All Units");
  }

  if (data.startsWith("act_")) {
    const parts = data.split("_");
    const actionType = parts[1];
    const [cIdx, sIdx, yIdx, mIdx, subIdx, uIdx] = parts.slice(2).map(Number);

    const catName = getCategoryList()[cIdx];
    const courseName = getCoursesForCategory(catName)[sIdx];
    const yearName = getYearsForCourse(catName, courseName)[yIdx];
    const semName = getSemestersForYear(catName, courseName, yearName)[mIdx];
    const ctxUser = {
      selectedCategory: catName,
      selectedCourse: courseName,
      selectedYear: yearName,
      selectedSemester: semName
    };
    const subjectName = getSubjectsForCurrentContext(ctxUser)[subIdx];
    const unitName = getUnitsForSubject(ctxUser, subjectName)[uIdx];

    if (actionType === "notes") {
      await sendTelegramMessage(
        chatId,
        `📖 <b>Detailed Notes Taiyar Ho Rahe Hain...</b>\n` +
          `📘 <b>${escapeHtml(subjectName)}</b> — <b>${escapeHtml(unitName)}</b>\n\nGoogle Search + PCI syllabus se notes generate kiye ja rahe hain...`
      );
      const notesText = await generateDetailedNotes(courseName, yearName, semName, subjectName, unitName);
      await sendLongMessage(
        chatId,
        `📚 <b>DETAILED NOTES: ${escapeHtml(subjectName)} (${escapeHtml(unitName)})</b>\n\n${escapeHtml(notesText)}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
          }
        }
      );
      return;
    }

    if (actionType === "pyq") {
      await sendTelegramMessage(
        chatId,
        `📜 <b>PYQ Questions Fetch Ho Rahe Hain...</b>\n` +
          `📘 <b>${escapeHtml(subjectName)}</b> — <b>${escapeHtml(unitName)}</b>`
      );
      const pyqText = await generatePYQs(courseName, yearName, semName, subjectName, unitName);
      await sendLongMessage(
        chatId,
        `📜 <b>PREVIOUS YEAR QUESTIONS: ${escapeHtml(subjectName)} (${escapeHtml(unitName)})</b>\n\n${escapeHtml(pyqText)}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
          }
        }
      );
      return;
    }

    if (actionType === "munit") {
      return startMockTest(chatId, "unit", courseName, yearName, semName, subjectName, unitName);
    }

    if (actionType === "mfull") {
      return startMockTest(chatId, "full", courseName, yearName, semName, subjectName, "All Units");
    }
  }

  if (data === "mock_time_left") {
    const session = activeTests[chatId];
    if (!session) {
      await sendTelegramMessage(chatId, "⚠️ Koi active Mock Test nahi chal raha hai.");
      return;
    }
    const remMs = Math.max(0, session.endTime - Date.now());
    const remMins = Math.floor(remMs / 60000);
    const remSecs = Math.floor((remMs % 60000) / 1000);
    await sendTelegramMessage(
      chatId,
      `⏱️ <b>Remaining Time:</b> ${remMins} minute(s) ${remSecs} second(s)`
    );
    return;
  }

  if (data === "mock_submit") {
    return finishMockTest(chatId, false);
  }
}
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || "").trim();
  const user = getUser(chatId);

  if (!text) return;

  if (text === "/start" || text === "/menu") {
    return showMainMenu(chatId, user);
  }

  const handledDelete = await handleDeleteCommands(chatId, userId, text);
  if (handledDelete) return;

  const handledAdmin = await handleAdminCommand(chatId, userId, text);
  if (handledAdmin) return;

  if (activeTests[chatId]) {
    await sendTelegramMessage(
      chatId,
      "✍️ Aapka answer note kar liya gaya hai. Jab test poora ho jaye toh <b>Submit Test & Answer Key</b> button dabayein."
    );
  }
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
    console.error("Webhook Handling Error:", err.message);
  }
});
app.get("/", (req, res) => {
  res.status(200).send("Study Material & AI Mock Test Bot Server is Running.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
