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

const DEFAULT_SEMESTERS_BY_STREAM = {
  "B.Pharma": [
    "Semester 1",
    "Semester 2",
    "Semester 3",
    "Semester 4",
    "Semester 5",
    "Semester 6",
    "Semester 7",
    "Semester 8"
  ],
  "D.Pharma": ["Year 1", "Year 2"]
};

let studyDb = {
  materials: {},
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

            if (text.includes("Syllabus") || text.includes("Hand Written Notes") || text.includes("Semester")) {
              style = "primary";
            } else if (text.includes("Back") || text.includes("Main Menu")) {
              style = "danger";
            } else if (callback.startsWith("sem_") || callback.startsWith("unit_")) {
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
      selectedSemester: null,
      adminUploadFlow: null
    };
    saveData();
  } else if (firstName) {
    studyDb.users[userId].name = firstName;
  }
  return studyDb.users[userId];
}

function getSemestersForStream(category, stream) {
  const key = `${category}::${stream}`;
  const baseList = DEFAULT_SEMESTERS_BY_STREAM[stream] || ["Semester 1", "Semester 2"];
  const extraList = studyDb.customSemesters[key] || [];
  const merged = [...baseList];

  if (
    studyDb.materials[category] &&
    studyDb.materials[category][stream]
  ) {
    for (const semName of Object.keys(studyDb.materials[category][stream])) {
      if (!merged.includes(semName)) merged.push(semName);
    }
  }

  for (const semName of extraList) {
    if (!merged.includes(semName)) merged.push(semName);
  }

  return merged;
}

function ensureSemester(category, stream, semester, createIfMissing = false) {
  if (!studyDb.materials[category]) {
    if (!createIfMissing) return null;
    studyDb.materials[category] = {};
  }
  if (!studyDb.materials[category][stream]) {
    if (!createIfMissing) return null;
    studyDb.materials[category][stream] = {};
  }
  if (!studyDb.materials[category][stream][semester]) {
    if (!createIfMissing) return null;
    studyDb.materials[category][stream][semester] = {};
  }
  return studyDb.materials[category][stream][semester];
}

function getUnitBucket(category, stream, semester, studyType, createIfMissing = false) {
  const semObj = ensureSemester(category, stream, semester, createIfMissing);
  if (!semObj) return null;

  if (!semObj[studyType]) {
    if (!createIfMissing) return null;
    semObj[studyType] = { units: {} };
  }
  if (!semObj[studyType].units) {
    semObj[studyType].units = {};
  }
  return semObj[studyType];
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
    user.selectedSemester,
    user.selectedType
  ]
    .filter(Boolean)
    .join(" > ");

  return (
`🤖 <b>STUDY MATERIAL AI ASSISTANT</b>

📌 <b>Scope:</b> <code>${scope || "General Study"}</code>
❓ <b>Topic / Doubt:</b> ${questionText}

💡 <b>Study Tip:</b> Pehle is topic ka Syllabus points aur Revision Notes dekhein, uske baad PYQ aur MCQ practice karein.
📄 Official PDFs / Notes ke liye <b>Hand Written Notes</b>, <b>Syllabus</b>, <b>PYQ Question</b>, <b>MCQ Question</b>, <b>Mock Test</b>, ya <b>Revision Notes</b> section open karein.`
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

      // Strict PDF / Document upload restriction: Sirf Admin PDF add kar sakta hai
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
            text: "ℹ️ Pehle <code>/add_pdf Category | Stream | Semester | StudyType | UnitName | ChapterOrNoteName | Title</code> bhejein, phir PDF file upload karein.",
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

        const bucket = getUnitBucket(flow.category, flow.stream, flow.semester, flow.studyType, true);
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
🎓 <b>Category:</b> ${flow.category} (${flow.stream})
🗓️ <b>Semester:</b> ${flow.semester}
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
      // ADMIN ONLY: /add_semester Category | Stream | SemesterName
      else if (text.startsWith('/add_semester')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⛔ Sirf Admin hi semester add kar sakta hai."
          });
          return;
        }
        const payload = text.replace('/add_semester', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 3) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_semester Category | Stream | SemesterName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, semesterName] = parts;
        if (!CATEGORIES[category] || !CATEGORIES[category].includes(stream)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "❌ Invalid Category ya Stream."
          });
          return;
        }
        const key = `${category}::${stream}`;
        if (!studyDb.customSemesters[key]) studyDb.customSemesters[key] = [];
        if (!studyDb.customSemesters[key].includes(semesterName)) {
          studyDb.customSemesters[key].push(semesterName);
        }
        ensureSemester(category, stream, semesterName, true);
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Semester Added!</b>\n${category} > ${stream} > <b>${semesterName}</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_semester Category | Stream | SemesterName
      else if (text.startsWith('/remove_semester')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⛔ Sirf Admin hi semester remove kar sakta hai."
          });
          return;
        }
        const payload = text.replace('/remove_semester', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 3) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_semester Category | Stream | SemesterName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, semesterName] = parts;
        const key = `${category}::${stream}`;
        if (studyDb.customSemesters[key]) {
          studyDb.customSemesters[key] = studyDb.customSemesters[key].filter((s) => s !== semesterName);
        }
        if (studyDb.materials[category] && studyDb.materials[category][stream]) {
          delete studyDb.materials[category][stream][semesterName];
        }
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🗑️ Semester <b>${semesterName}</b> removed for ${category} > ${stream}.`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /add_unit Category | Stream | Semester | StudyType | UnitName
      else if (text.startsWith('/add_unit')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⛔ Sirf Admin hi unit add kar sakta hai."
          });
          return;
        }
        const payload = text.replace('/add_unit', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 5) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_unit Category | Stream | Semester | StudyType | UnitName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, semester, studyType, unitName] = parts;
        if (!CATEGORIES[category] || !CATEGORIES[category].includes(stream) || !ALLOWED_STUDY_TYPES.includes(studyType)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "❌ Invalid Category, Stream, ya StudyType."
          });
          return;
        }
        const bucket = getUnitBucket(category, stream, semester, studyType, true);
        if (!bucket.units[unitName]) {
          bucket.units[unitName] = { chapters: {} };
        }
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Unit Added!</b>\n${category} > ${stream} > ${semester} > ${studyType}\nUnit: <b>${unitName}</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_unit Category | Stream | Semester | StudyType | UnitName
      else if (text.startsWith('/remove_unit')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⛔ Sirf Admin hi unit remove kar sakta hai."
          });
          return;
        }
        const payload = text.replace('/remove_unit', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 5) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_unit Category | Stream | Semester | StudyType | UnitName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, semester, studyType, unitName] = parts;
        const bucket = getUnitBucket(category, stream, semester, studyType, false);
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
      // ADMIN ONLY: /add_chapter Category | Stream | Semester | StudyType | UnitName | ChapterOrNoteName
      else if (text.startsWith('/add_chapter')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⛔ Sirf Admin hi chapter/material add kar sakta hai."
          });
          return;
        }
        const payload = text.replace('/add_chapter', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 6) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_chapter Category | Stream | Semester | StudyType | UnitName | ChapterOrNoteName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, semester, studyType, unitName, chapterName] = parts;
        if (!CATEGORIES[category] || !CATEGORIES[category].includes(stream) || !ALLOWED_STUDY_TYPES.includes(studyType)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "❌ Invalid Category, Stream, ya StudyType."
          });
          return;
        }
        const bucket = getUnitBucket(category, stream, semester, studyType, true);
        if (!bucket.units[unitName]) {
          bucket.units[unitName] = { chapters: {} };
        }
        if (!bucket.units[unitName].chapters[chapterName]) {
          bucket.units[unitName].chapters[chapterName] = [];
        }
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Section / Chapter Added!</b>\n${category} > ${stream} > ${semester} > ${studyType}\nUnit: <b>${unitName}</b>\nTopic: <b>${chapterName}</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_chapter Category | Stream | Semester | StudyType | UnitName | ChapterOrNoteName
      else if (text.startsWith('/remove_chapter')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⛔ Sirf Admin hi chapter/material remove kar sakta hai."
          });
          return;
        }
        const payload = text.replace('/remove_chapter', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 6) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_chapter Category | Stream | Semester | StudyType | UnitName | ChapterOrNoteName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, semester, studyType, unitName, chapterName] = parts;
        const bucket = getUnitBucket(category, stream, semester, studyType, false);
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
            ? `🗑️ Section / Chapter <b>${chapterName}</b> removed!`
            : `⚠️ Section / Chapter <b>${chapterName}</b> nahi mila.`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /add_pdf Category | Stream | Semester | StudyType | UnitName | ChapterOrNoteName | PDF Title
      else if (text.startsWith('/add_pdf')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⛔ Sirf Admin hi PDF add kar sakta hai."
          });
          return;
        }
        const payload = text.replace('/add_pdf', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_pdf Category | Stream | Semester | StudyType | UnitName | ChapterOrNoteName | PDF Title</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, semester, studyType, unitName, chapterName, title] = parts;
        if (!CATEGORIES[category] || !CATEGORIES[category].includes(stream) || !ALLOWED_STUDY_TYPES.includes(studyType)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "❌ Invalid Category, Stream, ya StudyType."
          });
          return;
        }
        user.adminUploadFlow = {
          step: "WAITING_PDF",
          category,
          stream,
          semester,
          studyType,
          unitName,
          chapterName,
          title
        };
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📎 Ab <b>${title}</b> ke liye PDF bhejein.\nTarget: ${category} > ${stream} > ${semester} > ${studyType} > ${unitName} > ${chapterName}`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_pdf Category | Stream | Semester | StudyType | UnitName | ChapterOrNoteName | PDF Title
      else if (text.startsWith('/remove_pdf')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⛔ Sirf Admin hi PDF remove kar sakta hai."
          });
          return;
        }
        const payload = text.replace('/remove_pdf', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_pdf Category | Stream | Semester | StudyType | UnitName | ChapterOrNoteName | PDF Title</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, semester, studyType, unitName, chapterName, title] = parts;
        const bucket = getUnitBucket(category, stream, semester, studyType, false);
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
      // ADMIN ONLY: /set_admit_link Category | Stream | Label | URL
      else if (text.startsWith('/set_admit_link')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi link set kar sakta hai." });
          return;
        }
        const payload = text.replace('/set_admit_link', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 4) return;
        const [category, stream, label, url] = parts;
        const key = `${category}::${stream}`;
        if (!studyDb.links.admitCards[key]) studyDb.links.admitCards[key] = [];
        studyDb.links.admitCards[key].push({ label, url });
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ Admit Card link added for <b>${category} (${stream})</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_admit_link Category | Stream | Label
      else if (text.startsWith('/remove_admit_link')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi link remove kar sakta hai." });
          return;
        }
        const payload = text.replace('/remove_admit_link', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 3) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_admit_link Category | Stream | Label</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, label] = parts;
        const key = `${category}::${stream}`;
        const list = studyDb.links.admitCards[key] || [];
        const beforeLen = list.length;
        studyDb.links.admitCards[key] = list.filter((item) => item.label !== label);
        const removed = beforeLen - studyDb.links.admitCards[key].length;
        if (removed > 0) saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: removed > 0
            ? `🗑️ Removed Admit Card link <b>${label}</b>.`
            : `⚠️ Admit Card link <b>${label}</b> nahi mila.`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /set_result_link Category | Stream | Label | URL
      else if (text.startsWith('/set_result_link')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi link set kar sakta hai." });
          return;
        }
        const payload = text.replace('/set_result_link', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 4) return;
        const [category, stream, label, url] = parts;
        const key = `${category}::${stream}`;
        if (!studyDb.links.results[key]) studyDb.links.results[key] = [];
        studyDb.links.results[key].push({ label, url });
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ Admit Card link added for <b>${category} (${stream})</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_admit_link Category | Stream | Label
      else if (text.startsWith('/remove_admit_link')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi link remove kar sakta hai." });
          return;
        }
        const payload = text.replace('/remove_admit_link', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 3) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_admit_link Category | Stream | Label</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, label] = parts;
        const key = `${category}::${stream}`;
        const list = studyDb.links.admitCards[key] || [];
        const beforeLen = list.length;
        studyDb.links.admitCards[key] = list.filter((item) => item.label !== label);
        const removed = beforeLen - studyDb.links.admitCards[key].length;
        if (removed > 0) saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: removed > 0
            ? `🗑️ Removed Admit Card link <b>${label}</b>.`
            : `⚠️ Admit Card link <b>${label}</b> nahi mila.`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /set_result_link Category | Stream | Label | URL
      else if (text.startsWith('/set_result_link')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi link set kar sakta hai." });
          return;
        }
        const payload = text.replace('/set_result_link', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 4) return;
        const [category, stream, label, url] = parts;
        const key = `${category}::${stream}`;
        if (!studyDb.links.results[key]) studyDb.links.results[key] = [];
        studyDb.links.results[key].push({ label, url });
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ Result link added for <b>${category} (${stream})</b>`,
          parse_mode: "HTML"
        });
      }
      // ADMIN ONLY: /remove_result_link Category | Stream | Label
      else if (text.startsWith('/remove_result_link')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, { chat_id: chatId, text: "⛔ Sirf Admin hi link remove kar sakta hai." });
          return;
        }
        const payload = text.replace('/remove_result_link', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 3) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/remove_result_link Category | Stream | Label</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, label] = parts;
        const key = `${category}::${stream}`;
        const list = studyDb.links.results[key] || [];
        const beforeLen = list.length;
        studyDb.links.results[key] = list.filter((item) => item.label !== label);
        const removed = beforeLen - studyDb.links.results[key].length;
        if (removed > 0) saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: removed > 0
            ? `🗑️ Removed Result link <b>${label}</b>.`
            : `⚠️ Result link <b>${label}</b> nahi mila.`,
          parse_mode: "HTML"
        });
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
        user.selectedSemester = null;
        saveData();

        await deletePrevMessage();
        const catButtons = CATEGORY_LIST.map((catName, cIdx) => [
          { text: `🎓 ${catName}`, callback_data: `cat_${cIdx}` }
        ]);
        catButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📚 <b>${typeName.toUpperCase()}</b>\n\nApni category chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: catButtons }
        });
      }
      else if (data.startsWith("cat_")) {
        const cIdx = parseInt(data.replace("cat_", ""), 10);
        const catName = CATEGORY_LIST[cIdx];
        const streams = CATEGORIES[catName] || [];
        user.selectedCategory = catName;
        user.selectedStream = null;
        user.selectedSemester = null;
        saveData();

        await deletePrevMessage();
        const streamButtons = streams.map((streamName, sIdx) => [
          { text: `📘 ${streamName}`, callback_data: `str_${cIdx}_${sIdx}` }
        ]);
        streamButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `⚡ <b>${catName.toUpperCase()} — ${user.selectedType}</b>\n\nApna stream / group chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: streamButtons }
        });
      }
      else if (data.startsWith("str_")) {
        const [, cIdxStr, sIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const catName = CATEGORY_LIST[cIdx];
        const streamName = (CATEGORIES[catName] || [])[sIdx];
        const studyType = user.selectedType || "Syllabus";

        user.selectedCategory = catName;
        user.selectedStream = streamName;
        user.selectedSemester = null;
        saveData();

        await deletePrevMessage();

        if (studyType === "Admit Cards Link" || studyType === "Result Link") {
          const key = `${catName}::${streamName}`;
          const list =
            studyType === "Admit Cards Link"
              ? (studyDb.links.admitCards[key] || [])
              : (studyDb.links.results[key] || []);
          const body =
            list.length === 0
              ? `Abhi is stream ka ${studyType} update nahi hua hai.`
              : list.map((l, i) => `${i + 1}. <a href="${l.url}">${l.label}</a>`).join("\n");

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🔗 <b>${studyType} — ${catName} (${streamName})</b>\n\n${body}`,
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

        const semesters = getSemestersForStream(catName, streamName);
        const semButtons = semesters.map((semName, semIdx) => [
          { text: `🗓️ ${semName}`, callback_data: `sem_${cIdx}_${sIdx}_${semIdx}` }
        ]);
        semButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🎓 <b>${catName} — ${streamName}</b>\n📚 Module: <b>${studyType}</b>\n\nApna <b>Semester</b> chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: semButtons }
        });
      }
      else if (data.startsWith("sem_")) {
        const [, cIdxStr, sIdxStr, semIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const streamName = (CATEGORIES[catName] || [])[sIdx];
        const semesters = getSemestersForStream(catName, streamName);
        const semName = semesters[semIdx];
        const studyType = user.selectedType || "Hand Written Notes";

        user.selectedCategory = catName;
        user.selectedStream = streamName;
        user.selectedSemester = semName;
        saveData();

        await deletePrevMessage();

        if (studyType === "AI Assistant") {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🤖 <b>AI Assistant Ready</b>\n\nScope: <b>${catName} > ${streamName} > ${semName}</b>\nApna topic ya question abhi type karke bhejein!`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const tIdx = ALLOWED_STUDY_TYPES.indexOf(studyType);
        const bucket = getUnitBucket(catName, streamName, semName, studyType, false);
        const units = bucket ? Object.keys(bucket.units) : [];

        if (units.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📂 <b>${catName} > ${streamName} > ${semName} > ${studyType}</b>\n\nIs semester mein abhi koi Unit add nahi hui hai.`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const unitButtons = units.map((unitName, uIdx) => [
          { text: `📂 ${unitName}`, callback_data: `unit_${cIdx}_${sIdx}_${semIdx}_${tIdx}_${uIdx}` }
        ]);
        unitButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📚 <b>${studyType} — ${catName} (${streamName})</b>\n🗓️ <b>${semName}</b>\n\nUnit chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: unitButtons }
        });
      }
      else if (data.startsWith("unit_")) {
        const [, cIdxStr, sIdxStr, semIdxStr, tIdxStr, uIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const streamName = CATEGORIES[catName][sIdx];
        const semName = getSemestersForStream(catName, streamName)[semIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];

        const bucket = getUnitBucket(catName, streamName, semName, studyType, false);
        const unitName = bucket ? Object.keys(bucket.units)[uIdx] : null;
        const chapters = unitName ? Object.keys(bucket.units[unitName].chapters || {}) : [];

        await deletePrevMessage();

        if (chapters.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📂 <b>${unitName || "Unit"}</b> (${semName})\n\nIs unit mein abhi koi Notes / Syllabus / Chapter add nahi hua hai.`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const chapButtons = chapters.map((chapName, chIdx) => [
          { text: `📝 ${chapName}`, callback_data: `chap_${cIdx}_${sIdx}_${semIdx}_${tIdx}_${uIdx}_${chIdx}` }
        ]);
        chapButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📂 <b>${unitName}</b> (${semName} — ${studyType})\n\nNotes / Syllabus / Chapter chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: chapButtons }
        });
      }
      else if (data.startsWith("chap_")) {
        const [, cIdxStr, sIdxStr, semIdxStr, tIdxStr, uIdxStr, chIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);
        const chIdx = parseInt(chIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const streamName = CATEGORIES[catName][sIdx];
        const semName = getSemestersForStream(catName, streamName)[semIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];

        const bucket = getUnitBucket(catName, streamName, semName, studyType, false);
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
          { text: `📄 ${pdf.title}`, callback_data: `pdf_${cIdx}_${sIdx}_${semIdx}_${tIdx}_${uIdx}_${chIdx}_${pIdx}` }
        ]);
        pdfButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📝 <b>${chapterName}</b> (${semName})\n\nPDF open / download karne ke liye tap karein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: pdfButtons }
        });
      }
      else if (data.startsWith("pdf_")) {
        const [, cIdxStr, sIdxStr, semIdxStr, tIdxStr, uIdxStr, chIdxStr, pIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);
        const chIdx = parseInt(chIdxStr, 10);
        const pIdx = parseInt(pIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const streamName = CATEGORIES[catName][sIdx];
        const semName = getSemestersForStream(catName, streamName)[semIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];

        const bucket = getUnitBucket(catName, streamName, semName, studyType, false);
        const unitName = Object.keys(bucket.units)[uIdx];
        const chapterName = Object.keys(bucket.units[unitName].chapters)[chIdx];
        const pdf = bucket.units[unitName].chapters[chapterName][pIdx];

        if (pdf && pdf.fileId) {
          await axios.post(`${TELEGRAM_API}/sendDocument`, {
            chat_id: chatId,
            document: pdf.fileId,
            caption: `📄 <b>${pdf.title}</b>\n${catName} > ${streamName} > ${semName} > ${studyType}\nUnit: ${unitName} | Topic: ${chapterName}`,
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