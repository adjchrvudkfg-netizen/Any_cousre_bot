const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const app = express();
app.use(express.json());

const TOKEN = config.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const ADMIN_IDS = new Set([
  8805135936,
  ...(config.ADMIN_IDS || process.env.ADMIN_IDS || '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => !Number.isNaN(id) && id > 0)
]);
const SUPPORT_CHANNEL = config.SUPPORT_CHANNEL || process.env.SUPPORT_CHANNEL || "https://t.me/adityachoudhary5";

const dbFilePath = path.join(__dirname, 'study_material_db.json');

const ALLOWED_STUDY_TYPES = [
  "Syllabus",
  "Hand Written Notes",
  "PYQ Question",
  "MCQ Question",
  "Mock Test",
  "AI Assistant",
  "Revision Notes"
];

const MAIN_MENU_BUTTONS = [
  ["Syllabus", "Hand Written Notes"],
  ["PYQ Question", "MCQ Question"],
  ["Mock Test", "AI Assistant"],
  ["Revision Notes", "Admit Cards Link"],
  ["Result Link"]
];

const CATEGORIES = {
  "Pharmacy": ["B.Pharma", "D.Pharma"],
  "CET": ["CET 12th Level", "CET Graduation Level"],
  "12th": ["Science", "Commerce", "Arts"],
  "SSC": ["SSC GD", "SSC CHSL", "SSC CGL", "SSC MTS"],
  "Railway": ["RRB NTPC", "RRB Group D", "RRB ALP", "RRB JE"],
  "Air Force": ["Group X (Science)", "Group Y (Non-Tech)", "Agniveer Vayu"],
  "Army": ["Agniveer GD", "Agniveer Technical", "Nursing Assistant", "Clerk / SKT"],
  "Navy": ["Agniveer SSR", "Agniveer MR"]
};

const CATEGORY_LIST = Object.keys(CATEGORIES);

const DEFAULT_YEARS_BY_COURSE = {
  "B.Pharma": ["1st Year", "2nd Year", "3rd Year", "4th Year"],
  "D.Pharma": ["1st Year", "2nd Year"]
};

const DEFAULT_SEMESTERS_BY_YEAR = {
  "B.Pharma": {
    "1st Year": ["Semester 1", "Semester 2"],
    "2nd Year": ["Semester 3", "Semester 4"],
    "3rd Year": ["Semester 5", "Semester 6"],
    "4th Year": ["Semester 7", "Semester 8"]
  },
  "D.Pharma": {
    "1st Year": ["Year 1 Syllabus"],
    "2nd Year": ["Year 2 Syllabus"]
  }
};

const DEFAULT_DIRECT_SEMESTERS_BY_COURSE = {
  "CET 12th Level": ["Semester 1", "Semester 2"],
  "CET Graduation Level": ["Semester 1", "Semester 2"],
  "Science": ["Semester 1", "Semester 2"],
  "Commerce": ["Semester 1", "Semester 2"],
  "Arts": ["Semester 1", "Semester 2"],
  "SSC GD": ["Part 1", "Part 2"],
  "SSC CHSL": ["Tier 1", "Tier 2"],
  "SSC CGL": ["Tier 1", "Tier 2"],
  "SSC MTS": ["Session 1", "Session 2"],
  "RRB NTPC": ["CBT 1", "CBT 2"],
  "RRB Group D": ["Stage 1"],
  "RRB ALP": ["CBT 1", "CBT 2"],
  "RRB JE": ["CBT 1", "CBT 2"],
  "Group X (Science)": ["Phase 1"],
  "Group Y (Non-Tech)": ["Phase 1"],
  "Agniveer Vayu": ["Phase 1"],
  "Agniveer GD": ["Phase 1"],
  "Agniveer Technical": ["Phase 1"],
  "Nursing Assistant": ["Phase 1"],
  "Clerk / SKT": ["Phase 1"],
  "Agniveer SSR": ["Stage 1"],
  "Agniveer MR": ["Stage 1"]
};

let studyDb = {
  // Structure: materials[category][course][periodKey][studyType][unitName] = { chapters: { [chapterName]: [pdfObj] } }
  materials: {},
  customYears: {},
  customSemesters: {},
  links: {
    admitCards: {},
    results: {}
  },
  users: {}
};

// =====================================
// AUTOMATIC BUTTON COLOR SYSTEM
// =====================================

axios.interceptors.request.use((request) => {
  try {
    const data = request.data;

    if (
      data &&
      typeof data === "object" &&
      data.reply_markup &&
      Array.isArray(data.reply_markup.inline_keyboard)
    ) {
      data.reply_markup.inline_keyboard =
        data.reply_markup.inline_keyboard.map((row) =>
          row.map((button) => {
            const text = button.text || "";
            const callback = button.callback_data || "";
            let style = "success";

            if (text.includes("Syllabus") || text.includes("Hand Written Notes") || text.includes("Year") || text.includes("Semester")) {
              style = "primary";
            } else if (text.includes("Back") || text.includes("Main Menu")) {
              style = "danger";
            } else if (callback.startsWith("yr_") || callback.startsWith("sem_") || callback.startsWith("unit_")) {
              style = "success";
            }

            return { ...button, style };
          })
        );
    }
  } catch (error) {
    console.log("Button color error:", error.message);
  }

  return request;
});

function saveData() {
  try {
    fs.writeFileSync(dbFilePath, JSON.stringify(studyDb, null, 2), 'utf8');
  } catch (e) {
    console.log("❌ Error saving database:", e.message);
  }
}

try {
  if (fs.existsSync(dbFilePath)) {
    const raw = fs.readFileSync(dbFilePath, 'utf8');
    if (raw && raw.trim().length > 0) {
      const parsed = JSON.parse(raw);
      if (parsed.materials) studyDb.materials = parsed.materials;
      if (parsed.customYears) studyDb.customYears = parsed.customYears;
      if (parsed.customSemesters) studyDb.customSemesters = parsed.customSemesters;
      if (parsed.links) {
        studyDb.links = {
          admitCards: parsed.links.admitCards || {},
          results: parsed.links.results || {}
        };
      }
      if (parsed.users) studyDb.users = parsed.users;
      console.log("✅ Study Material database loaded successfully!");
    }
  } else {
    saveData();
  }
} catch (e) {
  console.log("⚠️ Error loading database, using default:", e.message);
}

function isAdmin(userId) {
  return ADMIN_IDS.has(Number(userId));
}

function getUser(userId, firstName) {
  if (!studyDb.users[userId]) {
    studyDb.users[userId] = {
      id: userId,
      name: firstName || "Student",
      selectedType: null,
      selectedCategory: null,
      selectedStream: null,
      selectedYear: null,
      selectedSemester: null,
      adminUploadFlow: null
    };
    saveData();
  } else if (firstName) {
    studyDb.users[userId].name = firstName;
  }
  return studyDb.users[userId];
}

function getYearsForCourse(category, course) {
  const key = `${category}::${course}`;
  const baseYears = DEFAULT_YEARS_BY_COURSE[course] || [];
  const extraYears = studyDb.customYears[key] || [];
  const merged = [...baseYears];

  for (const yr of extraYears) {
    if (!merged.includes(yr)) merged.push(yr);
  }

  return merged;
}

function getSemestersForCourse(category, course, yearName = null) {
  const key = yearName
    ? `${category}::${course}::${yearName}`
    : `${category}::${course}`;

  let baseSems = [];
  if (yearName && DEFAULT_SEMESTERS_BY_YEAR[course] && DEFAULT_SEMESTERS_BY_YEAR[course][yearName]) {
    baseSems = [...DEFAULT_SEMESTERS_BY_YEAR[course][yearName]];
  } else if (!yearName && DEFAULT_DIRECT_SEMESTERS_BY_COURSE[course]) {
    baseSems = [...DEFAULT_DIRECT_SEMESTERS_BY_COURSE[course]];
  } else if (!yearName && !DEFAULT_YEARS_BY_COURSE[course]) {
    baseSems = ["Semester 1", "Semester 2"];
  }

  const extraSems = studyDb.customSemesters[key] || [];
  const merged = [...baseSems];

  const storagePeriodKey = yearName ? `${yearName} > ...` : null;
  if (!storagePeriodKey && studyDb.materials[category] && studyDb.materials[category][course]) {
    for (const semKey of Object.keys(studyDb.materials[category][course])) {
      if (!semKey.includes(" > ") && !merged.includes(semKey)) {
        merged.push(semKey);
      }
    }
  } else if (yearName && studyDb.materials[category] && studyDb.materials[category][course]) {
    const prefix = `${yearName} > `;
    for (const fullKey of Object.keys(studyDb.materials[category][course])) {
      if (fullKey.startsWith(prefix)) {
        const semOnly = fullKey.slice(prefix.length);
        if (!merged.includes(semOnly)) merged.push(semOnly);
      }
    }
  }

  for (const semName of extraSems) {
    if (!merged.includes(semName)) merged.push(semName);
  }

  return merged;
}

function buildPeriodStorageKey(yearName, semesterName) {
  return yearName ? `${yearName} > ${semesterName}` : semesterName;
}

function ensurePeriod(category, course, periodKey, createIfMissing = false) {
  if (!studyDb.materials[category]) {
    if (!createIfMissing) return null;
    studyDb.materials[category] = {};
  }
  if (!studyDb.materials[category][course]) {
    if (!createIfMissing) return null;
    studyDb.materials[category][course] = {};
  }
  if (!studyDb.materials[category][course][periodKey]) {
    if (!createIfMissing) return null;
    studyDb.materials[category][course][periodKey] = {};
  }
  return studyDb.materials[category][course][periodKey];
}

function getUnitBucket(category, course, periodKey, studyType, createIfMissing = false) {
  const periodObj = ensurePeriod(category, course, periodKey, createIfMissing);
  if (!periodObj) return null;

  if (!periodObj[studyType]) {
    if (!createIfMissing) return null;
    periodObj[studyType] = { units: {} };
  }
  if (!periodObj[studyType].units) {
    periodObj[studyType].units = {};
  }
  return periodObj[studyType];
}

function getMainMenuMarkup(user) {
  const roleLabel = isAdmin(user.id) ? "Admin" : "Student";

  const welcomeText =
`🌸 - <b>STUDY MATERIAL BOT</b> - 🌸

👤 Hello, <code>${user.name}</code> !

📚 <b>Your Complete Study Assistant</b>

➖ 📖 <b>Syllabus</b>
➖ ✍️ <b>Hand Written Notes</b>
➖ 📝 <b>PYQ Question</b>
➖ 🧠 <b>MCQ Question</b>
➖ 🎯 <b>Mock Test</b>
➖ 🤖 <b>AI Assistant</b>
➖ 🔄 <b>Revision Notes</b>
➖ 🪪 <b>Admit Cards Link & 📊 Result Link</b>

──────────────────────
👤 <b>User ID:</b> ${user.id}
🎖️ <b>Access:</b> ${roleLabel}
──────────────────────

<i>Tap any button below to begin.</i>`;

  const inline_keyboard = MAIN_MENU_BUTTONS.map((row) =>
    row.map((label) => {
      const idx = ALLOWED_STUDY_TYPES.includes(label)
        ? ALLOWED_STUDY_TYPES.indexOf(label)
        : label === "Admit Cards Link"
          ? 100
          : 101;
      return {
        text: label,
        callback_data: `type_${idx}`
      };
    })
  );

  return { resText: welcomeText, reply_markup: { inline_keyboard } };
}

function getAiAssistantReply(questionText, user) {
  const scope = [
    user.selectedCategory,
    user.selectedStream,
    user.selectedYear,
    user.selectedSemester,
    user.selectedType
  ]
    .filter(Boolean)
    .join(" > ");

  if (user.selectedType === "Hand Written Notes") {
    return (
`✍️ <b>HAND WRITTEN NOTES — QUICK NOTEBOOK SUMMARY</b>

📌 <b>Scope:</b> <code>${scope || "Hand Written Notes"}</code>
📖 <b>Topic:</b> <b>${questionText}</b>

📝 <b>Key Points (Notebook Style):</b>
• <b>Concept / Definition:</b> ${questionText} ko short aur exam-ready points mein samjhein.
• <b>Important Points / Rules:</b> Main headings, steps, formulas, ya examples note karein.
• <b>Full Handwritten Notes:</b> Complete notes ke liye <b>Hand Written Notes</b> section mein Course &gt; Year/Semester &gt; Unit &gt; Topic open karein.`
    );
  }

  return (
`🤖 <b>STUDY MATERIAL AI ASSISTANT</b>

📌 <b>Scope:</b> <code>${scope || "General Study"}</code>
❓ <b>Topic / Doubt:</b> ${questionText}

💡 <b>Study Tip:</b> Pehle is topic ka Syllabus aur Revision Notes dekhein, uske baad PYQ aur MCQ practice karein.
📄 Official PDFs / Notes ke liye <b>Syllabus</b>, <b>Hand Written Notes</b>, <b>PYQ Question</b>, <b>MCQ Question</b>, <b>Mock Test</b>, ya <b>Revision Notes</b> section open karein.`
  );
}

app.get('/', (req, res) => {
  res.status(200).send('STUDY MATERIAL BOT server is running.');
});
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;

  try {
    if (update.message) {
      const chatId = update.message.chat.id;
      const from = update.message.from;
      const text = (update.message.text || "").trim();
      const user = getUser(from.id, from.first_name);

      // Strict PDF upload: Sirf Admin PDF add kar sakta hai
      if (update.message.document) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "🚫 <b>Permission Denied:</b> Sirf Admin hi PDF ya study material add kar sakta hai.",
            parse_mode: "HTML"
          });
          return;
        }

        const flow = user.adminUploadFlow;
        if (!flow || flow.step !== "WAITING_PDF") {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "ℹ️ Pehle <code>/add_pdf</code> command bhejein, phir PDF file upload karein.",
            parse_mode: "HTML"
          });
          return;
        }

        const doc = update.message.document;
        const isPdf =
          doc.mime_type === "application/pdf" ||
          (doc.file_name && doc.file_name.toLowerCase().endsWith(".pdf"));

        if (!isPdf) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Kripya sirf <b>PDF</b> file hi bhejein.",
            parse_mode: "HTML"
          });
          return;
        }

        const bucket = getUnitBucket(flow.category, flow.course, flow.periodKey, flow.studyType, true);
        if (!bucket.units[flow.unitName]) {
          bucket.units[flow.unitName] = { chapters: {} };
        }
        if (!bucket.units[flow.unitName].chapters[flow.chapterName]) {
          bucket.units[flow.unitName].chapters[flow.chapterName] = [];
        }

        bucket.units[flow.unitName].chapters[flow.chapterName].push({
          title: flow.title,
          fileId: doc.file_id,
          fileName: doc.file_name || `${flow.title}.pdf`,
          addedBy: from.id,
          addedAt: new Date().toISOString()
        });

        user.adminUploadFlow = null;
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text:
`✅ <b>Material / PDF Added!</b>

📚 <b>Module:</b> ${flow.studyType}
🎓 <b>Category / Course:</b> ${flow.category} > ${flow.course}
🗓️ <b>Period:</b> ${flow.periodKey}
📂 <b>Unit:</b> ${flow.unitName}
📘 <b>Topic / Chapter:</b> ${flow.chapterName}
📄 <b>Title:</b> <code>${flow.title}</code>`,
          parse_mode: "HTML"
        });
        return;
      }

      if (text.startsWith('/start')) {
        user.selectedType = null;
        user.selectedCategory = null;
        user.selectedStream = null;
        user.selectedYear = null;
        user.selectedSemester = null;
        user.adminUploadFlow = null;
        saveData();

        const menu = getMainMenuMarkup(user);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: menu.resText,
          parse_mode: "HTML",
          reply_markup: menu.reply_markup
        });
      }
      else if (text.startsWith('/cancel')) {
        user.adminUploadFlow = null;
        saveData();
        const menu = getMainMenuMarkup(user);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: "❌ Action cancelled.",
          reply_markup: menu.reply_markup
        });
      }
      // ADMIN ONLY: /add_year Category | Course | YearName
      else if (text.startsWith('/add_year')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi year add kar sakta hai." });
          return;
        }
        const parts = text.replace('/add_year', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 3) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_year Category | Course | YearName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearName] = parts;
        const key = `${category}::${course}`;
        if (!studyDb.customYears[key]) studyDb.customYears[key] = [];
        if (!studyDb.customYears[key].includes(yearName)) studyDb.customYears[key].push(yearName);
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Year Added!</b>\n${category} > ${course} > <b>${yearName}</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_year Category | Course | YearName
      else if (text.startsWith('/remove_year')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi year remove kar sakta hai." });
          return;
        }
        const parts = text.replace('/remove_year', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 3) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_year Category | Course | YearName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearName] = parts;
        const key = `${category}::${course}`;
        if (studyDb.customYears[key]) {
          studyDb.customYears[key] = studyDb.customYears[key].filter((y) => y !== yearName);
        }
        if (studyDb.materials[category] && studyDb.materials[category][course]) {
          for (const pKey of Object.keys(studyDb.materials[category][course])) {
            if (pKey === yearName || pKey.startsWith(`${yearName} > `)) {
              delete studyDb.materials[category][course][pKey];
            }
          }
        }
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🗑️ Year <b>${yearName}</b> removed for ${category} > ${course}.`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /add_semester Category | Course | YearOrNone | SemesterName
      else if (text.startsWith('/add_semester')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi semester add kar sakta hai." });
          return;
        }
        const parts = text.replace('/add_semester', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 4) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_semester Category | Course | YearName (or -) | SemesterName</code>\nExample: <code>/add_semester Pharmacy | B.Pharma | 1st Year | Semester 1</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semesterName] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const semKey = yearName ? `${category}::${course}::${yearName}` : `${category}::${course}`;
        if (!studyDb.customSemesters[semKey]) studyDb.customSemesters[semKey] = [];
        if (!studyDb.customSemesters[semKey].includes(semesterName)) {
          studyDb.customSemesters[semKey].push(semesterName);
        }
        const periodKey = buildPeriodStorageKey(yearName, semesterName);
        ensurePeriod(category, course, periodKey, true);
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Semester Added!</b>\n${category} > ${course} > <b>${periodKey}</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_semester Category | Course | YearOrNone | SemesterName
      else if (text.startsWith('/remove_semester')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi semester remove kar sakta hai." });
          return;
        }
        const parts = text.replace('/remove_semester', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 4) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_semester Category | Course | YearName (or -) | SemesterName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semesterName] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const semKey = yearName ? `${category}::${course}::${yearName}` : `${category}::${course}`;
        if (studyDb.customSemesters[semKey]) {
          studyDb.customSemesters[semKey] = studyDb.customSemesters[semKey].filter((s) => s !== semesterName);
        }
        const periodKey = buildPeriodStorageKey(yearName, semesterName);
        if (studyDb.materials[category] && studyDb.materials[category][course]) {
          delete studyDb.materials[category][course][periodKey];
        }
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🗑️ Semester <b>${periodKey}</b> removed.`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /add_unit Category | Course | YearOrNone | Semester | StudyType | UnitName
      else if (text.startsWith('/add_unit')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi unit add kar sakta hai." });
          return;
        }
        const parts = text.replace('/add_unit', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 6) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_unit Category | Course | YearName (or -) | Semester | StudyType | UnitName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, studyType, unitName] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        const bucket = getUnitBucket(category, course, periodKey, studyType, true);
        if (!bucket.units[unitName]) {
          bucket.units[unitName] = { chapters: {} };
        }
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Unit Added!</b>\n${category} > ${course} > ${periodKey} > ${studyType}\nUnit: <b>${unitName}</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_unit Category | Course | YearOrNone | Semester | StudyType | UnitName
      else if (text.startsWith('/remove_unit')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi unit remove kar sakta hai." });
          return;
        }
        const parts = text.replace('/remove_unit', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 6) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_unit Category | Course | YearName (or -) | Semester | StudyType | UnitName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, studyType, unitName] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        const bucket = getUnitBucket(category, course, periodKey, studyType, false);
        const existed = !!(bucket && bucket.units && bucket.units[unitName]);
        if (existed) {
          delete bucket.units[unitName];
          saveData();
        }
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: existed
            ? `🗑️ Unit <b>${unitName}</b> removed!`
            : `⚠️ Unit <b>${unitName}</b> nahi mili.`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /add_chapter Category | Course | YearOrNone | Semester | StudyType | UnitName | ChapterName
      else if (text.startsWith('/add_chapter')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi chapter/material add kar sakta hai." });
          return;
        }
        const parts = text.replace('/add_chapter', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_chapter Category | Course | YearName (or -) | Semester | StudyType | UnitName | ChapterName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, studyType, unitName, chapterName] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        const bucket = getUnitBucket(category, course, periodKey, studyType, true);
        if (!bucket.units[unitName]) {
          bucket.units[unitName] = { chapters: {} };
        }
        if (!bucket.units[unitName].chapters[chapterName]) {
          bucket.units[unitName].chapters[chapterName] = [];
        }
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Chapter / Syllabus Section Added!</b>\n${category} > ${course} > ${periodKey} > ${studyType}\nUnit: <b>${unitName}</b>\nTopic: <b>${chapterName}</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_chapter Category | Course | YearOrNone | Semester | StudyType | UnitName | ChapterName
      else if (text.startsWith('/remove_chapter')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi chapter/material remove kar sakta hai." });
          return;
        }
        const parts = text.replace('/remove_chapter', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_chapter Category | Course | YearName (or -) | Semester | StudyType | UnitName | ChapterName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, studyType, unitName, chapterName] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        const bucket = getUnitBucket(category, course, periodKey, studyType, false);
        const existed = !!(
          bucket &&
          bucket.units &&
          bucket.units[unitName] &&
          bucket.units[unitName].chapters &&
          bucket.units[unitName].chapters[chapterName]
        );
        if (existed) {
          delete bucket.units[unitName].chapters[chapterName];
          saveData();
        }
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: existed
            ? `🗑️ Chapter / Syllabus Section <b>${chapterName}</b> removed!`
            : `⚠️ Chapter / Syllabus Section <b>${chapterName}</b> nahi mila.`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /add_pdf Category | Course | YearOrNone | Semester | StudyType | UnitName | ChapterName | PDF Title
      else if (text.startsWith('/add_pdf')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi PDF add kar sakta hai." });
          return;
        }
        const parts = text.replace('/add_pdf', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 8) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_pdf Category | Course | YearName (or -) | Semester | StudyType | UnitName | ChapterName | PDF Title</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, studyType, unitName, chapterName, title] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        user.adminUploadFlow = {
          step: "WAITING_PDF",
          category,
          course,
          periodKey,
          studyType,
          unitName,
          chapterName,
          title
        };
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📎 Ab <b>${title}</b> ke liye PDF bhejein.\nTarget: ${category} > ${course} > ${periodKey} > ${studyType} > ${unitName} > ${chapterName}`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_pdf Category | Course | YearOrNone | Semester | StudyType | UnitName | ChapterName | PDF Title
      else if (text.startsWith('/remove_pdf')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi PDF remove kar sakta hai." });
          return;
        }
        const parts = text.replace('/remove_pdf', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 8) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_pdf Category | Course | YearName (or -) | Semester | StudyType | UnitName | ChapterName | PDF Title</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, studyType, unitName, chapterName, title] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        const bucket = getUnitBucket(category, course, periodKey, studyType, false);
        const list = bucket && bucket.units[unitName] && bucket.units[unitName].chapters[chapterName];
        let removedCount = 0;
        if (Array.isArray(list)) {
          const beforeLen = list.length;
          bucket.units[unitName].chapters[chapterName] = list.filter((p) => p.title !== title);
          removedCount = beforeLen - bucket.units[unitName].chapters[chapterName].length;
          if (removedCount > 0) saveData();
        }
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: removedCount > 0
            ? `🗑️ Removed <b>${removedCount}</b> PDF titled <code>${title}</code>.`
            : `⚠️ PDF <code>${title}</code> nahi mili.`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/set_admit_link')) {
        if (!isAdmin(from.id)) return;
        const [category, course, label, url] = text.replace('/set_admit_link', '').trim().split('|').map((s) => s.trim());
        if (!category || !course || !label || !url) return;
        const key = `${category}::${course}`;
        if (!studyDb.links.admitCards[key]) studyDb.links.admitCards[key] = [];
        studyDb.links.admitCards[key].push({ label, url });
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "✅ Admit Card link added!" });
      }
      else if (text.startsWith('/remove_admit_link')) {
        if (!isAdmin(from.id)) return;
        const [category, course, label] = text.replace('/remove_admit_link', '').trim().split('|').map((s) => s.trim());
        const key = `${category}::${course}`;
        if (studyDb.links.admitCards[key]) {
          studyDb.links.admitCards[key] = studyDb.links.admitCards[key].filter((item) => item.label !== label);
          saveData();
        }
        await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "🗑️ Admit Card link removed!" });
      }
      else if (text.startsWith('/set_result_link')) {
        if (!isAdmin(from.id)) return;
        const [category, course, label, url] = text.replace('/set_result_link', '').trim().split('|').map((s) => s.trim());
        if (!category || !course || !label || !url) return;
        const key = `${category}::${course}`;
        if (!studyDb.links.results[key]) studyDb.links.results[key] = [];
        studyDb.links.results[key].push({ label, url });
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "✅ Result link added!" });
      }
      else if (text.startsWith('/remove_result_link')) {
        if (!isAdmin(from.id)) return;
        const [category, course, label] = text.replace('/remove_result_link', '').trim().split('|').map((s) => s.trim());
        const key = `${category}::${course}`;
        if (studyDb.links.results[key]) {
          studyDb.links.results[key] = studyDb.links.results[key].filter((item) => item.label !== label);
          saveData();
        }
        await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "🗑️ Result link removed!" });
      }
      else if (text.startsWith('/addupdate')) {
        if (!isAdmin(from.id)) return;
        const updateMsg = text.replace('/addupdate', '').trim();
        for (const uid in studyDb.users) {
          try {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: uid,
              text: `📢 <b>STUDY MATERIAL BOT UPDATE</b>\n\n${updateMsg}`,
              parse_mode: "HTML"
            });
          } catch (e) {}
        }
        await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "✅ Broadcast sent!" });
      }
      else if (user.selectedType === "AI Assistant" && text.length > 0) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: getAiAssistantReply(text, user),
          parse_mode: "HTML"
        });
      }
    }
    else if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;
      const data = cq.data || "";
      const from = cq.from;
      const user = getUser(from.id, from.first_name);

      const deletePrevMessage = async () => {
        try {
          await axios.post(`${TELEGRAM_API}/deleteMessage`, { chat_id: chatId, message_id: messageId });
        } catch (e) {}
      };

      if (data === "main_menu") {
        await deletePrevMessage();
        const menu = getMainMenuMarkup(user);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: menu.resText,
          parse_mode: "HTML",
          reply_markup: menu.reply_markup
        });
      }
      // Step 1: Study Type (e.g., Syllabus) -> Show Categories
      else if (data.startsWith("type_")) {
        const idx = parseInt(data.replace("type_", ""), 10);
        const typeName =
          idx === 100
            ? "Admit Cards Link"
            : idx === 101
              ? "Result Link"
              : ALLOWED_STUDY_TYPES[idx];

        if (!typeName) return;
        user.selectedType = typeName;
        user.selectedCategory = null;
        user.selectedStream = null;
        user.selectedYear = null;
        user.selectedSemester = null;
        saveData();

        await deletePrevMessage();
        const catButtons = CATEGORY_LIST.map((catName, cIdx) => [
          { text: `🎓 ${catName}`, callback_data: `cat_${cIdx}` }
        ]);
        catButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📚 <b>${typeName.toUpperCase()}</b>\n\nCategory chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: catButtons }
        });
      }
      // Step 2: Category -> Show Courses
      else if (data.startsWith("cat_")) {
        const cIdx = parseInt(data.replace("cat_", ""), 10);
        const catName = CATEGORY_LIST[cIdx];
        const courses = CATEGORIES[catName] || [];
        user.selectedCategory = catName;
        user.selectedStream = null;
        user.selectedYear = null;
        user.selectedSemester = null;
        saveData();

        await deletePrevMessage();
        const courseButtons = courses.map((courseName, sIdx) => [
          { text: `📘 ${courseName}`, callback_data: `str_${cIdx}_${sIdx}` }
        ]);
        courseButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `⚡ <b>${catName.toUpperCase()} — ${user.selectedType}</b>\n\nApna <b>Course</b> chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: courseButtons }
        });
      }
      // Step 3: Course selected -> If Years exist, show Years; otherwise show Semesters directly
      else if (data.startsWith("str_")) {
        const [, cIdxStr, sIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const catName = CATEGORY_LIST[cIdx];
        const courseName = (CATEGORIES[catName] || [])[sIdx];
        const studyType = user.selectedType || "Syllabus";

        user.selectedCategory = catName;
        user.selectedStream = courseName;
        user.selectedYear = null;
        user.selectedSemester = null;
        saveData();

        await deletePrevMessage();

        if (studyType === "Admit Cards Link" || studyType === "Result Link") {
          const key = `${catName}::${courseName}`;
          const list =
            studyType === "Admit Cards Link"
              ? (studyDb.links.admitCards[key] || [])
              : (studyDb.links.results[key] || []);
          const body =
            list.length === 0
              ? `Abhi is course ka ${studyType} update nahi hua hai.`
              : list.map((l, i) => `${i + 1}. <a href="${l.url}">${l.label}</a>`).join("\n");

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🔗 <b>${studyType} — ${catName} (${courseName})</b>\n\n${body}`,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [{ text: "📞 Support", url: SUPPORT_CHANNEL }],
                [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
              ]
            }
          });
          return;
        }

        const years = getYearsForCourse(catName, courseName);

        // Agar Years available hain (jaise B.Pharma / D.Pharma): pehle Years dikhayein
        if (years.length > 0) {
          const yearButtons = years.map((yrName, yIdx) => [
            { text: `📅 ${yrName}`, callback_data: `yr_${cIdx}_${sIdx}_${yIdx}` }
          ]);
          yearButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🎓 <b>${courseName} — ${studyType}</b>\n\nApna <b>Year</b> chunein:`,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: yearButtons }
          });
          return;
        }

        // Agar Years nahi hain: seedha Semesters dikhayein
        const sems = getSemestersForCourse(catName, courseName, null);
        const semButtons = sems.map((semName, semIdx) => [
          { text: `🗓️ ${semName}`, callback_data: `sem_${cIdx}_${sIdx}_n_${semIdx}` }
        ]);
        semButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🎓 <b>${courseName} — ${studyType}</b>\n\nApna <b>Semester</b> chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: semButtons }
        });
      }
      // Step 3B: Year selected -> Show Semesters inside that Year
      else if (data.startsWith("yr_")) {
        const [, cIdxStr, sIdxStr, yIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const yIdx = parseInt(yIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const courseName = CATEGORIES[catName][sIdx];
        const years = getYearsForCourse(catName, courseName);
        const yearName = years[yIdx];
        const studyType = user.selectedType || "Syllabus";

        user.selectedCategory = catName;
        user.selectedStream = courseName;
        user.selectedYear = yearName;
        user.selectedSemester = null;
        saveData();

        await deletePrevMessage();

        const sems = getSemestersForCourse(catName, courseName, yearName);
        const semButtons = sems.map((semName, semIdx) => [
          { text: `🗓️ ${semName}`, callback_data: `sem_${cIdx}_${sIdx}_${yIdx}_${semIdx}` }
        ]);
        semButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🎓 <b>${courseName} — ${yearName}</b>\n📚 Module: <b>${studyType}</b>\n\nApna <b>Semester</b> chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: semButtons }
        });
      }
      // Step 4: Semester selected -> Show Syllabus / Units inside that Semester
      else if (data.startsWith("sem_")) {
        const [, cIdxStr, sIdxStr, yPart, semIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const courseName = CATEGORIES[catName][sIdx];
        const yearName = yPart === "n" ? null : getYearsForCourse(catName, courseName)[parseInt(yPart, 10)];
        const sems = getSemestersForCourse(catName, courseName, yearName);
        const semName = sems[semIdx];
        const studyType = user.selectedType || "Syllabus";
        const periodKey = buildPeriodStorageKey(yearName, semName);

        user.selectedCategory = catName;
        user.selectedStream = courseName;
        user.selectedYear = yearName;
        user.selectedSemester = semName;
        saveData();

        await deletePrevMessage();

        if (studyType === "AI Assistant") {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🤖 <b>AI Assistant Ready</b>\n\nScope: <b>${courseName} > ${periodKey}</b>\nApna topic ya question abhi type karke bhejein!`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const tIdx = ALLOWED_STUDY_TYPES.indexOf(studyType);
        const bucket = getUnitBucket(catName, courseName, periodKey, studyType, false);
        const units = bucket ? Object.keys(bucket.units) : [];

        if (units.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📖 <b>${courseName} > ${periodKey} — ${studyType}</b>\n\nIs semester mein abhi koi ${studyType} unit add nahi hui hai.`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const unitButtons = units.map((unitName, uIdx) => [
          { text: `📂 ${unitName}`, callback_data: `unit_${cIdx}_${sIdx}_${yPart}_${semIdx}_${tIdx}_${uIdx}` }
        ]);
        unitButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📖 <b>${courseName} — ${periodKey} (${studyType})</b>\n\nSyllabus Unit chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: unitButtons }
        });
      }
      // Step 5: Unit selected -> Show Chapters / Syllabus Topics
      else if (data.startsWith("unit_")) {
        const [, cIdxStr, sIdxStr, yPart, semIdxStr, tIdxStr, uIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const courseName = CATEGORIES[catName][sIdx];
        const yearName = yPart === "n" ? null : getYearsForCourse(catName, courseName)[parseInt(yPart, 10)];
        const semName = getSemestersForCourse(catName, courseName, yearName)[semIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];
        const periodKey = buildPeriodStorageKey(yearName, semName);

        const bucket = getUnitBucket(catName, courseName, periodKey, studyType, false);
        const unitName = bucket ? Object.keys(bucket.units)[uIdx] : null;
        const chapters = unitName ? Object.keys(bucket.units[unitName].chapters || {}) : [];

        await deletePrevMessage();

        if (chapters.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📂 <b>${unitName || "Unit"}</b> (${periodKey})\n\nIs unit mein abhi koi syllabus topic / chapter add nahi hua hai.`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const chapButtons = chapters.map((chapName, chIdx) => [
          { text: `📝 ${chapName}`, callback_data: `chap_${cIdx}_${sIdx}_${yPart}_${semIdx}_${tIdx}_${uIdx}_${chIdx}` }
        ]);
        chapButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📂 <b>${unitName}</b> (${periodKey} — ${studyType})\n\nTopic / Syllabus Section chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: chapButtons }
        });
      }
      // Step 6: Chapter selected -> Show PDFs
      else if (data.startsWith("chap_")) {
        const [, cIdxStr, sIdxStr, yPart, semIdxStr, tIdxStr, uIdxStr, chIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);
        const chIdx = parseInt(chIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const courseName = CATEGORIES[catName][sIdx];
        const yearName = yPart === "n" ? null : getYearsForCourse(catName, courseName)[parseInt(yPart, 10)];
        const semName = getSemestersForCourse(catName, courseName, yearName)[semIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];
        const periodKey = buildPeriodStorageKey(yearName, semName);

        const bucket = getUnitBucket(catName, courseName, periodKey, studyType, false);
        const unitName = bucket ? Object.keys(bucket.units)[uIdx] : null;
        const chapterName = unitName ? Object.keys(bucket.units[unitName].chapters)[chIdx] : null;
        const pdfs = chapterName ? (bucket.units[unitName].chapters[chapterName] || []) : [];

        await deletePrevMessage();

        if (pdfs.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📝 <b>${chapterName || "Section"}</b>\n\nIs section mein abhi koi PDF available nahi hai.`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const pdfButtons = pdfs.map((pdf, pIdx) => [
          { text: `📄 ${pdf.title}`, callback_data: `pdf_${cIdx}_${sIdx}_${yPart}_${semIdx}_${tIdx}_${uIdx}_${chIdx}_${pIdx}` }
        ]);
        pdfButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📝 <b>${chapterName}</b> (${periodKey})\n\nPDF open / download karne ke liye tap karein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: pdfButtons }
        });
      }
      // Step 7: Send PDF Document
      else if (data.startsWith("pdf_")) {
        const [, cIdxStr, sIdxStr, yPart, semIdxStr, tIdxStr, uIdxStr, chIdxStr, pIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);
        const chIdx = parseInt(chIdxStr, 10);
        const pIdx = parseInt(pIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const courseName = CATEGORIES[catName][sIdx];
        const yearName = yPart === "n" ? null : getYearsForCourse(catName, courseName)[parseInt(yPart, 10)];
        const semName = getSemestersForCourse(catName, courseName, yearName)[semIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];
        const periodKey = buildPeriodStorageKey(yearName, semName);

        const bucket = getUnitBucket(catName, courseName, periodKey, studyType, false);
        const unitName = Object.keys(bucket.units)[uIdx];
        const chapterName = Object.keys(bucket.units[unitName].chapters)[chIdx];
        const pdf = bucket.units[unitName].chapters[chapterName][pIdx];

        if (pdf && pdf.fileId) {
          await axios.post(`${TELEGRAM_API}/sendDocument`, {
            chat_id: chatId,
            document: pdf.fileId,
            caption: `📄 <b>${pdf.title}</b>\n${catName} > ${courseName} > ${periodKey} > ${studyType}\nUnit: ${unitName} | Topic: ${chapterName}`,
            parse_mode: "HTML"
          });
        }
      }

      await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, { callback_query_id: cq.id }).catch(() => {});
    }
  } catch (err) {
    console.log("Error:", err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`STUDY MATERIAL BOT running on port ${PORT}`);
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    try {
      await axios.get(`${TELEGRAM_API}/setWebhook`, {
        params: { url: `${renderUrl}/webhook` }
      });
      console.log(`Webhook set successfully!`);
    } catch (e) {}
  }
});