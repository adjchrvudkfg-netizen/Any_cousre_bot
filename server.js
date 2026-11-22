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

const ADMIN_IDS = (process.env.ADMIN_IDS || "8833629094")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN missing in environment variables");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const DATA_FILE = path.join(__dirname, "data.json");

let db = {
  courses: {
    bp: { name: "B.Pharm", semesters: {} },
    dp: { name: "D.Pharm", semesters: {} },
    cet: { name: "Rajasthan CET", semesters: {} },
    class12: { name: "12th Class", semesters: {} }
  }
};

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (saved.courses) db = saved;
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

const sessions = {};

const FEATURES = {
  "📚 Syllabus": "syllabus",
  "📝 Handwritten Notes": "notes",
  "📖 PYQ Questions": "pyq",
  "❓ MCQ Questions": "mcq",
  "🧪 Mock Test": "mock",
  "🤖 AI Assistant": "ai"
};

function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}

function getSession(id) {
  if (!sessions[id]) sessions[id] = {};
  return sessions[id];
}

function getSemesters(course) {
  return db.courses[course]?.semesters || {};
}

function getUnits(course, semester) {
  return getSemesters(course)[semester]?.units || {};
}

function getChapters(course, semester, unit) {
  return getUnits(course, semester)[unit]?.chapters || {};
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
      [{ text: "🏠 Main Menu", callback_data: "home" }]
    ]
  };
}

function sendHome(chatId) {
  return bot.sendMessage(
    chatId,
    "🎓 Welcome to TATSAR Study Bot!\n\nApni study category select karein:",
    { reply_markup: mainKeyboard() }
  );
}

async function sendLongMessage(chatId, content) {
  const text = String(content || "");
  for (let i = 0; i < text.length; i += 3900) {
    await bot.sendMessage(chatId, text.slice(i, i + 3900));
  }
}

function sendSemesters(chatId, course) {
  const semesters = getSemesters(course);
  const names = Object.keys(semesters);

  if (!names.length) {
    return bot.sendMessage(chatId, "Abhi is course ka content available nahi hai.");
  }

  const buttons = names.map(name => [{
    text: name,
    callback_data: `semester|${course}|${name}`
  }]);

  buttons.push([{ text: "⬅️ Courses", callback_data: "courses" }]);

  return bot.sendMessage(
    chatId,
    `${db.courses[course].name} select karein:`,
    { reply_markup: { inline_keyboard: buttons } }
  );
}

function sendUnits(chatId, course, semester) {
  const units = getUnits(course, semester);
  const names = Object.keys(units);

  if (!names.length) {
    return bot.sendMessage(chatId, "Is semester mein units available nahi hain.");
  }

  const buttons = names.map(name => [{
    text: name,
    callback_data: `unit|${course}|${semester}|${name}`
  }]);

  buttons.push([{ text: "⬅️ Back", callback_data: `course|${course}` }]);

  return bot.sendMessage(
    chatId,
    `${semester} ke units select karein:`,
    { reply_markup: { inline_keyboard: buttons } }
  );
}
function sendChapters(chatId, course, semester, unit) {
  const chapters = getChapters(course, semester, unit);
  const names = Object.keys(chapters);

  if (!names.length) {
    return bot.sendMessage(chatId, "Is unit mein chapters available nahi hain.");
  }

  const buttons = names.map(name => [{
    text: name,
    callback_data: `chapter|${course}|${semester}|${unit}|${name}`
  }]);

  buttons.push([{ text: "⬅️ Back", callback_data: `semester|${course}|${semester}` }]);

  return bot.sendMessage(
    chatId,
    `${unit} ke chapters select karein:`,
    { reply_markup: { inline_keyboard: buttons } }
  );
}

function sendFeatureOptions(chatId, userId, course, semester, unit, chapter) {
  const session = getSession(userId);
  session.course = course;
  session.semester = semester;
  session.unit = unit;
  session.chapter = chapter;
  session.awaitingQuestion = false;

  const buttons = [
    [{ text: "📚 Syllabus", callback_data: "again|syllabus" }],
    [{ text: "📝 Notes", callback_data: "again|notes" }],
    [{ text: "📖 PYQ Questions", callback_data: "again|pyq" }],
    [{ text: "❓ MCQ Questions", callback_data: "again|mcq" }],
    [{ text: "🧪 Mock Test", callback_data: "again|mock" }],
    [{ text: "🤖 AI Assistant", callback_data: "again|ai" }],
    [{ text: "🏠 Main Menu", callback_data: "home" }]
  ];

  return bot.sendMessage(
    chatId,
    `Selected Chapter:\n${db.courses[course].name}\n${semester}\n${unit}\n${chapter}\n\nAb apna option select karein:`,
    { reply_markup: { inline_keyboard: buttons } }
  );
}

async function generateAI(prompt, pdfText) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "You are TATSAR Study Assistant. Explain topics in easy Hinglish. Create detailed exam-oriented content with headings, examples and important points. Do not claim generated content is verified PYQ or genuinely handwritten."
        },
        {
          role: "user",
          content: `SOURCE PDF CONTENT:\n${pdfText.slice(0, 45000)}\n\nTASK:\n${prompt}`
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
    syllabus: "PDF ke basis par detailed topic-wise syllabus aur chapter outline banao.",
    notes: "PDF ke basis par detailed exam-oriented notes Hinglish mein banao. Definitions, examples aur important points include karo.",
    pyq: "PDF ke basis par 20 previous-year-pattern questions answers ke saath banao. Inhe verified actual PYQs mat kehna.",
    mcq: "PDF ke basis par 25 MCQs banao. Har question ke 4 options aur correct answer do.",
    mock: "PDF ke basis par 20 questions ka mock test banao aur end mein answer key do.",
    ai: "Is chapter ke important topics samjhao aur student ko apne questions poochhne ke liye invite karo."
  };

  try {
    await bot.sendMessage(chatId, "⏳ AI content prepare kar raha hai...");
    const answer = await generateAI(prompts[feature], chapterData.text);
    session.awaitingQuestion = feature === "ai";
    await sendLongMessage(chatId, answer);

    if (feature === "ai") {
      await bot.sendMessage(chatId, "🤖 Ab isi chapter se related apna question bhejein.");
    }
  } catch (error) {
    console.error("AI ERROR:", error.response?.data || error.message);
    await bot.sendMessage(chatId, "AI content generate nahi hua. API key aur balance check karein.");
  }
}

bot.onText(/\/start/, msg => sendHome(msg.chat.id));

bot.onText(/\/addsemester (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [course, semester] = match[1].split("|").map(x => x.trim());

  if (!db.courses[course] || !semester) {
    return bot.sendMessage(msg.chat.id, "Format:\n/addsemester bp|Semester 1");
  }

  db.courses[course].semesters[semester] =
    db.courses[course].semesters[semester] || { units: {} };

  saveDB();
  bot.sendMessage(msg.chat.id, "✅ Semester added successfully.");
});

bot.onText(/\/addunit (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [course, semester, unit] = match[1].split("|").map(x => x.trim());

  if (!db.courses[course] || !semester || !unit) {
    return bot.sendMessage(msg.chat.id, "Format:\n/addunit bp|Semester 1|Unit 1");
  }

  db.courses[course].semesters[semester] =
    db.courses[course].semesters[semester] || { units: {} };

  const semesterData = db.courses[course].semesters[semester];
  semesterData.units[unit] = semesterData.units[unit] || { chapters: {} };

  saveDB();
  bot.sendMessage(msg.chat.id, "✅ Unit added successfully.");
});

bot.onText(/\/addchapter (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [course, semester, unit, chapter] = match[1].split("|").map(x => x.trim());

  if (!db.courses[course] || !semester || !unit || !chapter) {
    return bot.sendMessage(msg.chat.id, "Format:\n/addchapter bp|Semester 1|Unit 1|Chapter 1");
  }

  const units = getUnits(course, semester);

  if (!units[unit]) {
    return bot.sendMessage(msg.chat.id, "Pehle semester aur unit add karein.");
  }

  units[unit].chapters[chapter] = units[unit].chapters[chapter] || { text: "" };

  saveDB();
  bot.sendMessage(msg.chat.id, "✅ Chapter added successfully.");
});

bot.onText(/\/structure/, msg => {
  if (!isAdmin(msg.from.id)) return;
  sendLongMessage(msg.chat.id, JSON.stringify(db.courses, null, 2));
});
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (msg.document) {
    if (!isAdmin(userId)) {
      return bot.sendMessage(chatId, "⛔ PDF upload sirf admin kar sakta hai.");
    }

    const caption = (msg.caption || "").trim();
    const [course, semester, unit, chapter] = caption.split("|").map(x => x.trim());

    if (!db.courses[course] || !semester || !unit || !chapter) {
      return bot.sendMessage(chatId, "PDF caption format:\nbp|Semester 1|Unit 1|Chapter 1");
    }

    if (!msg.document.file_name || !msg.document.file_name.toLowerCase().endsWith(".pdf")) {
      return bot.sendMessage(chatId, "Sirf PDF upload karein.");
    }

    try {
      await bot.sendMessage(chatId, "⏳ PDF process ho rahi hai...");

      const fileLink = await bot.getFileLink(msg.document.file_id);
      const response = await axios.get(fileLink, { responseType: "arraybuffer" });
      const parsed = await pdfParse(Buffer.from(response.data));

      if (!parsed.text.trim()) {
        return bot.sendMessage(chatId, "PDF mein readable text nahi mila. Scanned PDF ke liye OCR chahiye.");
      }

      db.courses[course].semesters[semester] =
        db.courses[course].semesters[semester] || { units: {} };

      const semesterData = db.courses[course].semesters[semester];
      semesterData.units[unit] = semesterData.units[unit] || { chapters: {} };
      semesterData.units[unit].chapters[chapter] = { text: parsed.text };

      saveDB();

      await bot.sendMessage(
        chatId,
        `✅ PDF successfully saved!\n\nCourse: ${course}\nSemester: ${semester}\nUnit: ${unit}\nChapter: ${chapter}\n\nOriginal PDF users ko send nahi hogi.`
      );
    } catch (error) {
      console.error("PDF ERROR:", error.message);
      await bot.sendMessage(chatId, "PDF process nahi ho payi. Dobara try karein.");
    }

    return;
  }

  if (!msg.text) return;

  const text = msg.text.trim();
  if (text.startsWith("/")) return;

  if (FEATURES[text]) {
    const session = getSession(userId);
    session.feature = FEATURES[text];
    session.awaitingQuestion = false;

    return bot.sendMessage(chatId, "Apna course select karein:", {
      reply_markup: courseKeyboard()
    });
  }

  const session = getSession(userId);

  if (session.awaitingQuestion && session.chapter) {
    const chapterData = getChapters(
      session.course,
      session.semester,
      session.unit
    )[session.chapter];

    if (!chapterData) {
      session.awaitingQuestion = false;
      return bot.sendMessage(chatId, "Chapter data nahi mila. Dobara chapter select karein.");
    }

    try {
      await bot.sendMessage(chatId, "⏳ AI aapke question ka answer prepare kar raha hai...");
      const answer = await generateAI(text, chapterData.text);
      await sendLongMessage(chatId, answer);
      await bot.sendMessage(chatId, "Aap isi chapter se aur question pooch sakte hain.");
    } catch (error) {
      console.error("AI QUESTION ERROR:", error.message);
      await bot.sendMessage(chatId, "AI answer generate nahi ho paya.");
    }
  }
});

bot.on("callback_query", async query => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data || "";
  const parts = data.split("|");

  bot.answerCallbackQuery(query.id).catch(() => {});

  if (data === "home") return sendHome(chatId);

  if (data === "courses") {
    return bot.sendMessage(chatId, "Apna course select karein:", {
      reply_markup: courseKeyboard()
    });
  }

  if (parts[0] === "course") return sendSemesters(chatId, parts[1]);

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

app.get("/", (req, res) => {
  res.send("TATSAR Study Bot is running successfully!");
});

app.get("/health", (req, res) => {
  res.json({ status: "online", bot: "TATSAR Study Bot" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TATSAR Study Bot running on port ${PORT}`);
});

bot.on("polling_error", error => {
  console.error("Telegram polling error:", error.message);
});