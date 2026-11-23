// ============================================
// TATSAR STUDY BOT - UPDATED SERVER.JS
// PART 1/3
// ============================================

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const pdfParse = require("pdf-parse");
require("dotenv").config();

const app = express();
app.use(express.json());

const TOKEN = process.env.BOT_TOKEN;

const ADMIN_IDS = (
  process.env.ADMIN_IDS || "8833629094"
).split(",").map(id => id.trim());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL =
  process.env.OPENAI_MODEL || "gpt-4o-mini";

const PORT = process.env.PORT || 3000;

if (!TOKEN) {
  console.error("BOT_TOKEN missing!");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
  polling: true
});

const DB_FILE = path.join(__dirname, "data.json");

// ============================================
// DATABASE
// ============================================

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
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(
        DB_FILE,
        JSON.stringify(DEFAULT_DB, null, 2)
      );

      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }

    const data = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    if (!data.courses) {
      data.courses = DEFAULT_DB.courses;
    }

    for (const key of Object.keys(DEFAULT_DB.courses)) {
      if (!data.courses[key]) {
        data.courses[key] = DEFAULT_DB.courses[key];
      }
    }

    return data;

  } catch (error) {
    console.error("DATABASE ERROR:", error.message);

    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(db, null, 2)
    );
  } catch (error) {
    console.error("SAVE ERROR:", error.message);
  }
}

// ============================================
// USER SESSION
// ============================================

const sessions = {};

function getSession(userId) {
  if (!sessions[userId]) {
    sessions[userId] = {
      course: null,
      semester: null,
      unit: null,
      chapter: null,
      feature: null,
      awaitingQuestion: false,
      lastBotMessageId: null,
      step: "home"
    };
  }

  return sessions[userId];
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

// ============================================
// BUTTON SYSTEM
// ============================================

const BUTTONS = {
  syllabus: "🟩 Syllabus",
  notes: "🟩 Handwritten Notes",
  pyq: "🟩 PYQ Questions",
  mcq: "🟩 MCQ Questions",
  mock: "🟩 Mock Test",
  ai: "🟩 AI Assistant",

  bp: "🟩 B.Pharm",
  dp: "🟩 D.Pharm",
  cet: "🟩 Rajasthan CET",
  class12: "🟩 12th Class",

  back: "🟩 Back",
  home: "🟩 Main Menu"
};

const FEATURE_NAMES = {
  syllabus: "Syllabus",
  notes: "Handwritten Notes",
  pyq: "PYQ Questions",
  mcq: "MCQ Questions",
  mock: "Mock Test",
  ai: "AI Assistant"
};

const COURSE_NAMES = {
  bp: "B.Pharm",
  dp: "D.Pharm",
  cet: "Rajasthan CET",
  class12: "12th Class"
};

// ============================================
// PAGE SYSTEM
// ============================================

async function sendPage(
  chatId,
  userId,
  messageText,
  keyboard
) {
  const session = getSession(userId);

  if (session.lastBotMessageId) {
    try {
      await bot.deleteMessage(
        chatId,
        session.lastBotMessageId
      );
    } catch (error) {}
  }

  const message = await bot.sendMessage(
    chatId,
    messageText,
    {
      parse_mode: "HTML",
      reply_markup: {
        keyboard,
        resize_keyboard: true,
        is_persistent: true
      }
    }
  );

  session.lastBotMessageId = message.message_id;

  return message;
}

// ============================================
// MAIN MENU
// ============================================

function mainKeyboard() {
  return [
    [BUTTONS.syllabus, BUTTONS.notes],
    [BUTTONS.pyq, BUTTONS.mcq],
    [BUTTONS.mock, BUTTONS.ai]
  ];
}

async function sendHome(chatId, userId) {
  const session = getSession(userId);

  session.course = null;
  session.semester = null;
  session.unit = null;
  session.chapter = null;
  session.feature = null;
  session.awaitingQuestion = false;
  session.step = "home";

  return sendPage(
    chatId,
    userId,

    "🌸 <b>WELCOME TO TATSAR STUDY BOT</b> 🌸\n\n" +
    "📚 Your Complete Study Assistant\n\n" +
    "📝 Handwritten Study Notes\n" +
    "📖 Syllabus and PYQ Questions\n" +
    "🧠 MCQ Questions\n" +
    "🧪 Mock Test\n" +
    "🤖 AI Study Assistant\n\n" +
    "👇 <b>Apna study option select karein:</b>",

    mainKeyboard()
  );
}

// ============================================
// COURSE SELECTION
// ============================================

async function sendCourses(chatId, userId) {
  const session = getSession(userId);

  session.step = "courses";

  return sendPage(
    chatId,
    userId,

    "📚 <b>SELECT YOUR COURSE</b>\n\n" +
    "Apna course select karein:",

    [
      [BUTTONS.bp, BUTTONS.dp],
      [BUTTONS.cet, BUTTONS.class12],
      [BUTTONS.back, BUTTONS.home]
    ]
  );
}

// ============================================
// GET COURSE DATA
// ============================================

function getCourse(code) {
  return db.courses[code] || null;
}

function getSemesters(code) {
  const course = getCourse(code);

  return course
    ? Object.keys(course.semesters || {})
    : [];
}

function getUnits(code, semester) {
  const course = getCourse(code);

  if (!course || !course.semesters[semester]) {
    return [];
  }

  return Object.keys(
    course.semesters[semester].units || {}
  );
}

function getChapters(code, semester, unit) {
  const course = getCourse(code);

  if (
    !course ||
    !course.semesters[semester] ||
    !course.semesters[semester].units[unit]
  ) {
    return {};
  }

  return course.semesters[semester]
    .units[unit].chapters || {};
}

// ============================================
// SEMESTER SELECTION
// ============================================

async function sendSemesters(chatId, userId) {
  const session = getSession(userId);

  const course = getCourse(session.course);

  if (!course) {
    return sendCourses(chatId, userId);
  }

  const semesters = getSemesters(session.course);

  session.step = "semesters";

  if (!semesters.length) {
    return sendPage(
      chatId,
      userId,

      "❌ <b>Content available nahi hai.</b>\n\n" +
      "Admin se content upload karwayein.",

      [[BUTTONS.back, BUTTONS.home]]
    );
  }

  const keyboard = [];

  for (let i = 0; i < semesters.length; i += 2) {
    keyboard.push(
      semesters.slice(i, i + 2)
    );
  }

  keyboard.push([BUTTONS.back, BUTTONS.home]);

  return sendPage(
    chatId,
    userId,

    "🎓 <b>" + course.name + "</b>\n\n" +
    "Apna semester / year select karein:",

    keyboard
  );
}

// ============================================
// UNIT SELECTION
// ============================================

async function sendUnits(chatId, userId) {
  const session = getSession(userId);

  const units = getUnits(
    session.course,
    session.semester
  );

  session.step = "units";

  if (!units.length) {
    return sendPage(
      chatId,
      userId,
      "❌ Is semester mein koi unit available nahi hai.",
      [[BUTTONS.back, BUTTONS.home]]
    );
  }

  const keyboard = [];

  for (let i = 0; i < units.length; i += 2) {
    keyboard.push(units.slice(i, i + 2));
  }

  keyboard.push([BUTTONS.back, BUTTONS.home]);

  return sendPage(
    chatId,
    userId,

    "📖 <b>" + session.semester + "</b>\n\n" +
    "Apni unit select karein:",

    keyboard
  );
}

// ============================================
// CHAPTER SELECTION
// ============================================

async function sendChapters(chatId, userId) {
  const session = getSession(userId);

  const chapters = getChapters(
    session.course,
    session.semester,
    session.unit
  );

  const names = Object.keys(chapters);

  session.step = "chapters";

  if (!names.length) {
    return sendPage(
      chatId,
      userId,
      "❌ Is unit mein koi chapter available nahi hai.",
      [[BUTTONS.back, BUTTONS.home]]
    );
  }

  const keyboard = [];

  for (let i = 0; i < names.length; i += 2) {
    keyboard.push(names.slice(i, i + 2));
  }

  keyboard.push([BUTTONS.back, BUTTONS.home]);

  return sendPage(
    chatId,
    userId,

    "📝 <b>" + session.unit + "</b>\n\n" +
    "Apna chapter select karein:",

    keyboard
  );
}

// ============================================
// STUDY CONTENT PAGE
// ============================================

async function sendStudyOptions(chatId, userId) {
  const session = getSession(userId);

  session.step = "study-options";

  return sendPage(
    chatId,
    userId,

    "📚 <b>" + session.chapter + "</b>\n\n" +
    "👇 Apna study option select karein:",

    [
      [BUTTONS.syllabus, BUTTONS.notes],
      [BUTTONS.pyq, BUTTONS.mcq],
      [BUTTONS.mock, BUTTONS.ai],
      [BUTTONS.back, BUTTONS.home]
    ]
  );
}
// ============================================
// TATSAR STUDY BOT
// PART 2/3
// ============================================

// ============================================
// LONG MESSAGE SENDER
// ============================================

async function sendLongMessage(chatId, text) {
  const maxLength = 3800;

  for (let i = 0; i < text.length; i += maxLength) {
    await bot.sendMessage(
      chatId,
      text.substring(i, i + maxLength)
    );
  }
}

// ============================================
// OPENAI AI GENERATOR
// ============================================

async function generateAI(question, pdfText) {
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
            "Explain everything in simple Hinglish. " +
            "Use headings, examples and bullet points. " +
            "Use the supplied PDF study material. " +
            "Do not invent facts or actual previous year questions."
        },
        {
          role: "user",
          content:
            "STUDY MATERIAL:\n" +
            pdfText.slice(0, 45000) +
            "\n\nQUESTION:\n" +
            question
        }
      ],

      temperature: 0.4
    },

    {
      headers: {
        Authorization: "Bearer " + OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      timeout: 120000
    }
  );

  return (
    response.data.choices[0].message.content ||
    "Answer generate nahi ho paya."
  );
}

// ============================================
// SELECTED CHAPTER
// ============================================

function getSelectedChapter(userId) {
  const session = getSession(userId);

  if (
    !session.course ||
    !session.semester ||
    !session.unit ||
    !session.chapter
  ) {
    return null;
  }

  const chapters = getChapters(
    session.course,
    session.semester,
    session.unit
  );

  return chapters[session.chapter] || null;
}

// ============================================
// FEATURE PROMPTS
// ============================================

const FEATURE_PROMPTS = {
  syllabus:
    "Create a detailed syllabus from this study material. " +
    "Include all topics and subtopics in proper order. " +
    "Explain in Hinglish.",

  notes:
    "Create detailed handwritten-style study notes in text format. " +
    "Include definitions, explanations, examples, important points, " +
    "and exam-oriented information in Hinglish.",

  pyq:
    "Create 20 exam-oriented previous-year-style questions " +
    "with detailed answers from this material. " +
    "Do not claim these are verified actual PYQs.",

  mcq:
    "Create 20 MCQ questions with 4 options each. " +
    "Provide correct answers and short explanations.",

  mock:
    "Create a 20-question mock test from this chapter. " +
    "Give questions and options first, then a separate answer key.",

  ai:
    "Give a short overview of this chapter in simple Hinglish."
};

// ============================================
// GENERATE FEATURE
// ============================================

async function generateForFeature(
  chatId,
  userId,
  feature
) {
  const session = getSession(userId);

  const chapterData = getSelectedChapter(userId);

  if (!chapterData || !chapterData.text) {
    session.awaitingQuestion = false;

    return bot.sendMessage(
      chatId,
      "❌ Is chapter ka PDF content available nahi hai."
    );
  }

  if (!FEATURE_NAMES[feature]) return;

  session.feature = feature;

  if (feature === "ai") {
    session.awaitingQuestion = true;

    await bot.sendMessage(
      chatId,

      "🤖 <b>AI STUDY ASSISTANT</b>\n\n" +
      "Is chapter se related apna question bhejein.\n\n" +
      "Main uploaded PDF ke basis par answer dunga.",

      {
        parse_mode: "HTML"
      }
    );

    try {
      const overview = await generateAI(
        FEATURE_PROMPTS.ai,
        chapterData.text
      );

      await sendLongMessage(chatId, overview);

    } catch (error) {
      console.error("AI ERROR:", error.message);

      await bot.sendMessage(
        chatId,
        "❌ AI overview generate nahi ho paya."
      );
    }

    return;
  }

  session.awaitingQuestion = false;

  await bot.sendChatAction(chatId, "typing");

  await bot.sendMessage(
    chatId,
    "⏳ <b>" + FEATURE_NAMES[feature] +
    " prepare ho raha hai...</b>",
    {
      parse_mode: "HTML"
    }
  );

  try {
    const answer = await generateAI(
      FEATURE_PROMPTS[feature],
      chapterData.text
    );

    await sendLongMessage(chatId, answer);

    await bot.sendMessage(
      chatId,

      "✅ <b>Content Complete!</b>\n\n" +
      "Dusra option select karne ke liye neeche menu use karein.",

      {
        parse_mode: "HTML",
        reply_markup: {
          keyboard: [
            [BUTTONS.syllabus, BUTTONS.notes],
            [BUTTONS.pyq, BUTTONS.mcq],
            [BUTTONS.mock, BUTTONS.ai],
            [BUTTONS.back, BUTTONS.home]
          ],
          resize_keyboard: true,
          is_persistent: true
        }
      }
    );

  } catch (error) {
    console.error(
      "GENERATION ERROR:",
      error.response?.data || error.message
    );

    await bot.sendMessage(
      chatId,
      "❌ Content generate nahi ho paya.\n\n" +
      "OpenAI API key, balance aur model check karein."
    );
  }
}

// ============================================
// ADMIN: ADD SEMESTER
// ============================================

bot.onText(
  /^\/addsemester(?:@\w+)?(?:\s+([\s\S]+))?$/,
  (msg, match) => {

    const chatId = msg.chat.id;

    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(
        chatId,
        "⛔ Admin only command."
      );
    }

    const parts = (match[1] || "")
      .split("|")
      .map(x => x.trim());

    if (
      parts.length < 2 ||
      !db.courses[parts[0]]
    ) {
      return bot.sendMessage(
        chatId,
        "Format:\n\n/addsemester bp|Semester 1\n\n" +
        "Courses: bp, dp, cet, class12"
      );
    }

    const [course, semester] = parts;

    db.courses[course].semesters[semester] =
      db.courses[course].semesters[semester] || {
        units: {}
      };

    saveDB();

    return bot.sendMessage(
      chatId,
      "✅ Semester add ho gaya!\n\n" +
      db.courses[course].name + " - " + semester
    );
  }
);

// ============================================
// ADMIN: ADD UNIT
// ============================================

bot.onText(
  /^\/addunit(?:@\w+)?(?:\s+([\s\S]+))?$/,
  (msg, match) => {

    const chatId = msg.chat.id;

    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(
        chatId,
        "⛔ Admin only command."
      );
    }

    const parts = (match[1] || "")
      .split("|")
      .map(x => x.trim());

    if (
      parts.length < 3 ||
      !db.courses[parts[0]]
    ) {
      return bot.sendMessage(
        chatId,
        "Format:\n\n/addunit bp|Semester 1|Unit 1"
      );
    }

    const [course, semester, unit] = parts;

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

    return bot.sendMessage(
      chatId,
      "✅ Unit successfully added!"
    );
  }
);

// ============================================
// ADMIN: ADD CHAPTER
// ============================================

bot.onText(
  /^\/addchapter(?:@\w+)?(?:\s+([\s\S]+))?$/,
  (msg, match) => {

    const chatId = msg.chat.id;

    if (!isAdmin(msg.from.id)) {
      return bot.sendMessage(
        chatId,
        "⛔ Admin only command."
      );
    }

    const parts = (match[1] || "")
      .split("|")
      .map(x => x.trim());

    if (
      parts.length < 4 ||
      !db.courses[parts[0]]
    ) {
      return bot.sendMessage(
        chatId,
        "Format:\n\n" +
        "/addchapter bp|Semester 1|Unit 1|Chapter 1"
      );
    }

    const [course, semester, unit, chapter] = parts;

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
        text: "",
        updatedAt: null
      };

    saveDB();

    return bot.sendMessage(
      chatId,
      "✅ Chapter successfully added!\n\n" +
      chapter
    );
  }
);

// ============================================
// ADMIN: VIEW STRUCTURE
// ============================================

bot.onText(/^\/structure(?:@\w+)?$/, msg => {

  const chatId = msg.chat.id;

  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⛔ Admin only command."
    );
  }

  let output = "📚 <b>COURSE STRUCTURE</b>\n\n";

  for (const code of Object.keys(db.courses)) {

    const course = db.courses[code];

    output += "🎓 <b>" + course.name + "</b>\n";

    for (const semester of Object.keys(
      course.semesters || {}
    )) {

      output += "📖 " + semester + "\n";

      const units =
        course.semesters[semester].units || {};

      for (const unit of Object.keys(units)) {

        output += "📘 " + unit + "\n";

        const chapters = units[unit].chapters || {};

        for (const chapter of Object.keys(chapters)) {

          const uploaded =
            chapters[chapter].text ? "✅" : "❌";

          output += uploaded + " " + chapter + "\n";
        }
      }
    }

    output += "\n";
  }

  return sendLongMessage(chatId, output);
});

// ============================================
// PDF UPLOAD HANDLER
// ============================================

async function handlePDF(msg) {

  const chatId = msg.chat.id;
  const userId = msg.from.id;

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

  const parts = (msg.caption || "")
    .split("|")
    .map(x => x.trim());

  if (
    parts.length < 4 ||
    !db.courses[parts[0]]
  ) {
    return bot.sendMessage(
      chatId,

      "PDF ke saath caption likhein:\n\n" +
      "bp|Semester 1|Unit 1|Chapter 1"
    );
  }

  const [course, semester, unit, chapter] = parts;

  try {

    await bot.sendMessage(
      chatId,
      "⏳ PDF process ho rahi hai..."
    );

    const fileLink = await bot.getFileLink(
      msg.document.file_id
    );

    const response = await axios.get(
      fileLink,
      {
        responseType: "arraybuffer",
        timeout: 120000,
        maxContentLength: 20 * 1024 * 1024
      }
    );

    const parsed = await pdfParse(
      Buffer.from(response.data)
    );

    const extractedText = (parsed.text || "").trim();

    if (!extractedText) {
      return bot.sendMessage(
        chatId,
        "❌ PDF mein readable text nahi mila. OCR required hai."
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

    semesterData.units[unit].chapters[chapter] = {
      text: extractedText,
      updatedAt: new Date().toISOString()
    };

    saveDB();

    return bot.sendMessage(
      chatId,

      "✅ <b>PDF SUCCESSFULLY UPLOADED!</b>\n\n" +
      "📚 Course: " + course + "\n" +
      "📖 Semester: " + semester + "\n" +
      "📘 Unit: " + unit + "\n" +
      "📝 Chapter: " + chapter,

      {
        parse_mode: "HTML"
      }
    );

  } catch (error) {

    console.error("PDF ERROR:", error.message);

    return bot.sendMessage(
      chatId,
      "❌ PDF process nahi ho payi."
    );
  }
}
// ============================================
// TATSAR STUDY BOT
// PART 3/3
// ============================================

// ============================================
// DELETE PREVIOUS PAGE
// ============================================

async function deleteCurrentPage(chatId, userId) {
  const session = getSession(userId);

  if (!session.lastBotMessageId) return;

  try {
    await bot.deleteMessage(
      chatId,
      session.lastBotMessageId
    );
  } catch (error) {}

  session.lastBotMessageId = null;
}

// ============================================
// BACK NAVIGATION
// ============================================

async function goBack(chatId, userId) {
  const session = getSession(userId);

  session.awaitingQuestion = false;

  if (session.step === "courses") {
    session.feature = null;
    return sendHome(chatId, userId);
  }

  if (session.step === "semesters") {
    session.course = null;
    return sendCourses(chatId, userId);
  }

  if (session.step === "units") {
    session.semester = null;
    return sendSemesters(chatId, userId);
  }

  if (session.step === "chapters") {
    session.unit = null;
    return sendUnits(chatId, userId);
  }

  if (session.step === "study-options") {
    session.chapter = null;
    return sendChapters(chatId, userId);
  }

  return sendHome(chatId, userId);
}

// ============================================
// HANDLE COURSE
// ============================================

async function handleCourse(
  chatId,
  userId,
  courseCode
) {
  const session = getSession(userId);

  if (!db.courses[courseCode]) return;

  session.course = courseCode;
  session.semester = null;
  session.unit = null;
  session.chapter = null;
  session.awaitingQuestion = false;

  return sendSemesters(chatId, userId);
}

// ============================================
// HANDLE FEATURE
// ============================================

async function handleFeature(
  chatId,
  userId,
  feature
) {
  const session = getSession(userId);

  if (!FEATURE_NAMES[feature]) return;

  session.feature = feature;
  session.awaitingQuestion = false;

  // Chapter selected hai to direct content generate hoga.

  if (
    session.course &&
    session.semester &&
    session.unit &&
    session.chapter
  ) {
    return generateForFeature(
      chatId,
      userId,
      feature
    );
  }

  // Chapter selected nahi hai to course selection.

  session.course = null;
  session.semester = null;
  session.unit = null;
  session.chapter = null;

  return sendCourses(chatId, userId);
}

// ============================================
// TEXT MESSAGE HANDLER
// ============================================

bot.on("message", async msg => {

  if (!msg.from || msg.from.is_bot) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const session = getSession(userId);

  // ========================================
  // PDF UPLOAD
  // ========================================

  if (msg.document) {
    return handlePDF(msg);
  }

  if (!msg.text) return;

  const text = msg.text.trim();

  // Commands separately handled.

  if (text.startsWith("/")) return;

  // ========================================
  // MAIN MENU
  // ========================================

  if (text === BUTTONS.home) {
    return sendHome(chatId, userId);
  }

  // ========================================
  // BACK BUTTON
  // ========================================

  if (text === BUTTONS.back) {
    return goBack(chatId, userId);
  }

  // ========================================
  // FEATURE BUTTONS
  // ========================================

  const featureMap = {};

  for (const [key, value] of Object.entries(BUTTONS)) {
    if (FEATURE_NAMES[key]) {
      featureMap[value] = key;
    }
  }

  if (featureMap[text]) {
    return handleFeature(
      chatId,
      userId,
      featureMap[text]
    );
  }

  // ========================================
  // COURSE BUTTONS
  // ========================================

  const courseMap = {};

  for (const [key, value] of Object.entries(BUTTONS)) {
    if (COURSE_NAMES[key]) {
      courseMap[value] = key;
    }
  }

  if (courseMap[text]) {

    if (session.step !== "courses") {
      return;
    }

    return handleCourse(
      chatId,
      userId,
      courseMap[text]
    );
  }

  // ========================================
  // SEMESTER SELECTION
  // ========================================

  if (session.step === "semesters") {

    const semesters = getSemesters(session.course);

    if (semesters.includes(text)) {

      session.semester = text;
      session.unit = null;
      session.chapter = null;

      return sendUnits(chatId, userId);
    }
  }

  // ========================================
  // UNIT SELECTION
  // ========================================

  if (session.step === "units") {

    const units = getUnits(
      session.course,
      session.semester
    );

    if (units.includes(text)) {

      session.unit = text;
      session.chapter = null;

      return sendChapters(chatId, userId);
    }
  }

  // ========================================
  // CHAPTER SELECTION
  // ========================================

  if (session.step === "chapters") {

    const chapters = getChapters(
      session.course,
      session.semester,
      session.unit
    );

    if (chapters[text]) {

      session.chapter = text;
      session.step = "study-options";

      // Selected feature direct generate.

      if (session.feature) {
        return generateForFeature(
          chatId,
          userId,
          session.feature
        );
      }

      return sendStudyOptions(chatId, userId);
    }
  }

  // ========================================
  // AI FOLLOW-UP QUESTIONS
  // ========================================

  if (
    session.awaitingQuestion &&
    session.chapter
  ) {

    const chapterData = getSelectedChapter(userId);

    if (!chapterData || !chapterData.text) {

      session.awaitingQuestion = false;

      return bot.sendMessage(
        chatId,
        "❌ Chapter content nahi mila."
      );
    }

    try {

      await bot.sendChatAction(
        chatId,
        "typing"
      );

      const answer = await generateAI(
        text,
        chapterData.text
      );

      await sendLongMessage(
        chatId,
        answer
      );

      return bot.sendMessage(
        chatId,

        "🤖 Isi chapter se aur questions pooch sakte hain.\n\n" +
        "🟩 Main Menu dabakar doosra option select karein."
      );

    } catch (error) {

      console.error(
        "AI QUESTION ERROR:",
        error.response?.data || error.message
      );

      return bot.sendMessage(
        chatId,
        "❌ AI answer generate nahi ho paya."
      );
    }
  }

  // ========================================
  // UNKNOWN MESSAGE
  // ========================================

  return bot.sendMessage(
    chatId,

    "👇 Neeche diye gaye buttons mein se option select karein.",

    {
      reply_markup: {
        keyboard: mainKeyboard(),
        resize_keyboard: true,
        is_persistent: true
      }
    }
  );

});

// ============================================
// START COMMAND
// ============================================

bot.onText(
  /^\/start(?:@\w+)?$/,
  async msg => {

    return sendHome(
      msg.chat.id,
      msg.from.id
    );
  }
);

// ============================================
// TELEGRAM MENU COMMANDS
// ============================================

bot.setMyCommands([
  {
    command: "start",
    description: "Open Main Menu"
  },
  {
    command: "structure",
    description: "View Course Structure"
  },
  {
    command: "addsemester",
    description: "Add Semester"
  },
  {
    command: "addunit",
    description: "Add Unit"
  },
  {
    command: "addchapter",
    description: "Add Chapter"
  }
]).catch(error => {
  console.error(
    "COMMAND ERROR:",
    error.message
  );
});

// ============================================
// RENDER HEALTH CHECK
// ============================================

app.get("/", (req, res) => {
  res.send(
    "TATSAR STUDY BOT IS RUNNING SUCCESSFULLY"
  );
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    bot: "TATSAR STUDY BOT"
  });
});

// ============================================
// SERVER START
// ============================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    "TATSAR STUDY BOT RUNNING ON PORT " + PORT
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
  console.error(
    "UNHANDLED ERROR:",
    error
  );
});

process.on("uncaughtException", error => {
  console.error(
    "UNCAUGHT EXCEPTION:",
    error
  );
});

console.log(
  "TATSAR STUDY BOT STARTED SUCCESSFULLY"
);