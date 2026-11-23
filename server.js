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
  ...(process.env.ADMIN_IDS || '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => !Number.isNaN(id) && id > 0)
]);
const SUPPORT_CHANNEL = process.env.SUPPORT_CHANNEL || "https://t.me/adityachoudhary5";

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

let studyDb = {
  materials: {},
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

            if (text.includes("Syllabus") || text.includes("Hand Written Notes")) {
              style = "primary";
            } else if (text.includes("Back") || text.includes("Main Menu")) {
              style = "danger";
            } else if (callback.startsWith("cat_") || callback.startsWith("str_")) {
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
      adminUploadFlow: null
    };
    saveData();
  } else if (firstName) {
    studyDb.users[userId].name = firstName;
  }
  return studyDb.users[userId];
}

function getBucket(category, stream, studyType, createIfMissing = false) {
  const key = `${category}::${stream}::${studyType}`;
  if (!studyDb.materials[key]) {
    if (!createIfMissing) return null;
    studyDb.materials[key] = { units: {} };
  }
  if (!studyDb.materials[key].units) {
    studyDb.materials[key].units = {};
  }
  return studyDb.materials[key];
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
  const scope = [user.selectedCategory, user.selectedStream, user.selectedType]
    .filter(Boolean)
    .join(" > ");

  return (
`🤖 <b>STUDY MATERIAL AI ASSISTANT</b>

📌 <b>Scope:</b> <code>${scope || "General Study"}</code>
❓ <b>Topic / Doubt:</b> ${questionText}

💡 <b>Study Tip:</b> Pehle is topic ka Syllabus points aur Revision Notes dekhein, uske baad PYQ aur MCQ practice karein.
📄 Official PDFs ke liye <b>Hand Written Notes</b>, <b>PYQ Question</b>, <b>MCQ Question</b>, <b>Mock Test</b>, ya <b>Revision Notes</b> section open karein.`
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
            text: "🚫 <b>Permission Denied:</b> Sirf Admin hi PDF ya study file add kar sakta hai.",
            parse_mode: "HTML"
          });
          return;
        }

        const flow = user.adminUploadFlow;
        if (!flow || flow.step !== "WAITING_PDF") {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "ℹ️ Pehle <code>/add_pdf Category | Stream | StudyType | UnitName | ChapterName | PDF Title</code> bhejein, phir PDF file upload karein.",
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

        const bucket = getBucket(flow.category, flow.stream, flow.studyType, true);
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
`✅ <b>PDF Added to Study Material Bot!</b>

📚 <b>Module:</b> ${flow.studyType}
🎓 <b>Category:</b> ${flow.category} (${flow.stream})
📂 <b>Unit:</b> ${flow.unitName}
📘 <b>Chapter:</b> ${flow.chapterName}
📄 <b>Title:</b> <code>${flow.title}</code>`,
          parse_mode: "HTML"
        });
        return;
      }

      if (text.startsWith('/start')) {
        user.selectedType = null;
        user.selectedCategory = null;
        user.selectedStream = null;
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
        if (parts.length < 4) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_unit Category | Stream | StudyType | UnitName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, studyType, unitName] = parts;
        if (!CATEGORIES[category] || !CATEGORIES[category].includes(stream) || !ALLOWED_STUDY_TYPES.includes(studyType)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "❌ Invalid Category, Stream, ya StudyType."
          });
          return;
        }
        const bucket = getBucket(category, stream, studyType, true);
        if (!bucket.units[unitName]) {
          bucket.units[unitName] = { chapters: {} };
        }
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Unit Added!</b>\n${category} > ${stream} > ${studyType}\nUnit: <b>${unitName}</b>`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_chapter')) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⛔ Sirf Admin hi chapter add kar sakta hai."
          });
          return;
        }
        const payload = text.replace('/add_chapter', '').trim();
        const parts = payload.split('|').map((s) => s.trim());
        if (parts.length < 5) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_chapter Category | Stream | StudyType | UnitName | ChapterName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, studyType, unitName, chapterName] = parts;
        if (!CATEGORIES[category] || !CATEGORIES[category].includes(stream) || !ALLOWED_STUDY_TYPES.includes(studyType)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "❌ Invalid Category, Stream, ya StudyType."
          });
          return;
        }
        const bucket = getBucket(category, stream, studyType, true);
        if (!bucket.units[unitName]) {
          bucket.units[unitName] = { chapters: {} };
        }
        if (!bucket.units[unitName].chapters[chapterName]) {
          bucket.units[unitName].chapters[chapterName] = [];
        }
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Chapter Added!</b>\n${category} > ${stream} > ${studyType}\nUnit: <b>${unitName}</b>\nChapter: <b>${chapterName}</b>`,
          parse_mode: "HTML"
        });
      }
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
        if (parts.length < 6) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_pdf Category | Stream | StudyType | UnitName | ChapterName | PDF Title</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, stream, studyType, unitName, chapterName, title] = parts;
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
          studyType,
          unitName,
          chapterName,
          title
        };
        saveData();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📎 Ab <b>${title}</b> ke liye PDF file bhejein.\nTarget: ${category} > ${stream} > ${studyType} > ${unitName} > ${chapterName}`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/set_admit_link')) {
        if (!isAdmin(from.id)) return;
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
      else if (text.startsWith('/set_result_link')) {
        if (!isAdmin(from.id)) return;
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
        saveData();

        await deletePrevMessage();
        const streamButtons = streams.map((streamName, sIdx) => [
          { text: `📘 ${streamName}`, callback_data: `str_${cIdx}_${sIdx}` }
        ]);
        streamButtons.push([{ text: "🔙 Back to Main Menu", callback_data: "main_menu" }]);

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
        saveData();

        await deletePrevMessage();
        const key = `${catName}::${streamName}`;

        if (studyType === "Admit Cards Link") {
          const links = studyDb.links.admitCards[key] || [];
          const body =
            links.length === 0
              ? "Abhi is stream ka Admit Card link update nahi hua hai."
              : links.map((l, i) => `${i + 1}. <a href="${l.url}">${l.label}</a>`).join("\n");

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🪪 <b>Admit Cards — ${catName} (${streamName})</b>\n\n${body}`,
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

        if (studyType === "Result Link") {
          const links = studyDb.links.results[key] || [];
          const body =
            links.length === 0
              ? "Abhi is stream ka Result link update nahi hua hai."
              : links.map((l, i) => `${i + 1}. <a href="${l.url}">${l.label}</a>`).join("\n");

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📊 <b>Results — ${catName} (${streamName})</b>\n\n${body}`,
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

        if (studyType === "AI Assistant") {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🤖 <b>AI Assistant Ready</b>\n\nScope: <b>${catName} (${streamName})</b>\nApna topic ya question abhi type karke bhejein!`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const tIdx = ALLOWED_STUDY_TYPES.indexOf(studyType);
        const bucket = getBucket(catName, streamName, studyType, false);
        const units = bucket ? Object.keys(bucket.units) : [];

        if (units.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📂 <b>${catName} > ${streamName} > ${studyType}</b>\n\nIs section mein abhi koi Unit/PDF add nahi hua hai.`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const unitButtons = units.map((unitName, uIdx) => [
          { text: `📂 ${unitName}`, callback_data: `unit_${cIdx}_${sIdx}_${tIdx}_${uIdx}` }
        ]);
        unitButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📚 <b>${studyType} — ${catName} (${streamName})</b>\n\nUnit chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: unitButtons }
        });
      }
      else if (data.startsWith("unit_")) {
        const [, cIdxStr, sIdxStr, tIdxStr, uIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const streamName = CATEGORIES[catName][sIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];
        const bucket = getBucket(catName, streamName, studyType, false);
        const unitName = bucket ? Object.keys(bucket.units)[uIdx] : null;
        const chapters = unitName ? Object.keys(bucket.units[unitName].chapters || {}) : [];

        await deletePrevMessage();
        const chapButtons = chapters.map((chapName, chIdx) => [
          { text: `📘 ${chapName}`, callback_data: `chap_${cIdx}_${sIdx}_${tIdx}_${uIdx}_${chIdx}` }
        ]);
        chapButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📂 <b>${unitName || "Unit"}</b>\n\nChapter chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: chapButtons }
        });
      }
      else if (data.startsWith("chap_")) {
        const [, cIdxStr, sIdxStr, tIdxStr, uIdxStr, chIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);
        const chIdx = parseInt(chIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const streamName = CATEGORIES[catName][sIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];
        const bucket = getBucket(catName, streamName, studyType, false);
        const unitName = bucket ? Object.keys(bucket.units)[uIdx] : null;
        const chapterName = unitName ? Object.keys(bucket.units[unitName].chapters)[chIdx] : null;
        const pdfs = chapterName ? (bucket.units[unitName].chapters[chapterName] || []) : [];

        await deletePrevMessage();
        const pdfButtons = pdfs.map((pdf, pIdx) => [
          { text: `📄 ${pdf.title}`, callback_data: `pdf_${cIdx}_${sIdx}_${tIdx}_${uIdx}_${chIdx}_${pIdx}` }
        ]);
        pdfButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📘 <b>${chapterName || "Chapter"}</b>\n\nPDF select karein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: pdfButtons }
        });
      }
      else if (data.startsWith("pdf_")) {
        const [, cIdxStr, sIdxStr, tIdxStr, uIdxStr, chIdxStr, pIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);
        const chIdx = parseInt(chIdxStr, 10);
        const pIdx = parseInt(pIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const streamName = CATEGORIES[catName][sIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];
        const bucket = getBucket(catName, streamName, studyType, false);
        const unitName = Object.keys(bucket.units)[uIdx];
        const chapterName = Object.keys(bucket.units[unitName].chapters)[chIdx];
        const pdf = bucket.units[unitName].chapters[chapterName][pIdx];

        if (pdf && pdf.fileId) {
          await axios.post(`${TELEGRAM_API}/sendDocument`, {
            chat_id: chatId,
            document: pdf.fileId,
            caption: `📄 <b>${pdf.title}</b>\n${catName} > ${streamName} > ${studyType}\nUnit: ${unitName} | Chapter: ${chapterName}`,
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