require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const {
  ALLOWED_STUDY_TYPES,
  MAIN_MENU_BUTTONS,
  CATEGORIES,
  CATEGORY_LIST
} = require("./catalog");
const {
  loadData,
  getBucket,
  addUnit,
  addChapter,
  addPdfToChapter,
  setPortalLink
} = require("./storage");

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN missing in .env");
  process.exit(1);
}

const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number)
);

const bot = new TelegramBot(token, { polling: true });
const userState = {};

const MAIN_BUTTON_NAMES = [
  "Syllabus",
  "Hand Written Notes",
  "PYQ Question",
  "MCQ Question",
  "Mock Test",
  "AI Assistant",
  "Revision Notes",
  "Admit Cards Link",
  "Result Link"
];

function isAdmin(userId) {
  return ADMIN_IDS.has(Number(userId));
}

function getState(userId) {
  if (!userState[userId]) {
    userState[userId] = {
      selectedType: null,
      selectedCategory: null,
      selectedStream: null,
      adminFlow: null
    };
  }
  return userState[userId];
}

function greenLabel(label) {
  return label.startsWith("🟩") ? label : `🟩 ${label}`;
}

function buildMainMenuInlineKeyboard() {
  const inlineKeyboard = MAIN_MENU_BUTTONS.map((row) =>
    row.map((label) => {
      const idx = MAIN_BUTTON_NAMES.indexOf(label);
      return {
        text: greenLabel(label),
        callback_data: `MAIN|${idx}`
      };
    })
  );

  return { inline_keyboard: inlineKeyboard };
}

function buildCategoryInlineKeyboard() {
  const rows = [];
  for (let i = 0; i < CATEGORY_LIST.length; i += 2) {
    const pair = CATEGORY_LIST.slice(i, i + 2).map((catName) => {
      const cIdx = CATEGORY_LIST.indexOf(catName);
      return {
        text: greenLabel(catName),
        callback_data: `CAT|${cIdx}`
      };
    });
    rows.push(pair);
  }
  rows.push([{ text: "⬅️ Back to Main Menu", callback_data: "BACK|MAIN" }]);
  return { inline_keyboard: rows };
}

function buildStreamInlineKeyboard(cIdx) {
  const category = CATEGORY_LIST[cIdx];
  const streams = CATEGORIES[category] || [];
  const rows = [];

  for (let i = 0; i < streams.length; i += 2) {
    const pair = streams.slice(i, i + 2).map((streamName) => {
      const sIdx = streams.indexOf(streamName);
      return {
        text: greenLabel(streamName),
        callback_data: `STR|${cIdx}|${sIdx}`
      };
    });
    rows.push(pair);
  }

  rows.push([
    { text: "⬅️ Categories", callback_data: "BACK|CAT" },
    { text: "🏠 Main Menu", callback_data: "BACK|MAIN" }
  ]);

  return { inline_keyboard: rows };
}

function getWelcomeText(user) {
  const firstName = user.first_name || "Student";
  const roleLabel = isAdmin(user.id) ? "Admin" : "Student";

  return [
    "🌸 - STUDY MATERIAL BOT - 🌸",
    "",
    `👤 Hello, ${firstName}!`,
    "",
    "📚 Your Complete Study Assistant",
    "",
    "— 📖 Syllabus",
    "— ✍️ Hand Written Notes",
    "— 📝 PYQ Question",
    "— 🧠 MCQ Question",
    "— 🎯 Mock Test",
    "— 🤖 AI Assistant",
    "— 🔄 Revision Notes",
    "— 🪪 Admit Cards Link & 📊 Result Link",
    "━━━━━━━━━━━━━━━━━━━━",
    `👤 User ID: ${user.id}`,
    `🎖️ Access: ${roleLabel}`,
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "Tap any green button below to begin."
  ].join("\n");
}

function sendWelcomeCard(chatId, user) {
  return bot.sendMessage(chatId, getWelcomeText(user), {
    reply_markup: buildMainMenuInlineKeyboard()
  });
}

async function editMenuMessage(chatId, messageId, text, inlineKeyboard) {
  try {
    return await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard
    });
  } catch (err) {
    return bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: inlineKeyboard
    });
  }
}

function getAiAssistantReply(queryText, state) {
  const scope = [state.selectedCategory, state.selectedStream, state.selectedType]
    .filter(Boolean)
    .join(" > ");

  return [
    "🤖 *AI Study Assistant*",
    scope ? `📌 *Context:* ${scope}` : "📌 *Context:* General Study",
    "",
    `❓ *Your Topic/Question:* ${queryText}`,
    "",
    "💡 *Study Tip:* Pehle is topic ka Syllabus points aur Revision Notes dekhein, uske baad PYQ aur MCQ practice karein.",
    "📄 Note: Official PDFs ke liye *Hand Written Notes*, *PYQ Question*, *MCQ Question*, *Mock Test*, ya *Revision Notes* section check karein."
  ].join("\n");
}
bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  userState[userId] = {
    selectedType: null,
    selectedCategory: null,
    selectedStream: null,
    adminFlow: null
  };
  sendWelcomeCard(msg.chat.id, msg.from);
});

bot.onText(/\/cancel/, (msg) => {
  const state = getState(msg.from.id);
  state.adminFlow = null;
  sendWelcomeCard(msg.chat.id, msg.from);
});

// Admin Command: /add_unit Category | Stream | StudyType | UnitName
bot.onText(/\/add_unit (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "⛔ Sirf Admin hi unit add kar sakta hai.");
  }
  const parts = match[1].split("|").map((s) => s.trim());
  if (parts.length < 4) {
    return bot.sendMessage(
      msg.chat.id,
      "⚠️ Format: `/add_unit Category | Stream | StudyType | UnitName`\nExample: `/add_unit Pharmacy | B.Pharma | Revision Notes | Unit 1 - Quick Summary`",
      { parse_mode: "Markdown" }
    );
  }
  const [category, stream, studyType, unitName] = parts;
  if (!CATEGORIES[category] || !CATEGORIES[category].includes(stream)) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid Category ya Stream.");
  }
  if (!ALLOWED_STUDY_TYPES.includes(studyType)) {
    return bot.sendMessage(
      msg.chat.id,
      `❌ Invalid StudyType. Allowed: ${ALLOWED_STUDY_TYPES.join(", ")}`
    );
  }
  addUnit(category, stream, studyType, unitName, msg.from.id);
  bot.sendMessage(
    msg.chat.id,
    `✅ Unit Added!\n• ${category} > ${stream} > ${studyType}\n• Unit: *${unitName}*`,
    { parse_mode: "Markdown" }
  );
});

// Admin Command: /add_chapter Category | Stream | StudyType | UnitName | ChapterName
bot.onText(/\/add_chapter (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "⛔ Sirf Admin hi chapter add kar sakta hai.");
  }
  const parts = match[1].split("|").map((s) => s.trim());
  if (parts.length < 5) {
    return bot.sendMessage(
      msg.chat.id,
      "⚠️ Format: `/add_chapter Category | Stream | StudyType | UnitName | ChapterName`",
      { parse_mode: "Markdown" }
    );
  }
  const [category, stream, studyType, unitName, chapterName] = parts;
  if (!CATEGORIES[category] || !CATEGORIES[category].includes(stream)) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid Category ya Stream.");
  }
  if (!ALLOWED_STUDY_TYPES.includes(studyType)) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid StudyType.");
  }
  addChapter(category, stream, studyType, unitName, chapterName, msg.from.id);
  bot.sendMessage(
    msg.chat.id,
    `✅ Chapter Added!\n• ${category} > ${stream} > ${studyType}\n• Unit: *${unitName}*\n• Chapter: *${chapterName}*`,
    { parse_mode: "Markdown" }
  );
});

// Admin Command: /add_pdf Category | Stream | StudyType | UnitName | ChapterName | PDF Title
bot.onText(/\/add_pdf (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "⛔ Sirf Admin hi PDF add kar sakta hai.");
  }
  const parts = match[1].split("|").map((s) => s.trim());
  if (parts.length < 6) {
    return bot.sendMessage(
      msg.chat.id,
      "⚠️ Format: `/add_pdf Category | Stream | StudyType | UnitName | ChapterName | PDF Title`\nPhir agle message mein PDF file bhejein.",
      { parse_mode: "Markdown" }
    );
  }
  const [category, stream, studyType, unitName, chapterName, title] = parts;
  if (!CATEGORIES[category] || !CATEGORIES[category].includes(stream)) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid Category ya Stream.");
  }
  if (!ALLOWED_STUDY_TYPES.includes(studyType)) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid StudyType.");
  }

  const state = getState(msg.from.id);
  state.adminFlow = {
    step: "WAITING_PDF",
    category,
    stream,
    studyType,
    unitName,
    chapterName,
    title
  };

  bot.sendMessage(
    msg.chat.id,
    `📎 Ab *${title}* ke liye PDF document bhejein.\nTarget: ${category} > ${stream} > ${studyType} > ${unitName} > ${chapterName}\n(/cancel se cancel karein)`,
    { parse_mode: "Markdown" }
  );
});

// Admin Command: /set_admit_link Category | Stream | Label | URL
bot.onText(/\/set_admit_link (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "⛔ Sirf Admin hi link set kar sakta hai.");
  }
  const parts = match[1].split("|").map((s) => s.trim());
  if (parts.length < 4) {
    return bot.sendMessage(
      msg.chat.id,
      "⚠️ Format: `/set_admit_link Category | Stream | Label | URL`",
      { parse_mode: "Markdown" }
    );
  }
  const [category, stream, label, url] = parts;
  setPortalLink("admit", category, stream, label, url, msg.from.id);
  bot.sendMessage(msg.chat.id, `✅ Admit Card link saved for ${category} - ${stream}: ${label}`);
});

// Admin Command: /set_result_link Category | Stream | Label | URL
bot.onText(/\/set_result_link (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "⛔ Sirf Admin hi link set kar sakta hai.");
  }
  const parts = match[1].split("|").map((s) => s.trim());
  if (parts.length < 4) {
    return bot.sendMessage(
      msg.chat.id,
      "⚠️ Format: `/set_result_link Category | Stream | Label | URL`",
      { parse_mode: "Markdown" }
    );
  }
  const [category, stream, label, url] = parts;
  setPortalLink("result", category, stream, label, url, msg.from.id);
  bot.sendMessage(msg.chat.id, `✅ Result link saved for ${category} - ${stream}: ${label}`);
});

// Strict PDF handler: Sirf Admin PDF upload kar sakta hai
bot.on("document", (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  if (!isAdmin(userId)) {
    return bot.sendMessage(
      chatId,
      "🚫 Aapko PDF ya file upload karne ki permission nahi hai. Sirf Admin hi PDF add kar sakta hai."
    );
  }

  const state = getState(userId);
  if (!state.adminFlow || state.adminFlow.step !== "WAITING_PDF") {
    return bot.sendMessage(
      chatId,
      "ℹ️ Pehle `/add_pdf Category | Stream | StudyType | UnitName | ChapterName | PDF Title` command chalayein, phir PDF bhejein.",
      { parse_mode: "Markdown" }
    );
  }

  const doc = msg.document;
  const isPdf =
    doc.mime_type === "application/pdf" ||
    (doc.file_name && doc.file_name.toLowerCase().endsWith(".pdf"));

  if (!isPdf) {
    return bot.sendMessage(chatId, "⚠️ Kripya sirf *PDF* file hi bhejein.", {
      parse_mode: "Markdown"
    });
  }

  const flow = state.adminFlow;
  addPdfToChapter(
    flow.category,
    flow.stream,
    flow.studyType,
    flow.unitName,
    flow.chapterName,
    {
      title: flow.title,
      fileId: doc.file_id,
      fileName: doc.file_name || `${flow.title}.pdf`,
      addedBy: userId,
      addedAt: new Date().toISOString()
    }
  );

  state.adminFlow = null;
  bot.sendMessage(
    chatId,
    `✅ PDF Successfully Added!\n• *Title:* ${flow.title}\n• *Path:* ${flow.category} > ${flow.stream} > ${flow.studyType}\n• *Unit:* ${flow.unitName}\n• *Chapter:* ${flow.chapterName}`,
    { parse_mode: "Markdown" }
  );
});

// Inline callbacks — Sab kuch usi message ke andar update hota hai
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;
  const dataStr = query.data || "";
  const data = loadData();
  const state = getState(userId);

  if (dataStr === "BACK|MAIN") {
    state.selectedCategory = null;
    state.selectedStream = null;
    await bot.answerCallbackQuery(query.id);
    return bot.editMessageText(getWelcomeText(query.from), {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: buildMainMenuInlineKeyboard()
    });
  }

  if (dataStr === "BACK|CAT") {
    state.selectedCategory = null;
    state.selectedStream = null;
    await bot.answerCallbackQuery(query.id);
    return editMenuMessage(
      chatId,
      messageId,
      `📚 *${state.selectedType || "Study"}*\n👇 Apni Category chunein:`,
      buildCategoryInlineKeyboard()
    );
  }

  if (dataStr.startsWith("MAIN|")) {
    const [, idxStr] = dataStr.split("|");
    const typeName = MAIN_BUTTON_NAMES[Number(idxStr)];
    if (!typeName) {
      return bot.answerCallbackQuery(query.id, { text: "Option nahi mila." });
    }
    state.selectedType = typeName;
    state.selectedCategory = null;
    state.selectedStream = null;
    await bot.answerCallbackQuery(query.id);
    return editMenuMessage(
      chatId,
      messageId,
      `📚 *${typeName}*\n👇 Apni Category chunein:`,
      buildCategoryInlineKeyboard()
    );
  }

  if (dataStr.startsWith("CAT|")) {
    const [, cIdxStr] = dataStr.split("|");
    const cIdx = Number(cIdxStr);
    const category = CATEGORY_LIST[cIdx];
    if (!category) {
      return bot.answerCallbackQuery(query.id, { text: "Category nahi mili." });
    }
    state.selectedCategory = category;
    state.selectedStream = null;
    await bot.answerCallbackQuery(query.id);
    return editMenuMessage(
      chatId,
      messageId,
      `📚 *${state.selectedType || "Study"}* — *${category}*\n👇 Apna Stream / Group select karein:`,
      buildStreamInlineKeyboard(cIdx)
    );
  }

  if (dataStr.startsWith("STR|")) {
    const [, cIdxStr, sIdxStr] = dataStr.split("|");
    const cIdx = Number(cIdxStr);
    const sIdx = Number(sIdxStr);
    const cat = CATEGORY_LIST[cIdx];
    const stream = (CATEGORIES[cat] || [])[sIdx];
    const type = state.selectedType || "Syllabus";

    if (!cat || !stream) {
      return bot.answerCallbackQuery(query.id, { text: "Stream nahi mila." });
    }

    state.selectedCategory = cat;
    state.selectedStream = stream;
    const key = `${cat}::${stream}`;
    const navBack = {
      inline_keyboard: [
        [
          { text: "⬅️ Streams", callback_data: `CAT|${cIdx}` },
          { text: "🏠 Main Menu", callback_data: "BACK|MAIN" }
        ]
      ]
    };

    await bot.answerCallbackQuery(query.id);

    if (type === "Admit Cards Link") {
      const list = data.links.admitCards[key] || [];
      const body =
        list.length === 0
          ? "Is stream ke liye abhi Admit Card link update nahi hua hai."
          : list.map((item, i) => `${i + 1}. [${item.label}](${item.url})`).join("\n");

      return editMenuMessage(
        chatId,
        messageId,
        `🪪 *Admit Cards — ${cat} (${stream})*\n\n${body}`,
        navBack
      );
    }

    if (type === "Result Link") {
      const list = data.links.results[key] || [];
      const body =
        list.length === 0
          ? "Is stream ke liye abhi Result link update nahi hua hai."
          : list.map((item, i) => `${i + 1}. [${item.label}](${item.url})`).join("\n");

      return editMenuMessage(
        chatId,
        messageId,
        `📊 *Results — ${cat} (${stream})*\n\n${body}`,
        navBack
      );
    }

    if (type === "AI Assistant") {
      return editMenuMessage(
        chatId,
        messageId,
        `🤖 *AI Study Assistant* active for *${cat} (${stream})*.\n\nApna topic ya doubt abhi chat mein type karke bhejein!`,
        navBack
      );
    }

    const tIdx = ALLOWED_STUDY_TYPES.indexOf(type);
    const bucket = getBucket(data, cat, stream, type, false);
    const units = bucket ? Object.keys(bucket.units) : [];

    if (units.length === 0) {
      return editMenuMessage(
        chatId,
        messageId,
        `📂 *${cat} > ${stream} > ${type}*\n\nIs section mein abhi koi Unit/PDF add nahi hua hai.`,
        navBack
      );
    }

    const unitRows = units.map((unitName, uIdx) => [
      {
        text: greenLabel(unitName),
        callback_data: `UNIT|${cIdx}|${sIdx}|${tIdx}|${uIdx}`
      }
    ]);
    unitRows.push([
      { text: "⬅️ Streams", callback_data: `CAT|${cIdx}` },
      { text: "🏠 Main Menu", callback_data: "BACK|MAIN" }
    ]);

    return editMenuMessage(
      chatId,
      messageId,
      `📚 *${type}* — *${cat} (${stream})*\n👇 Unit select karein:`,
      { inline_keyboard: unitRows }
    );
  }

  if (dataStr.startsWith("UNIT|")) {
    const [, cIdx, sIdx, tIdx, uIdx] = dataStr.split("|").map(Number);
    const category = CATEGORY_LIST[cIdx];
    const stream = CATEGORIES[category][sIdx];
    const studyType = ALLOWED_STUDY_TYPES[tIdx];
    const bucket = getBucket(data, category, stream, studyType, false);
    const units = bucket ? Object.keys(bucket.units) : [];
    const unitName = units[uIdx];

    if (!unitName) {
      return bot.answerCallbackQuery(query.id, { text: "Unit nahi mili." });
    }

    const chapters = Object.keys(bucket.units[unitName].chapters || {});
    await bot.answerCallbackQuery(query.id);

    if (chapters.length === 0) {
      return editMenuMessage(
        chatId,
        messageId,
        `📂 *${unitName}*\n\nIs unit mein abhi koi chapter add nahi hua hai.`,
        {
          inline_keyboard: [
            [
              { text: "⬅️ Units", callback_data: `STR|${cIdx}|${sIdx}` },
              { text: "🏠 Main Menu", callback_data: "BACK|MAIN" }
            ]
          ]
        }
      );
    }

    const chapRows = chapters.map((chap, idx) => [
      {
        text: greenLabel(chap),
        callback_data: `CHAP|${cIdx}|${sIdx}|${tIdx}|${uIdx}|${idx}`
      }
    ]);
    chapRows.push([
      { text: "⬅️ Units", callback_data: `STR|${cIdx}|${sIdx}` },
      { text: "🏠 Main Menu", callback_data: "BACK|MAIN" }
    ]);

    return editMenuMessage(
      chatId,
      messageId,
      `📂 *Unit:* ${unitName}\n👇 Chapter select karein:`,
      { inline_keyboard: chapRows }
    );
  }

  if (dataStr.startsWith("CHAP|")) {
    const [, cIdx, sIdx, tIdx, uIdx, chIdx] = dataStr.split("|").map(Number);
    const category = CATEGORY_LIST[cIdx];
    const stream = CATEGORIES[category][sIdx];
    const studyType = ALLOWED_STUDY_TYPES[tIdx];
    const bucket = getBucket(data, category, stream, studyType, false);
    const unitName = Object.keys(bucket.units)[uIdx];
    const chapterName = Object.keys(bucket.units[unitName].chapters)[chIdx];
    const pdfs = bucket.units[unitName].chapters[chapterName] || [];

    await bot.answerCallbackQuery(query.id);

    if (pdfs.length === 0) {
      return editMenuMessage(
        chatId,
        messageId,
        `📘 *${chapterName}*\n\nIs chapter mein abhi koi PDF available nahi hai.`,
        {
          inline_keyboard: [
            [
              { text: "⬅️ Chapters", callback_data: `UNIT|${cIdx}|${sIdx}|${tIdx}|${uIdx}` },
              { text: "🏠 Main Menu", callback_data: "BACK|MAIN" }
            ]
          ]
        }
      );
    }

    const pdfRows = pdfs.map((pdf, pIdx) => [
      {
        text: greenLabel(pdf.title),
        callback_data: `PDF|${cIdx}|${sIdx}|${tIdx}|${uIdx}|${chIdx}|${pIdx}`
      }
    ]);
    pdfRows.push([
      { text: "⬅️ Chapters", callback_data: `UNIT|${cIdx}|${sIdx}|${tIdx}|${uIdx}` },
      { text: "🏠 Main Menu", callback_data: "BACK|MAIN" }
    ]);

    return editMenuMessage(
      chatId,
      messageId,
      `📘 *Chapter:* ${chapterName}\n👇 PDF open/download karne ke liye tap karein:`,
      { inline_keyboard: pdfRows }
    );
  }

  if (dataStr.startsWith("PDF|")) {
    const [, cIdx, sIdx, tIdx, uIdx, chIdx, pIdx] = dataStr.split("|").map(Number);
    const category = CATEGORY_LIST[cIdx];
    const stream = CATEGORIES[category][sIdx];
    const studyType = ALLOWED_STUDY_TYPES[tIdx];
    const bucket = getBucket(data, category, stream, studyType, false);
    const unitName = Object.keys(bucket.units)[uIdx];
    const chapterName = Object.keys(bucket.units[unitName].chapters)[chIdx];
    const pdf = bucket.units[unitName].chapters[chapterName][pIdx];

    if (!pdf) {
      return bot.answerCallbackQuery(query.id, { text: "PDF nahi mili." });
    }

    await bot.answerCallbackQuery(query.id, { text: "PDF bhej rahe hain..." });
    return bot.sendDocument(chatId, pdf.fileId, {
      caption: `📄 *${pdf.title}*\n${category} > ${stream} > ${studyType}\nUnit: ${unitName} | Chapter: ${chapterName}`,
      parse_mode: "Markdown"
    });
  }
});

// AI Assistant text question handler
bot.on("message", (msg) => {
  if (!msg.text || msg.text.startsWith("/") || msg.document) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const state = getState(userId);

  if (state.selectedType === "AI Assistant") {
    return bot.sendMessage(chatId, getAiAssistantReply(text, state), {
      parse_mode: "Markdown"
    });
  }
});

console.log("STUDY MATERIAL BOT (server.js) is running...");
