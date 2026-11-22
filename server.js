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
  .map(id => id.trim());

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN missing in Render Environment Variables");
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

const DATA_FILE = path.join(__dirname, "data.json");

let db = {
  courses: {
    bp: { name: "B.Pharm", semesters: {} },
    dp: { name: "D.Pharm", semesters: {} },
    cet: { name: "Rajasthan CET", semesters: {} },
    class12: { name: "12th Class", semesters: {} }
  }
};

const sessions = {};

function isAdmin(id) {
  return ADMIN_IDS.includes(String(id));
}

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
      );

      if (saved.courses) {
        db = saved;
      }
    } else {
      saveDB();
    }
  } catch (error) {
    console.error("Database error:", error.message);
  }
}

function saveDB() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(db, null, 2)
  );
}

loadDB();

function getSession(id) {
  if (!sessions[id]) {
    sessions[id] = {};
  }

  return sessions[id];
}

const FEATURES = {
  "🟩 Syllabus": "syllabus",
  "🟦 Handwritten Notes": "notes",
  "🟩 PYQ Questions": "pyq",
  "🟩 MCQ Questions": "mcq",
  "🟩 Mock Test": "mock",
  "🟩 AI Assistant": "ai"
};

const COURSES = {
  "🟩 B.Pharm": "bp",
  "🟩 D.Pharm": "dp",
  "🟩 Rajasthan CET": "cet",
  "🟩 12th Class": "class12"
};

const BACK = "⬅️ Back";
const HOME = "🏠 Main Menu";

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
      ["🟩 Syllabus", "🟦 Handwritten Notes"],
      ["🟩 PYQ Questions", "🟩 MCQ Questions"],
      ["🟩 Mock Test", "🟩 AI Assistant"]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

function courseKeyboard() {
  return {
    keyboard: [
      ["🟩 B.Pharm", "🟩 D.Pharm"],
      ["🟩 Rajasthan CET", "🟩 12th Class"],
      [HOME]
    ],
    resize_keyboard: true,
    is_persistent: true
  };
}

function sendHome(chatId) {
  const text =
    "🌸 WELCOME TO TATSAR STUDY BOT 🌸\n\n" +
    "📚 Your Complete Study Assistant\n\n" +
    "📝 Notes and study material\n" +
    "📖 PYQ and MCQ questions\n" +
    "🧪 Mock tests\n" +
    "🤖 AI Study Assistant\n\n" +
    "👇 Select an option below:";

  return bot.sendMessage(chatId, text, {
    reply_markup: mainKeyboard()
  });
}

function sendCourses(chatId) {
  return bot.sendMessage(
    chatId,
    "🎓 Apna course select karein:",
    {
      reply_markup: courseKeyboard()
    }
  );
}

async function sendLongMessage(chatId, content) {
  const text = String(content || "");

  if (!text.trim()) {
    return bot.sendMessage(chatId, "Content available nahi hai.");
  }

  for (let i = 0; i < text.length; i += 3900) {
    await bot.sendMessage(
      chatId,
      text.slice(i, i + 3900)
    );
  }
}

function sendSemesters(chatId, userId, course) {
  const semesters = getSemesters(course);
  const names = Object.keys(semesters);

  if (!names.length) {
    return bot.sendMessage(
      chatId,
      "❌ Abhi is course ka content available nahi hai.",
      { reply_markup: courseKeyboard() }
    );
  }

  const keyboard = names.map(name => [
    `🟩 ${name}`
  ]);

  keyboard.push([BACK], [HOME]);

  const session = getSession(userId);
  session.course = course;

  return bot.sendMessage(
    chatId,
    `📚 ${db.courses[course].name}\n\nSemester select karein:`,
    {
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        is_persistent: true
      }
    }
  );
}

function sendUnits(chatId, userId, semester) {
  const session = getSession(userId);
  const units = getUnits(session.course, semester);
  const names = Object.keys(units);

  if (!names.length) {
    return bot.sendMessage(chatId, "❌ Units available nahi hain.");
  }

  session.semester = semester;

  const keyboard = names.map(name => [
    `🟩 ${name}`
  ]);

  keyboard.push([BACK], [HOME]);

  return bot.sendMessage(
    chatId,
    `📖 ${semester}\n\nUnit select karein:`,
    {
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        is_persistent: true
      }
    }
  );
}
function sendChapters(chatId, userId, unit) {
  const session = getSession(userId);

  const chapters = getChapters(
    session.course,
    session.semester,
    unit
  );

  const names = Object.keys(chapters);

  if (!names.length) {
    return bot.sendMessage(
      chatId,
      "❌ Chapters available nahi hain."
    );
  }

  session.unit = unit;

  const keyboard = names.map(name => [
    `🟩 ${name}`
  ]);

  keyboard.push([BACK], [HOME]);

  return bot.sendMessage(
    chatId,
    `📚 ${unit}\n\nChapter select karein:`,
    {
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        is_persistent: true
      }
    }
  );
}

function sendChapterOptions(chatId, userId, chapter) {
  const session = getSession(userId);
  session.chapter = chapter;

  session.awaitingQuestion = false;

  const keyboard = [
    ["🟩 Syllabus", "🟦 Handwritten Notes"],
    ["🟩 PYQ Questions", "🟩 MCQ Questions"],
    ["🟩 Mock Test", "🟩 AI Assistant"],
    [BACK],
    [HOME]
  ];

  return bot.sendMessage(
    chatId,
    `✅ Chapter Selected\n\n` +
    `${session.course}\n` +
    `${session.semester}\n` +
    `${session.unit}\n` +
    `${chapter}\n\n` +
    "Ab apna study option select karein:",
    {
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        is_persistent: true
      }
    }
  );
}

async function generateAI(prompt, pdfText) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing");
  }

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are TATSAR Study Assistant. " +
            "Explain topics in simple Hinglish. " +
            "Create detailed exam-oriented answers. " +
            "Use headings, definitions, examples and important points. " +
            "Do not claim generated questions are verified actual PYQs."
        },
        {
          role: "user",
          content:
            "SOURCE PDF CONTENT:\n" +
            pdfText.slice(0, 45000) +
            "\n\nTASK:\n" +
            prompt
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

  if (
    !session.course ||
    !session.semester ||
    !session.unit ||
    !session.chapter
  ) {
    return bot.sendMessage(
      chatId,
      "Pehle course aur chapter select karein."
    );
  }

  const chapterData = getChapters(
    session.course,
    session.semester,
    session.unit
  )[session.chapter];

  if (!chapterData || !chapterData.text) {
    return bot.sendMessage(
      chatId,
      "❌ Is chapter ki PDF abhi upload nahi hui hai."
    );
  }

  const prompts = {
    syllabus:
      "PDF ke basis par detailed topic-wise syllabus aur chapter outline banao.",

    notes:
      "PDF ke basis par detailed exam-oriented notes Hinglish mein banao. Definitions, examples, headings aur important points include karo.",

    pyq:
      "PDF ke basis par 20 previous-year-pattern questions answers ke saath banao. Inhe verified actual PYQs mat kehna.",

    mcq:
      "PDF ke basis par 25 MCQs banao. Har question ke 4 options aur correct answer do.",

    mock:
      "PDF ke basis par 20 questions ka mock test banao aur end mein answer key do.",

    ai:
      "Is chapter ke important topics samjhao. Student ko apne questions poochhne ke liye invite karo."
  };

  try {
    await bot.sendMessage(
      chatId,
      "⏳ AI content prepare kar raha hai..."
    );

    const answer = await generateAI(
      prompts[feature],
      chapterData.text
    );

    session.awaitingQuestion = feature === "ai";

    await sendLongMessage(chatId, answer);

    if (feature === "ai") {
      await bot.sendMessage(
        chatId,
        "🤖 Ab isi chapter se related apna question bhejein."
      );
    }
  } catch (error) {
    console.error(
      "AI ERROR:",
      error.response?.data || error.message
    );

    await bot.sendMessage(
      chatId,
      "❌ AI content generate nahi hua. API key aur balance check karein."
    );
  }
}

// ADMIN COMMANDS

bot.onText(/\/addsemester (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [course, semester] = match[1]
    .split("|")
    .map(x => x.trim());

  if (!db.courses[course] || !semester) {
    return bot.sendMessage(
      msg.chat.id,
      "Format:\n/addsemester bp|Semester 1"
    );
  }

  db.courses[course].semesters[semester] =
    db.courses[course].semesters[semester] ||
    { units: {} };

  saveDB();

  bot.sendMessage(
    msg.chat.id,
    "✅ Semester added successfully."
  );
});

bot.onText(/\/addunit (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [course, semester, unit] = match[1]
    .split("|")
    .map(x => x.trim());

  if (!db.courses[course] || !semester || !unit) {
    return bot.sendMessage(
      msg.chat.id,
      "Format:\n/addunit bp|Semester 1|Unit 1"
    );
  }

  db.courses[course].semesters[semester] =
    db.courses[course].semesters[semester] ||
    { units: {} };

  const semesterData =
    db.courses[course].semesters[semester];

  semesterData.units[unit] =
    semesterData.units[unit] || { chapters: {} };

  saveDB();

  bot.sendMessage(
    msg.chat.id,
    "✅ Unit added successfully."
  );
});

bot.onText(/\/addchapter (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const [course, semester, unit, chapter] = match[1]
    .split("|")
    .map(x => x.trim());

  if (!db.courses[course] || !semester || !unit || !chapter) {
    return bot.sendMessage(
      msg.chat.id,
      "Format:\n/addchapter bp|Semester 1|Unit 1|Chapter 1"
    );
  }

  const units = getUnits(course, semester);

  if (!units[unit]) {
    return bot.sendMessage(
      msg.chat.id,
      "Pehle semester aur unit add karein."
    );
  }

  units[unit].chapters[chapter] =
    units[unit].chapters[chapter] || { text: "" };

  saveDB();

  bot.sendMessage(
    msg.chat.id,
    "✅ Chapter added successfully."
  );
});

bot.onText(/\/structure/, msg => {
  if (!isAdmin(msg.from.id)) return;

  sendLongMessage(
    msg.chat.id,
    JSON.stringify(db.courses, null, 2)
  );
});
// PDF UPLOAD SYSTEM

bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (msg.document) {
    if (!isAdmin(userId)) {
      return bot.sendMessage(
        chatId,
        "⛔ PDF upload sirf admin kar sakta hai."
      );
    }

    const caption = (msg.caption || "").trim();

    const [course, semester, unit, chapter] =
      caption.split("|").map(x => x.trim());

    if (!db.courses[course] || !semester || !unit || !chapter) {
      return bot.sendMessage(
        chatId,
        "PDF caption format:\nbp|Semester 1|Unit 1|Chapter 1"
      );
    }

    if (
      !msg.document.file_name ||
      !msg.document.file_name.toLowerCase().endsWith(".pdf")
    ) {
      return bot.sendMessage(
        chatId,
        "Sirf PDF upload karein."
      );
    }

    try {
      await bot.sendMessage(
        chatId,
        "⏳ PDF process ho rahi hai..."
      );

      const fileLink = await bot.getFileLink(
        msg.document.file_id
      );

      const response = await axios.get(fileLink, {
        responseType: "arraybuffer"
      });

      const parsed = await pdfParse(
        Buffer.from(response.data)
      );

      if (!parsed.text.trim()) {
        return bot.sendMessage(
          chatId,
          "PDF mein readable text nahi mila. Scanned PDF ke liye OCR chahiye."
        );
      }

      db.courses[course].semesters[semester] =
        db.courses[course].semesters[semester] ||
        { units: {} };

      const semesterData =
        db.courses[course].semesters[semester];

      semesterData.units[unit] =
        semesterData.units[unit] || { chapters: {} };

      semesterData.units[unit].chapters[chapter] = {
        text: parsed.text
      };

      saveDB();

      await bot.sendMessage(
        chatId,
        "✅ PDF successfully saved!\n\n" +
        `Course: ${course}\n` +
        `Semester: ${semester}\n` +
        `Unit: ${unit}\n` +
        `Chapter: ${chapter}\n\n` +
        "Original PDF users ko nahi bheji jayegi."
      );
    } catch (error) {
      console.error("PDF ERROR:", error.message);

      await bot.sendMessage(
        chatId,
        "❌ PDF process nahi ho payi. Dobara try karein."
      );
    }

    return;
  }

  if (!msg.text) return;

  const text = msg.text.trim();

  if (text.startsWith("/")) return;

  const session = getSession(userId);

  // HOME BUTTON

  if (text === HOME) {
    session.awaitingQuestion = false;
    return sendHome(chatId);
  }

  // BACK BUTTON

  if (text === BACK) {
    session.awaitingQuestion = false;

    if (session.chapter) {
      session.chapter = null;
      return sendChapters(chatId, userId, session.unit);
    }

    if (session.unit) {
      session.unit = null;
      return sendUnits(chatId, userId, session.semester);
    }

    if (session.semester) {
      session.semester = null;
      return sendSemesters(chatId, userId, session.course);
    }

    return sendCourses(chatId);
  }

  // FEATURE SELECTION

  if (FEATURES[text]) {
    session.feature = FEATURES[text];
    session.awaitingQuestion = false;

    return sendCourses(chatId);
  }

  // COURSE SELECTION

  if (COURSES[text]) {
    session.course = COURSES[text];
    session.semester = null;
    session.unit = null;
    session.chapter = null;

    return sendSemesters(
      chatId,
      userId,
      COURSES[text]
    );
  }

  // SEMESTER SELECTION

  if (
    session.course &&
    !session.semester
  ) {
    const selected = text.replace(/^🟩\s*/, "");

    if (getSemesters(session.course)[selected]) {
      return sendUnits(chatId, userId, selected);
    }
  }

  // UNIT SELECTION

  if (
    session.course &&
    session.semester &&
    !session.unit
  ) {
    const selected = text.replace(/^🟩\s*/, "");

    if (getUnits(session.course, session.semester)[selected]) {
      return sendChapters(chatId, userId, selected);
    }
  }

  // CHAPTER SELECTION

  if (
    session.course &&
    session.semester &&
    session.unit &&
    !session.chapter
  ) {
    const selected = text.replace(/^🟩\s*/, "");

    if (
      getChapters(
        session.course,
        session.semester,
        session.unit
      )[selected]
    ) {
      return sendChapterOptions(
        chatId,
        userId,
        selected
      );
    }
  }

  // FEATURE AFTER CHAPTER SELECTION

  if (FEATURES[text] && session.chapter) {
    const feature = FEATURES[text];

    return generateForFeature(
      chatId,
      userId,
      feature
    );
  }

  // AI FOLLOW-UP QUESTIONS

  if (session.awaitingQuestion && session.chapter) {
    const chapterData = getChapters(
      session.course,
      session.semester,
      session.unit
    )[session.chapter];

    if (!chapterData || !chapterData.text) {
      session.awaitingQuestion = false;

      return bot.sendMessage(
        chatId,
        "Chapter data nahi mila. Dobara chapter select karein."
      );
    }

    try {
      await bot.sendMessage(
        chatId,
        "⏳ AI answer prepare kar raha hai..."
      );

      const answer = await generateAI(
        text,
        chapterData.text
      );

      await sendLongMessage(chatId, answer);

      await bot.sendMessage(
        chatId,
        "Aap isi chapter se aur questions pooch sakte hain."
      );
    } catch (error) {
      console.error("AI QUESTION ERROR:", error.message);

      await bot.sendMessage(
        chatId,
        "AI answer generate nahi ho paya."
      );
    }

    return;
  }
});

// START COMMAND

bot.onText(/\/start/, msg => {
  const session = getSession(msg.from.id);
  session.awaitingQuestion = false;

  sendHome(msg.chat.id);
});

// TELEGRAM MENU

bot.setMyCommands([
  {
    command: "start",
    description: "🏠 Main Menu"
  },
  {
    command: "structure",
    description: "Admin: View course structure"
  }
]).catch(error => {
  console.error("Menu command error:", error.message);
});

// WEBSITE HEALTH CHECK

app.get("/", (req, res) => {
  res.send("TATSAR Study Bot is running successfully!");
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    bot: "TATSAR Study Bot"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `TATSAR Study Bot running on port ${PORT}`
  );
});

// TELEGRAM ERRORS

bot.on("polling_error", error => {
  console.error(
    "Telegram polling error:",
    error.message
  );
});