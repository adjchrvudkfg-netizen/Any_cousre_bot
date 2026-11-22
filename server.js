// ============================================
// TATSAR STUDY BOT
// INLINE BUTTON SYSTEM
// ============================================

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
require("dotenv").config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!TOKEN) {
  throw new Error("BOT_TOKEN Render Environment Variables mein set karein.");
}

const bot = new TelegramBot(TOKEN, {
  polling: true
});

const DATA_FILE = path.join(__dirname, "data.json");

const DEFAULT_DB = {
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
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(DEFAULT_DB, null, 2)
      );
      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }

    const saved = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    saved.courses = saved.courses || {};

    for (const code of Object.keys(DEFAULT_DB.courses)) {
      if (!saved.courses[code]) {
        saved.courses[code] =
          JSON.parse(JSON.stringify(DEFAULT_DB.courses[code]));
      }
    }

    return saved;
  } catch (error) {
    console.error("DATABASE ERROR:", error.message);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(db, null, 2),
    "utf8"
  );
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

// ============================================
// USER SESSIONS
// ============================================

const sessions = new Map();

function getSession(userId) {
  const id = String(userId);

  if (!sessions.has(id)) {
    sessions.set(id, {
      feature: null,
      course: null,
      semester: null,
      unit: null,
      chapter: null,
      step: "home",
      awaitingQuestion: false,
      pickMap: {}
    });
  }

  return sessions.get(id);
}

// ============================================
// COURSE DATA FUNCTIONS
// ============================================

function getSemesters(course) {
  return db.courses[course]?.semesters || {};
}

function getUnits(course, semester) {
  return getSemesters(course)[semester]?.units || {};
}

function getChapters(course, semester, unit) {
  return getUnits(course, semester)[unit]?.chapters || {};
}

const COURSES = {
  "bp": "B.Pharm",
  "dp": "D.Pharm",
  "cet": "Rajasthan CET",
  "class12": "12th Class"
};

const FEATURE_NAMES = {
  syllabus: "🟩 Syllabus",
  notes: "🟦 Handwritten Notes",
  pyq: "🟩 PYQ Questions",
  mcq: "🟩 MCQ Questions",
  mock: "🟩 Mock Test",
  ai: "🟩 AI Assistant"
};

// ============================================
// SEND LONG MESSAGES
// ============================================

async function sendLongMessage(chatId, message) {
  const text = String(message || "");

  if (!text.trim()) {
    return bot.sendMessage(chatId, "Content available nahi hai.");
  }

  const chunks = text.match(/[\s\S]{1,3900}/g) || [];

  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk);
  }
}

// ============================================
// INLINE KEYBOARD HELPERS
// ============================================

function makeRows(items, columns = 2) {
  const rows = [];

  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }

  return rows;
}

async function sendInlineMenu(chatId, text, keyboard) {
  return bot.sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

// ============================================
// MAIN MENU
// ============================================

function getMainKeyboard() {
  return [
    [
      {
        text: "🟩 Syllabus",
        callback_data: "f:syllabus"
      },
      {
        text: "🟦 Handwritten Notes",
        callback_data: "f:notes"
      }
    ],
    [
      {
        text: "🟩 PYQ Questions",
        callback_data: "f:pyq"
      },
      {
        text: "🟩 MCQ Questions",
        callback_data: "f:mcq"
      }
    ],
    [
      {
        text: "🟩 Mock Test",
        callback_data: "f:mock"
      },
      {
        text: "🟩 AI Assistant",
        callback_data: "f:ai"
      }
    ]
  ];
}

async function sendHome(chatId, userId) {
  const session = getSession(userId);

  session.feature = null;
  session.course = null;
  session.semester = null;
  session.unit = null;
  session.chapter = null;
  session.step = "home";
  session.awaitingQuestion = false;

  return sendInlineMenu(
    chatId,
    "🌸 WELCOME TO TATSAR STUDY BOT 🌸\n\n" +
    "📚 Your Complete Study Assistant\n\n" +
    "📝 Notes and study material\n" +
    "📖 PYQ and MCQ questions\n" +
    "🧪 Mock tests\n" +
    "🤖 AI Study Assistant\n\n" +
    "👇 Select an option below:",
    getMainKeyboard()
  );
}

// ============================================
// PICK MENU WITH INLINE BUTTONS
// ============================================

async function sendPickMenu(
  chatId,
  userId,
  type,
  title,
  items,
  backAction = "back"
) {
  const session = getSession(userId);

  session.pickMap[type] = items;
  session.step = type;

  if (!items.length) {
    return sendInlineMenu(
      chatId,
      "❌ Abhi is section ka content available nahi hai.",
      [[
        {
          text: "🏠 Main Menu",
          callback_data: "nav:home"
        }
      ]]
    );
  }

  const buttons = items.map((item, index) => ({
    text: "🟩 " + item,
    callback_data: `p:${type}:${index}`
  }));

  const keyboard = makeRows(buttons, 2);

  keyboard.push([
    {
      text: "⬅️ Back",
      callback_data: "nav:" + backAction
    },
    {
      text: "🏠 Main Menu",
      callback_data: "nav:home"
    }
  ]);

  return sendInlineMenu(
    chatId,
    title,
    keyboard
  );
}
// ============================================
// COURSE SELECTION
// ============================================

async function sendCourses(chatId, userId) {
  const session = getSession(userId);

  session.step = "courses";

  const keyboard = [
    [
      { text: "🟩 B.Pharm", callback_data: "c:bp" },
      { text: "🟩 D.Pharm", callback_data: "c:dp" }
    ],
    [
      { text: "🟩 Rajasthan CET", callback_data: "c:cet" },
      { text: "🟩 12th Class", callback_data: "c:class12" }
    ],
    [
      { text: "🏠 Main Menu", callback_data: "nav:home" }
    ]
  ];

  return sendInlineMenu(
    chatId,
    "📚 Apna course select karein:",
    keyboard
  );
}

// ============================================
// SEMESTER / LEVEL SELECTION
// ============================================

async function sendSemesters(chatId, userId) {
  const session = getSession(userId);

  const semesters = Object.keys(
    getSemesters(session.course)
  );

  return sendPickMenu(
    chatId,
    userId,
    "semester",
    "📚 " + COURSES[session.course] +
    "\n\nSemester / Level select karein:",
    semesters,
    "courses"
  );
}

// ============================================
// UNIT SELECTION
// ============================================

async function sendUnits(chatId, userId) {
  const session = getSession(userId);

  const units = Object.keys(
    getUnits(session.course, session.semester)
  );

  return sendPickMenu(
    chatId,
    userId,
    "unit",
    "📖 " + session.semester +
    "\n\nUnit select karein:",
    units,
    "semesters"
  );
}

// ============================================
// CHAPTER SELECTION
// ============================================

async function sendChapters(chatId, userId) {
  const session = getSession(userId);

  const chapters = Object.keys(
    getChapters(
      session.course,
      session.semester,
      session.unit
    )
  );

  return sendPickMenu(
    chatId,
    userId,
    "chapter",
    "📚 " + session.unit +
    "\n\nChapter select karein:",
    chapters,
    "units"
  );
}

// ============================================
// STUDY OPTIONS AFTER CHAPTER
// ============================================

async function sendStudyOptions(chatId, userId) {
  const session = getSession(userId);

  session.step = "options";

  const keyboard = [
    [
      { text: "🟩 Syllabus", callback_data: "f:syllabus" },
      { text: "🟦 Handwritten Notes", callback_data: "f:notes" }
    ],
    [
      { text: "🟩 PYQ Questions", callback_data: "f:pyq" },
      { text: "🟩 MCQ Questions", callback_data: "f:mcq" }
    ],
    [
      { text: "🟩 Mock Test", callback_data: "f:mock" },
      { text: "🟩 AI Assistant", callback_data: "f:ai" }
    ],
    [
      { text: "⬅️ Back", callback_data: "nav:chapters" },
      { text: "🏠 Main Menu", callback_data: "nav:home" }
    ]
  ];

  return sendInlineMenu(
    chatId,
    "✅ Chapter selected!\n\n" +
    "📘 " + session.chapter +
    "\n\nAb study option select karein:",
    keyboard
  );
}

// ============================================
// OPENAI CONTENT GENERATION
// ============================================

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
            "Explain everything in easy Hinglish. " +
            "Use clear headings, definitions, examples, " +
            "important points and exam-oriented explanations. " +
            "Use the supplied PDF as your main source. " +
            "Do not invent claims that questions are verified actual PYQs. " +
            "If the PDF does not contain an answer, clearly say so."
        },
        {
          role: "user",
          content:
            "PDF SOURCE CONTENT:\n" +
            pdfText.slice(0, 45000) +
            "\n\nSTUDENT TASK:\n" +
            prompt
        }
      ],
      temperature: 0.5
    },
    {
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      timeout: 120000
    }
  );

  return response.data.choices[0].message.content;
}

// ============================================
// GENERATE STUDY CONTENT
// ============================================

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
      "❌ Is chapter ki PDF abhi admin ne upload nahi ki hai."
    );
  }

  const prompts = {
    syllabus:
      "Is chapter ka detailed topic-wise syllabus aur outline banao.",

    notes:
      "Is chapter ke detailed exam-oriented notes Hinglish mein banao. " +
      "Definitions, headings, examples, diagrams ko text mein explain karo " +
      "aur important points include karo.",

    pyq:
      "Is chapter ke 20 previous-year-pattern questions answers ke saath banao. " +
      "Inhe actual verified PYQ mat kehna.",

    mcq:
      "Is chapter ke 25 MCQ banao. Har question ke 4 options aur correct answer do.",

    mock:
      "Is chapter ka 20-question mock test banao. " +
      "End mein answer key aur short explanations do.",

    ai:
      "Is chapter ke important concepts ko easy Hinglish mein samjhao. " +
      "Student ko follow-up questions poochhne ke liye invite karo."
  };

  try {
    await bot.sendMessage(
      chatId,
      "⏳ AI tumhara study material prepare kar raha hai..."
    );

    const answer = await generateAI(
      prompts[feature],
      chapterData.text
    );

    session.awaitingQuestion = feature === "ai";
    session.feature = feature;

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
      "❌ AI content generate nahi hua.\n" +
      "OpenAI API key, API balance aur model check karein."
    );
  }
}

// ============================================
// ADMIN: ADD SEMESTER
// ============================================

bot.onText(/\/addsemester (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const parts = match[1].split("|").map(x => x.trim());

  const course = parts[0];
  const semester = parts[1];

  if (!db.courses[course] || !semester) {
    return bot.sendMessage(
      msg.chat.id,
      "Format:\n/addsemester bp|Semester 1"
    );
  }

  db.courses[course].semesters[semester] =
    db.courses[course].semesters[semester] || {
      units: {}
    };

  saveDB();

  bot.sendMessage(
    msg.chat.id,
    "✅ Semester / Level added successfully."
  );
});

// ============================================
// ADMIN: ADD UNIT
// ============================================

bot.onText(/\/addunit (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const parts = match[1].split("|").map(x => x.trim());

  const course = parts[0];
  const semester = parts[1];
  const unit = parts[2];

  if (!db.courses[course] || !semester || !unit) {
    return bot.sendMessage(
      msg.chat.id,
      "Format:\n/addunit bp|Semester 1|Unit 1"
    );
  }

  db.courses[course].semesters[semester] =
    db.courses[course].semesters[semester] || {
      units: {}
    };

  const semesterData =
    db.courses[course].semesters[semester];

  semesterData.units[unit] =
    semesterData.units[unit] || {
      chapters: {}
    };

  saveDB();

  bot.sendMessage(
    msg.chat.id,
    "✅ Unit added successfully."
  );
});

// ============================================
// ADMIN: ADD CHAPTER
// ============================================

bot.onText(/\/addchapter (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const parts = match[1].split("|").map(x => x.trim());

  const course = parts[0];
  const semester = parts[1];
  const unit = parts[2];
  const chapter = parts[3];

  if (
    !db.courses[course] ||
    !semester ||
    !unit ||
    !chapter
  ) {
    return bot.sendMessage(
      msg.chat.id,
      "Format:\n/addchapter bp|Semester 1|Unit 1|Chapter 1"
    );
  }

  db.courses[course].semesters[semester] =
    db.courses[course].semesters[semester] || {
      units: {}
    };

  const semesterData =
    db.courses[course].semesters[semester];

  semesterData.units[unit] =
    semesterData.units[unit] || {
      chapters: {}
    };

  semesterData.units[unit].chapters[chapter] =
    semesterData.units[unit].chapters[chapter] || {
      text: ""
    };

  saveDB();

  bot.sendMessage(
    msg.chat.id,
    "✅ Chapter added successfully."
  );
});

// ============================================
// ADMIN: VIEW STRUCTURE
// ============================================

bot.onText(/\/structure/, msg => {
  if (!isAdmin(msg.from.id)) return;

  sendLongMessage(
    msg.chat.id,
    JSON.stringify(db.courses, null, 2)
  );
});
// ============================================
// INLINE BUTTON CLICK HANDLER
// ============================================

bot.on("callback_query", async query => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data || "";

  const session = getSession(userId);

  try {
    await bot.answerCallbackQuery(query.id);

    // MAIN MENU

    if (data === "nav:home") {
      return sendHome(chatId, userId);
    }

    // BACK NAVIGATION

    if (data === "nav:courses") {
      session.semester = null;
      session.unit = null;
      session.chapter = null;
      return sendCourses(chatId, userId);
    }

    if (data === "nav:semesters") {
      session.unit = null;
      session.chapter = null;
      return sendSemesters(chatId, userId);
    }

    if (data === "nav:units") {
      session.chapter = null;
      return sendUnits(chatId, userId);
    }

    if (data === "nav:chapters") {
      session.chapter = null;
      return sendChapters(chatId, userId);
    }

    if (data === "nav:back") {
      if (session.step === "options") {
        session.chapter = null;
        return sendChapters(chatId, userId);
      }

      if (session.step === "chapter") {
        session.unit = null;
        return sendUnits(chatId, userId);
      }

      if (session.step === "unit") {
        session.semester = null;
        return sendSemesters(chatId, userId);
      }

      if (session.step === "semester") {
        return sendCourses(chatId, userId);
      }

      return sendHome(chatId, userId);
    }

    // FEATURE BUTTONS

    if (data.startsWith("f:")) {
      const feature = data.substring(2);

      if (!FEATURE_NAMES[feature]) return;

      session.awaitingQuestion = false;
      session.feature = feature;

      if (session.chapter) {
        return generateForFeature(
          chatId,
          userId,
          feature
        );
      }

      return sendCourses(chatId, userId);
    }

    // COURSE BUTTONS

    if (data.startsWith("c:")) {
      const course = data.substring(2);

      if (!db.courses[course]) return;

      session.course = course;
      session.semester = null;
      session.unit = null;
      session.chapter = null;
      session.awaitingQuestion = false;

      return sendSemesters(chatId, userId);
    }

    // SEMESTER, UNIT AND CHAPTER BUTTONS

    if (data.startsWith("p:")) {
      const parts = data.split(":");

      const type = parts[1];
      const index = Number(parts[2]);

      const items = session.pickMap[type];

      if (
        !items ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= items.length
      ) {
        return bot.sendMessage(
          chatId,
          "Menu expire ho gaya. Dobara /start karein."
        );
      }

      const selected = items[index];

      if (type === "semester") {
        session.semester = selected;
        session.unit = null;
        session.chapter = null;

        return sendUnits(chatId, userId);
      }

      if (type === "unit") {
        session.unit = selected;
        session.chapter = null;

        return sendChapters(chatId, userId);
      }

      if (type === "chapter") {
        session.chapter = selected;
        session.awaitingQuestion = false;

        return sendStudyOptions(chatId, userId);
      }
    }

  } catch (error) {
    console.error(
      "CALLBACK ERROR:",
      error.message
    );

    bot.sendMessage(
      chatId,
      "❌ Button process nahi ho paya. Dobara try karein."
    ).catch(() => {});
  }
});

// ============================================
// ADMIN PDF UPLOAD
// ============================================

bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // PDF DOCUMENT

  if (msg.document) {
    if (!isAdmin(userId)) {
      return bot.sendMessage(
        chatId,
        "⛔ PDF upload sirf admin kar sakta hai."
      );
    }

    const fileName = msg.document.file_name || "";

    if (!fileName.toLowerCase().endsWith(".pdf")) {
      return bot.sendMessage(
        chatId,
        "❌ Sirf PDF file upload karein."
      );
    }

    const caption = (msg.caption || "").trim();

    const parts = caption.split("|").map(x => x.trim());

    const course = parts[0];
    const semester = parts[1];
    const unit = parts[2];
    const chapter = parts[3];

    if (
      !db.courses[course] ||
      !semester ||
      !unit ||
      !chapter
    ) {
      return bot.sendMessage(
        chatId,
        "PDF ke saath ye caption likhein:\n\n" +
        "bp|Semester 1|Unit 1|Chapter 1"
      );
    }

    try {
      await bot.sendMessage(
        chatId,
        "⏳ PDF download aur process ho rahi hai..."
      );

      const fileLink = await bot.getFileLink(
        msg.document.file_id
      );

      const response = await axios.get(
        fileLink,
        {
          responseType: "arraybuffer",
          timeout: 120000
        }
      );

      const parsed = await pdfParse(
        Buffer.from(response.data)
      );

      const extractedText = (parsed.text || "").trim();

      if (!extractedText) {
        return bot.sendMessage(
          chatId,
          "❌ PDF mein readable text nahi mila.\n" +
          "Scanned PDF ke liye OCR ki zaroorat hogi."
        );
      }

      // CREATE COURSE STRUCTURE IF MISSING

      db.courses[course].semesters[semester] =
        db.courses[course].semesters[semester] || {
          units: {}
        };

      const semesterData =
        db.courses[course].semesters[semester];

      semesterData.units[unit] =
        semesterData.units[unit] || {
          chapters: {}
        };

      semesterData.units[unit].chapters[chapter] = {
        text: extractedText,
        updatedAt: new Date().toISOString()
      };

      saveDB();

      return bot.sendMessage(
        chatId,
        "✅ PDF successfully uploaded!\n\n" +
        "📚 Course: " + course + "\n" +
        "📖 Semester: " + semester + "\n" +
        "📘 Unit: " + unit + "\n" +
        "📝 Chapter: " + chapter + "\n\n" +
        "PDF ka extracted content save ho gaya hai.\n" +
        "Original PDF users ko nahi bheji jayegi."
      );

    } catch (error) {
      console.error(
        "PDF ERROR:",
        error.response?.data || error.message
      );

      return bot.sendMessage(
        chatId,
        "❌ PDF process nahi ho payi.\n" +
        "Dobara try karein."
      );
    }
  }

  // IGNORE OTHER DOCUMENTS

  if (!msg.text) return;

  const text = msg.text.trim();

  // IGNORE COMMANDS

  if (text.startsWith("/")) return;

  const session = getSession(userId);

  // AI FOLLOW-UP QUESTION

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
        "Chapter ka content nahi mila. Dobara chapter select karein."
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

      return bot.sendMessage(
        chatId,
        "🤖 Aap isi chapter se aur questions pooch sakte hain."
      );

    } catch (error) {
      console.error(
        "AI QUESTION ERROR:",
        error.message
      );

      return bot.sendMessage(
        chatId,
        "❌ AI answer generate nahi ho paya."
      );
    }
  }
});

// ============================================
// START COMMAND
// ============================================

bot.onText(/^\/start(?:@\w+)?$/, msg => {
  sendHome(
    msg.chat.id,
    msg.from.id
  );
});

// ============================================
// TELEGRAM MENU COMMANDS
// ============================================

bot.setMyCommands([
  {
    command: "start",
    description: "🏠 Open Main Menu"
  },
  {
    command: "structure",
    description: "Admin: View Course Structure"
  },
  {
    command: "addsemester",
    description: "Admin: Add Semester"
  },
  {
    command: "addunit",
    description: "Admin: Add Unit"
  },
  {
    command: "addchapter",
    description: "Admin: Add Chapter"
  }
]).catch(error => {
  console.error(
    "BOT COMMAND ERROR:",
    error.message
  );
});

// ============================================
// RENDER HEALTH CHECK
// ============================================

app.get("/", (req, res) => {
  res.send("TATSAR STUDY BOT IS RUNNING");
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    bot: "TATSAR Study Bot"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    "TATSAR Study Bot running on port " + PORT
  );
});

// ============================================
// ERROR HANDLING
// ============================================

bot.on("polling_error", error => {
  console.error(
    "TELEGRAM POLLING ERROR:",
    error.message
  );
});

process.on("unhandledRejection", error => {
  console.error("UNHANDLED ERROR:", error);
});

console.log("TATSAR STUDY BOT STARTED");