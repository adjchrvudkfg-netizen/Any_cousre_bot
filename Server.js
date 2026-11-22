
require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN missing in .env");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const DATA_FILE = path.join(__dirname, "data.json");

let db = {
  courses: {
    bp: {
      name: "B.Pharm",
      semesters: {}
    },
    dp: {
      name: "D.Pharm",
      semesters: {}
    },
    cet: {
      name: "Rajasthan CET",
      semesters: {}
    },
    class12: {
      name: "12th Class",
      semesters: {}
    }
  }
};

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } else {
      saveDB();
    }
  } catch (error) {
    console.error("Database load error:", error.message);
  }
}

function saveDB() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

loadDB();

const FEATURES = {
  syllabus: "Syllabus",
  notes: "Handwritten Notes",
  pyq: "PYQ Questions",
  mcq: "MCQ Questions",
  mock: "Mock Test",
  ai: "AI Assistant"
};

const sessions = {};

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

function getSession(userId) {
  if (!sessions[userId]) {
    sessions[userId] = {};
  }
  return sessions[userId];
}

function mainKeyboard() {
  return {
    keyboard: [
      ["📚 Syllabus", "📝 Handwritten Notes"],
      ["📖 PYQ Questions", "❓ MCQ Questions"],
      ["🧪 Mock Test", "🤖 AI Assistant"]
    ],
    resize_keyboard: true
  };
}

function courseKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "B.Pharm", callback_data: "course|bp" },
        { text: "D.Pharm", callback_data: "course|dp" }
      ],
      [
        { text: "Rajasthan CET", callback_data: "course|cet" },
        { text: "12th Class", callback_data: "course|class12" }
      ],
      [
        { text: "🏠 Main Menu", callback_data: "home" }
      ]
    ]
  };
}

function getCourseName(code) {
  return db.courses[code]?.name || code;
}

function getSemesters(courseCode) {
  return db.courses[courseCode]?.semesters || {};
}

function getUnits(courseCode, semester) {
  return getSemesters(courseCode)[semester]?.units || {};
}

function getChapters(courseCode, semester, unit) {
  return getUnits(courseCode, semester)[unit]?.chapters || {};
}

function safeText(value) {
  return String(value || "").trim();
}

function sendHome(chatId) {
  bot.sendMessage(
    chatId,
    "🎓 Welcome to TATSAR Study Bot\n\nApni study category select karein:",
    { reply_markup: mainKeyboard() }
  );
}

function sendSemesters(chatId, userId, courseCode) {
  const semesters = getSemesters(courseCode);
  const names = Object.keys(semesters);

  if (!names.length) {
    return bot.sendMessage(chatId, "Abhi is course ka content available nahi hai.");
  }

  const buttons = names.map(name => [{
    text: name,
    callback_data: `semester|${courseCode}|${name}`
  }]);

  buttons.push([{ text: "⬅️ Back", callback_data: "courses" }]);

  bot.sendMessage(
    chatId,
    `${getCourseName(courseCode)} select karein:`,
    { reply_markup: { inline_keyboard: buttons } }
  );
}

function sendUnits(chatId, courseCode, semester) {
  const units = getUnits(courseCode, semester);
  const names = Object.keys(units);

  if (!names.length) {
    return bot.sendMessage(chatId, "Is level mein abhi units nahi hain.");
  }

  const buttons = names.map(name => [{
    text: name,
    callback_data: `unit|${courseCode}|${semester}|${name}`
  }]);

  buttons.push([{
    text: "⬅️ Back",
    callback_data: `course|${courseCode}`
  }]);

  bot.sendMessage(
    chatId,
    `${semester} ke units select karein:`,
    { reply_markup: { inline_keyboard: buttons } }
  );
}

function sendChapters(chatId, courseCode, semester, unit) {
  const chapters = getChapters(courseCode, semester, unit);
  const names = Object.keys(chapters);

  if (!names.length) {
    return bot.sendMessage(chatId, "Is unit mein abhi chapters nahi hain.");
  }

  const buttons = names.map(name => [{
    text: name,
    callback_data: `chapter|${courseCode}|${semester}|${unit}|${name}`
  }]);

  buttons.push([{
    text: "⬅️ Back",
    callback_data: `semester|${courseCode}|${semester}`
  }]);

  bot.sendMessage(
    chatId,
    `${unit} ke chapters select karein:`,
    { reply_markup: { inline_keyboard: buttons } }
  );
}

function sendFeatureOptions(chatId, userId, courseCode, semester, unit, chapter) {
  const session = getSession(userId);

  session.course = courseCode;
  session.semester = semester;
  session.unit = unit;
  session.chapter = chapter;

  const buttons = [
    [{ text: "📚 Syllabus", callback_data: "again|syllabus" }],
    [{ text: "📝 Notes", callback_data: "again|notes" }],
    [{ text: "📖 PYQ Questions", callback_data: "again|pyq" }],
    [{ text: "❓ MCQ Questions", callback_data: "again|mcq" }],
    [{ text: "🧪 Mock Test", callback_data: "again|mock" }],
    [{ text: "🤖 AI Assistant", callback_data: "again|ai" }],
    [{ text: "🏠 Main Menu", callback_data: "home" }]
  ];

  bot.sendMessage(
    chatId,
    `Selected:\n${getCourseName(courseCode)}\n${semester}\n${unit}\n${chapter}\n\nAb kya chahiye?`,
    { reply_markup: { inline_keyboard: buttons } }
  );
}

async function generateAI(prompt, pdfText) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing in .env");
  }

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "You are TATSAR Study Assistant. Explain study topics in detailed, easy Hinglish. Use headings, examples and exam-focused points. Do not claim that generated notes are handwritten."
        },
        {
          role: "user",
          content: `PDF CONTENT:\n${pdfText.slice(0, 45000)}\n\nTASK:\n${prompt}`
        }
      ],
      temperature: 0.5
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 120000
    }
  );

  return response.data.choices[0].message.content;
}

async function generateForFeature(chatId, userId, feature) {
  const session = getSession(userId);

  const { course, semester, unit, chapter } = session;

  if (!course || !semester || !unit || !chapter) {
    return bot.sendMessage(chatId, "Pehle course aur chapter select karein.");
  }

  const chapterData = getChapters(course, semester, unit)[chapter];

  if (!chapterData || !chapterData.text) {
    return bot.sendMessage(chatId, "Is chapter ki PDF abhi upload nahi hui hai.");
  }

  const prompts = {
    syllabus: "Is PDF ke basis par chapter ka detailed syllabus aur topic-wise outline banao.",
    notes: "Is PDF ke basis par detailed exam-oriented study notes Hinglish mein banao. Important definitions, explanations aur examples include karo.",
    pyq: "Is PDF ke basis par exam-style previous-year-pattern questions aur unke answers banao. Inhe actual verified PYQs mat kehna.",
    mcq: "Is PDF ke basis par 25 MCQ banao. Har question ke 4 options aur correct answer do.",
    mock: "Is PDF ke basis par 20 questions ka mock test banao. Answer key end mein do.",
    ai: "Is PDF ke important topics samjhao aur student ko questions poochhne ke liye invite karo."
  };

  try {
    await bot.sendMessage(chatId, "⏳ Content prepare ho raha hai, thoda wait karein...");

    const answer = await generateAI(prompts[feature], chapterData.text);

    session.awaitingQuestion = feature === "ai";

    await bot.sendMessage(chatId, answer.slice(0, 4000));

    if (feature === "ai") {
      await bot.sendMessage(chatId, "🤖 Ab isi chapter se related apna question bhejein.");
    }
  } catch (error) {
    console.error("AI error:", error.response?.data || error.message);
    bot.sendMessage(chatId, "Content generate nahi ho paya. API key aur server logs check karein.");
  }
}

bot.onText(/\/start/, (msg) => {
  sendHome(msg.chat.id);
});

bot.on("message", async (msg) => {
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();

  if (text.startsWith("/")) return;

  const featureMap = {
    "📚 Syllabus": "syllabus",
    "📝 Handwritten Notes": "notes",
    "📖 PYQ Questions": "pyq",
    "❓ MCQ Questions": "mcq",
    "🧪 Mock Test": "mock",
    "🤖 AI Assistant": "ai"
  };

  if (featureMap[text]) {
    getSession(userId).feature = featureMap[text];
    return bot.sendMessage(chatId, "Apna course select karein:", {
      reply_markup: courseKeyboard()
    });
  }

  const session = getSession(userId);

  if (session.awaitingQuestion && session.chapter) {
    session.awaitingQuestion = false;

    const chapterData = getChapters(
      session.course,
      session.semester,
      session.unit
    )[session.chapter];

    if (!chapterData) return;

    try {
      const answer = await generateAI(text, chapterData.text);
      return bot.sendMessage(chatId, answer.slice(0, 4000));
    } catch (error) {
      console.error(error.message);
      return bot.sendMessage(chatId, "AI answer nahi mil paya.");
    }
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data || "";
  const parts = data.split("|");

  bot.answerCallbackQuery(query.id).catch(() => {});

  if (data === "home") {
    return sendHome(chatId);
  }

  if (data === "courses") {
    return bot.sendMessage(chatId, "Apna course select karein:", {
      reply_markup: courseKeyboard()
    });
  }

  if (parts[0] === "course") {
    return sendSemesters(chatId, userId, parts[1]);
  }

  if (parts[0] === "semester") {
    return sendUnits(chatId, parts[1], parts[2]);
  }

  if (parts[0] === "unit") {
    return sendChapters(chatId, parts[1], parts[2], parts[3]);
  }

  if (parts[0] === "chapter") {
    return sendFeatureOptions(
      chatId,
      userId,
      parts[1],
      parts[2],
      parts[3],
      parts.slice(4).join("|")
    );
  }

  if (parts[0] === "again") {
    return generateForFeature(chatId, userId, parts[1]);
  }
});

// ADMIN: Add semester / level
bot.onText(/\/addsemester (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [course, semester] = match[1].split("|").map(s => s.trim());

  if (!db.courses[course] || !semester) {
    return bot.sendMessage(msg.chat.id, "Format: /addsemester bp|Semester 1");
  }

  db.courses[course].semesters[semester] = 
    db.courses[course].semesters[semester] || { units: {} };

  saveDB();
  bot.sendMessage(msg.chat.id, "✅ Semester/Level added.");
});

// ADMIN: Add unit
bot.onText(/\/addunit (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [course, semester, unit] = match[1].split("|").map(s => s.trim());

  if (!db.courses[course] || !semester || !unit) {
    return bot.sendMessage(msg.chat.id, "Format: /addunit bp|Semester 1|Unit 1");
  }

  db.courses[course].semesters[semester] =
    db.courses[course].semesters[semester] || { units: {} };

  db.courses[course].semesters[semester].units[unit] =
    db.courses[course].semesters[semester].units[unit] || { chapters: {} };

  saveDB();
  bot.sendMessage(msg.chat.id, "✅ Unit added.");
});

// ADMIN: Add chapter
bot.onText(/\/addchapter (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [course, semester, unit, chapter] =
    match[1].split("|").map(s => s.trim());

  if (!db.courses[course] || !semester || !unit || !chapter) {
    return bot.sendMessage(
      msg.chat.id,
      "Format: /addchapter bp|Semester 1|Unit 1|Chapter 1"
    );
  }

  const units = db.courses[course].semesters[semester]?.units;

  if (!units || !units[unit]) {
    return bot.sendMessage(msg.chat.id, "Pehle semester aur unit add karein.");
  }

  units[unit].chapters[chapter] =
    units[unit].chapters[chapter] || { text: "" };

  saveDB();
  bot.sendMessage(msg.chat.id, "✅ Chapter added.");
});

// ADMIN: Show structure
bot.onText(/\/structure/, (msg) => {
  if (!isAdmin(msg.from.id)) return;

  bot.sendMessage(
    msg.chat.id,
    "Current database structure:\n" +
    JSON.stringify(db.courses, null, 2).slice(0, 3500)
  );
});

// ADMIN: Upload PDF with caption
bot.on("document", async (msg) => {
  if (!isAdmin(msg.from.id)) return;

  const caption = safeText(msg.caption);
  const [course, semester, unit, chapter] =
    caption.split("|").map(s => s.trim());

  if (!db.courses[course] || !semester || !unit || !chapter) {
    return bot.sendMessage(
      msg.chat.id,
      "PDF caption format:\nbp|Semester 1|Unit 1|Chapter 1"
    );
  }

  const document = msg.document;

  if (!document.file_name?.toLowerCase().endsWith(".pdf")) {
    return bot.sendMessage(msg.chat.id, "Sirf PDF file upload karein.");
  }

  try {
    const fileLink = await bot.getFileLink(document.file_id);
    const response = await axios.get(fileLink, {
      responseType: "arraybuffer"
    });

    const parsed = await pdfParse(Buffer.from(response.data));

    if (!parsed.text.trim()) {
      return bot.sendMessage(
        msg.chat.id,
        "PDF mein readable text nahi mila. Scanned PDF ke liye OCR zaroori hai."
      );
    }

    db.courses[course].semesters[semester] =
      db.courses[course].semesters[semester] || { units: {} };

    db.courses[course].semesters[semester].units[unit] =
      db.courses[course].semesters[semester].units[unit] || { chapters: {} };

    db.courses[course].semesters[semester].units[unit].chapters[chapter] = {
      text: parsed.text
    };

    saveDB();

    bot.sendMessage(
      msg.chat.id,
      `✅ PDF successfully saved.\nCourse: ${course}\nChapter: ${chapter}\n\nOriginal PDF users ko send nahi hogi.`
    );
  } catch (error) {
    console.error("PDF error:", error.message);
    bot.sendMessage(msg.chat.id, "PDF process nahi ho payi.");
  }
});

app.get("/", (req, res) => {
  res.send("TATSAR Study Bot is running.");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

