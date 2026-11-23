const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

let config = {};
try {
  config = require('./config');
} catch (e) {
  config = {};
}

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.log("⚠️ 'pdf-parse' module not installed; PDF text extraction will use fallback/manual notes.");
}

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || config.TELEGRAM_BOT_TOKEN || "";
if (!TOKEN) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN in environment or config.js");
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const rawAdminIds = process.env.ADMIN_IDS || config.ADMIN_IDS || '';
const ADMIN_IDS = new Set([
  8805135936,
  ...String(rawAdminIds)
    .split(',')
    .map((id) => Number(String(id).trim()))
    .filter((id) => !Number.isNaN(id) && id > 0)
]);
const SUPPORT_CHANNEL = process.env.SUPPORT_CHANNEL || config.SUPPORT_CHANNEL || "https://t.me/adityachoudhary5";

const dbFilePath = path.join(__dirname, 'study_material_db.json');

const ALLOWED_STUDY_TYPES = [
  "Syllabus",
  "Hand Written Notes",
  "PYQ Question",
  "Mock Test",
  "AI Assistant"
];

const MAIN_MENU_BUTTONS = [
  ["Syllabus", "Hand Written Notes"],
  ["PYQ Question", "Mock Test"],
  ["AI Assistant", "🔗 Links"]
];

let CATEGORIES = {
  "Pharmacy": ["B.Pharma", "D.Pharma"],
  "Commerce": ["B.Com"],
  "CET": ["CET 12th Level", "CET Graduation Level"],
  "12th": ["Science", "Commerce", "Arts"],
  "SSC": ["SSC GD", "SSC CHSL", "SSC CGL", "SSC MTS"],
  "Railway": ["RRB NTPC", "RRB Group D", "RRB ALP", "RRB JE"],
  "Air Force": ["Group X (Science)", "Group Y (Non-Tech)", "Agniveer Vayu"],
  "Army": ["Agniveer GD", "Agniveer Technical", "Nursing Assistant", "Clerk / SKT"],
  "Navy": ["Agniveer SSR", "Agniveer MR"]
};

const DEFAULT_YEARS_BY_COURSE = {
  "B.Pharma": ["1st Year", "2nd Year", "3rd Year", "4th Year"],
  "D.Pharma": ["1st Year", "2nd Year"],
  "B.Com": ["1st Year", "2nd Year", "3rd Year"]
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
  },
  "B.Com": {
    "1st Year": ["Semester 1", "Semester 2"],
    "2nd Year": ["Semester 3", "Semester 4"],
    "3rd Year": ["Semester 5", "Semester 6"]
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
  materials: {},
  uploadedPdfs: [],
  customYears: {},
  customSemesters: {},
  examLinks: {
    "Admit Card": [],
    "Result": []
  },
  users: {}
};

function ensureDbDefaults() {
  if (!studyDb.materials || typeof studyDb.materials !== "object") studyDb.materials = {};
  if (!Array.isArray(studyDb.uploadedPdfs)) studyDb.uploadedPdfs = [];
  if (!studyDb.customYears || typeof studyDb.customYears !== "object") studyDb.customYears = {};
  if (!studyDb.customSemesters || typeof studyDb.customSemesters !== "object") studyDb.customSemesters = {};
  if (!studyDb.examLinks || typeof studyDb.examLinks !== "object") {
    studyDb.examLinks = { "Admit Card": [], "Result": [] };
  }
  if (!Array.isArray(studyDb.examLinks["Admit Card"])) studyDb.examLinks["Admit Card"] = [];
  if (!Array.isArray(studyDb.examLinks["Result"])) studyDb.examLinks["Result"] = [];
  if (!studyDb.users || typeof studyDb.users !== "object") studyDb.users = {};
}

function saveData() {
  try {
    ensureDbDefaults();
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
      if (parsed.categories && typeof parsed.categories === "object") {
        CATEGORIES = parsed.categories;
      }
      if (parsed.materials) studyDb.materials = parsed.materials;
      if (parsed.uploadedPdfs) studyDb.uploadedPdfs = parsed.uploadedPdfs;
      if (parsed.customYears) studyDb.customYears = parsed.customYears;
      if (parsed.customSemesters) studyDb.customSemesters = parsed.customSemesters;
      if (parsed.examLinks && typeof parsed.examLinks === "object") {
        studyDb.examLinks = {
          "Admit Card": Array.isArray(parsed.examLinks["Admit Card"]) ? parsed.examLinks["Admit Card"] : [],
          "Result": Array.isArray(parsed.examLinks["Result"]) ? parsed.examLinks["Result"] : []
        };
      }
      if (parsed.users) studyDb.users = parsed.users;
      ensureDbDefaults();
      console.log("✅ Study Material database loaded successfully!");
    }
  } else {
    ensureDbDefaults();
    saveData();
  }
} catch (e) {
  console.log("⚠️ Error loading database, using default:", e.message);
  ensureDbDefaults();
}

function persistAll() {
  try {
    ensureDbDefaults();
    const payload = { ...studyDb, categories: CATEGORIES };
    fs.writeFileSync(dbFilePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    console.log("❌ Error persisting database:", e.message);
  }
}

function getCategoryList() {
  return Object.keys(CATEGORIES);
}

function getCoursesForCategory(category) {
  return Array.isArray(CATEGORIES[category]) ? CATEGORIES[category] : [];
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
      adminUploadFlow: null,
      activeMockSession: null
    };
    persistAll();
  } else {
    if (firstName) studyDb.users[userId].name = firstName;
    if (!studyDb.users[userId].activeMockSession) {
      studyDb.users[userId].activeMockSession = null;
    }
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
  if (
    yearName &&
    DEFAULT_SEMESTERS_BY_YEAR[course] &&
    DEFAULT_SEMESTERS_BY_YEAR[course][yearName]
  ) {
    baseSems = [...DEFAULT_SEMESTERS_BY_YEAR[course][yearName]];
  } else if (!yearName && DEFAULT_DIRECT_SEMESTERS_BY_COURSE[course]) {
    baseSems = [...DEFAULT_DIRECT_SEMESTERS_BY_COURSE[course]];
  } else if (!yearName && !DEFAULT_YEARS_BY_COURSE[course]) {
    baseSems = ["Semester 1", "Semester 2"];
  }

  const extraSems = studyDb.customSemesters[key] || [];
  const merged = [...baseSems];

  if (!yearName && studyDb.materials[category] && studyDb.materials[category][course]) {
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

            if (
              text.includes("Syllabus") ||
              text.includes("Hand Written Notes") ||
              text.includes("Year") ||
              text.includes("Semester") ||
              text.includes("Links") ||
              text.includes("Admit Card") ||
              text.includes("Result")
            ) {
              style = "primary";
            } else if (text.includes("Back") || text.includes("Main Menu")) {
              style = "danger";
            } else if (
              callback.startsWith("yr_") ||
              callback.startsWith("sem_") ||
              callback.startsWith("subj_")
            ) {
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

function buildPeriodStorageKey(yearName, semesterName) {
  return yearName ? `${yearName} > ${semesterName}` : semesterName;
}

function getSubjectBucket(category, course, periodKey, studyType, createIfMissing = false) {
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
  if (!studyDb.materials[category][course][periodKey][studyType]) {
    if (!createIfMissing) return null;
    studyDb.materials[category][course][periodKey][studyType] = { subjects: {} };
  }
  if (!studyDb.materials[category][course][periodKey][studyType].subjects) {
    studyDb.materials[category][course][periodKey][studyType].subjects = {};
  }
  return studyDb.materials[category][course][periodKey][studyType];
}

function ensureUnitRecord(category, course, periodKey, studyType, subjectName, unitName, createIfMissing = false) {
  const bucket = getSubjectBucket(category, course, periodKey, studyType, createIfMissing);
  if (!bucket) return null;

  if (!bucket.subjects[subjectName]) {
    if (!createIfMissing) return null;
    bucket.subjects[subjectName] = { units: {} };
  }
  if (!bucket.subjects[subjectName].units) {
    bucket.subjects[subjectName].units = {};
  }
  if (!bucket.subjects[subjectName].units[unitName]) {
    if (!createIfMissing) return null;
    bucket.subjects[subjectName].units[unitName] = {
      topics: [],
      handwrittenNotes: "",
      pdfs: [],
      photos: [],
      pyqQuestions: [],
      pyqStructured: {
        mcq: [],
        short: [],
        long: []
      },
      mockQuestions: [],
      mockMcqSet: []
    };
  }
  if (!Array.isArray(bucket.subjects[subjectName].units[unitName].pdfs)) {
    bucket.subjects[subjectName].units[unitName].pdfs = [];
  }
  if (!Array.isArray(bucket.subjects[subjectName].units[unitName].photos)) {
    bucket.subjects[subjectName].units[unitName].photos = [];
  }
  if (!bucket.subjects[subjectName].units[unitName].pyqStructured) {
    bucket.subjects[subjectName].units[unitName].pyqStructured = {
      mcq: [],
      short: [],
      long: []
    };
  }
  if (!Array.isArray(bucket.subjects[subjectName].units[unitName].mockMcqSet)) {
    bucket.subjects[subjectName].units[unitName].mockMcqSet = [];
  }
  return bucket.subjects[subjectName].units[unitName];
}
function escapeMarkdownText(str) {
  return String(str || "").replace(/([_*`\[])/g, "\\$1");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isLikelyHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 85) return false;
  if (/^(unit[\s\-–—:]*\d+|chapter[\s\-–—:]*\d+|\d+\s*\|\s*p\s*a\s*g\s*e|page\s*\d+)/i.test(trimmed)) {
    return false;
  }
  if (trimmed.endsWith(":")) return true;
  if (/^\d+[\).\s-]/.test(trimmed)) return false;
  if (/^[a-dA-D]\)\s*/.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).length;
  return wordCount >= 1 && wordCount <= 7 && !trimmed.endsWith(".");
}

function isSubPoint(line) {
  return /^(\d+[\).\s-]|[a-dA-D]\)\s*|[-–•●▪◦]\s*)/.test(line.trim());
}

function cleanPdfLine(rawLine) {
  let s = String(rawLine || "")
    .replace(/[\u2022\u25CF\u25AA\u25AB\u25E6\uF0B7]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^\d+\s*\|\s*p\s*a\s*g\s*e$/i.test(s)) {
    return "";
  }
  if (/^unit[\s\-–—]*[ivx0-9]+$/i.test(s)) {
    return "";
  }
  return s;
}

function buildStructuredNotesText(rawText, unitTitle, subjectTitle = "") {
  const cleanedLines = (rawText || "")
    .split(/\r?\n/)
    .map(cleanPdfLine)
    .filter(Boolean);

  const chapterUnitLine = subjectTitle
    ? `Chapter / Unit: ${unitTitle} (${subjectTitle})`
    : `Chapter / Unit: ${unitTitle}`;

  if (cleanedLines.length === 0) {
    return `${chapterUnitLine}\n\nMain Heading\nHeading - Definition\nIs unit ke notes abhi available nahi hain.`;
  }

  let out = `${chapterUnitLine}\n\nMain Heading\n`;
  let activeHeading = "Core Topic";
  let startedSection = false;

  for (const line of cleanedLines) {
    if (isLikelyHeading(line)) {
      activeHeading = line.replace(/[:\-–—]+$/, "").trim() || "Topic";
      out += `\n${activeHeading} - Definition\n`;
      startedSection = true;
      continue;
    }

    if (!startedSection) {
      out += `\n${activeHeading} - Definition\n`;
      startedSection = true;
    }

    if (isSubPoint(line)) {
      const pointBody = line
        .replace(/^(\d+[\).\s-]|[a-dA-D]\)\s*|[-–•●▪◦]\s*)+/, "")
        .trim();
      out += `• ${pointBody || line}\n`;
    } else if (line.length > 190) {
      const sentences = line.match(/[^.!?]+[.!?]+(\s|$)/g) || [line];
      for (const s of sentences) {
        const part = s.trim();
        if (!part) continue;
        if (part.length <= 135) {
          out += `• ${part}\n`;
        } else {
          out += `${part}\n`;
        }
      }
    } else {
      out += `${line}\n`;
    }
  }

  return out.trim();
}

function buildHandwrittenMessages(rawText, title) {
  const structured = buildStructuredNotesText(rawText, title);
  const lines = structured.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const formattedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("Chapter / Unit:")) {
      return `📘 *${escapeMarkdownText(trimmed)}*`;
    }
    if (trimmed === "Main Heading") {
      return `\n━━━━━━━━━━━━━━━━━━━━━━\n📌 *${escapeMarkdownText(trimmed)}*`;
    }
    if (trimmed.endsWith(" - Definition")) {
      return `\n*🔹 ${escapeMarkdownText(trimmed)}*`;
    }
    if (trimmed.startsWith("• ")) {
      return `✍️ ${escapeMarkdownText(trimmed)}`;
    }
    return `📖 ${escapeMarkdownText(trimmed)}`;
  });

  const footer = `\n━━━━━━━━━━━━━━━━━━━━━━\n📝 *Exam Tip:* Definitions aur points ko clear headings ke saath yaad rakhein.`;
  const maxChunkLen = 3350;
  const chunks = [];
  let current = "";

  for (const entry of formattedLines) {
    const block = `${entry}\n`;
    if ((current + block).length > maxChunkLen) {
      chunks.push(`${current.trimEnd()}${footer}`);
      current = `${block}`;
    } else {
      current += block;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(`${current.trimEnd()}${footer}`);
  }

  return chunks;
}
function generateStudyMaterialsFromPdfText(rawText, subjectName, unitName) {
  const cleanedLines = (rawText || "")
    .split(/\r?\n/)
    .map(cleanPdfLine)
    .filter((l) => l.length >= 12);

  const sentences = (rawText || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/[\u2022\u25CF\u25AA\u25AB\u25E6\uF0B7]/g, "").trim())
    .filter((s) => s.length >= 25 && s.length <= 260);

  const headings = cleanedLines
    .filter((l) => isLikelyHeading(l))
    .map((l) => l.replace(/:$/, "").trim());

  const factPool = sentences.length > 0 ? sentences : cleanedLines;
  const topicPool = headings.length > 0 ? headings : [unitName, subjectName];

  const pyqMcq = [];
  const pyqShort = [];
  const pyqLong = [];
  const mockMcqSet = [];

  const distractors = [
    "It is unrelated to pharmaceutical or natural product study.",
    "It applies only to synthetic polymers without biological origin.",
    "It is a non-therapeutic laboratory solvent only."
  ];

  const totalMcqTarget = Math.min(25, Math.max(5, factPool.length));
  for (let i = 0; i < totalMcqTarget; i++) {
    const fact = factPool[i % factPool.length];
    const headingHint = topicPool[i % topicPool.length];
    const qStem = `Which statement correctly describes "${headingHint}" in ${unitName}?`;
    const correctAns = fact.length > 110 ? `${fact.slice(0, 107)}...` : fact;

    const item = {
      question: qStem,
      options: {
        A: correctAns,
        B: distractors[0],
        C: distractors[1],
        D: distractors[2]
      },
      correctOption: "A",
      answer: `Option A — ${correctAns}`
    };

    pyqMcq.push(item);
    if (mockMcqSet.length < 20) {
      mockMcqSet.push(item);
    }
  }

  let padIdx = 1;
  while (mockMcqSet.length < 20) {
    const tName = topicPool[(mockMcqSet.length) % topicPool.length];
    const baseFact = factPool[mockMcqSet.length % Math.max(1, factPool.length)] || `${tName} is an important concept in ${subjectName}.`;
    const shortFact = baseFact.length > 105 ? `${baseFact.slice(0, 102)}...` : baseFact;
    mockMcqSet.push({
      question: `Mock Q${padIdx}: Identify the correct point regarding "${tName}" (${unitName}).`,
      options: {
        A: shortFact,
        B: "Used exclusively as an industrial fuel.",
        C: "Has no relevance to biological or medicinal study.",
        D: "Is a synthetic petroleum byproduct."
      },
      correctOption: "A",
      answer: `Option A — ${shortFact}`
    });
    padIdx++;
  }

  const shortCount = Math.min(15, Math.max(5, factPool.length));
  for (let i = 0; i < shortCount; i++) {
    const fact = factPool[i % factPool.length];
    const h = topicPool[i % topicPool.length];
    pyqShort.push({
      question: `Explain briefly: Key concept of "${h}" in ${unitName}.`,
      answer: fact
    });
  }

  const longCount = Math.min(10, Math.max(5, topicPool.length + 2));
  for (let i = 0; i < longCount; i++) {
    const h = topicPool[i % topicPool.length];
    const relatedFacts = factPool.slice(i * 2, i * 2 + 3);
    const ansText =
      relatedFacts.length > 0
        ? relatedFacts.join(" ")
        : `${h} is covered in ${unitName} under ${subjectName}. Write definition, classification/key points, and examples.`;

    pyqLong.push({
      question: `Discuss in detail "${h}" with key points, examples, and relevance in ${subjectName}.`,
      answer: ansText
    });
  }

  return {
    pyqStructured: {
      mcq: pyqMcq,
      short: pyqShort,
      long: pyqLong
    },
    mockMcqSet
  };
}

function detectLanguage(text) {
  if (/[\u0900-\u097F]/.test(text)) return "hindi";
  const lower = text.toLowerCase();
  const hinglishWords = [
    "kya", "hai", "hain", "kaise", "kese", "kaun", "kon", "aur", "me", "mein",
    "se", "ko", "ki", "ke", "ka", "likhna", "samjha", "batao", "bataiye",
    "dhoondh", "dhundh", "wala", "wali", "wale", "karna", "karein", "chahiye"
  ];
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.filter((w) => hinglishWords.includes(w)).length >= 1) return "hinglish";
  return "english";
}

function buildSmartAiAssistantResponse(query) {
  const lang = detectLanguage(query);
  const qLower = (query || "").toLowerCase();
  const keywords = qLower.split(/[^a-z0-9\u0900-\u097F]+/i).filter((w) => w.length >= 2);

  let bestExcerpt = "";
  let sourceLabel = "General Study Knowledge";

  for (const pdf of studyDb.uploadedPdfs || []) {
    const text = pdf.extractedText || "";
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const matched = lines.filter((l) => keywords.some((k) => l.toLowerCase().includes(k))).slice(0, 6);
    if (matched.length > 0) {
      bestExcerpt = matched.join("\n");
      sourceLabel = `${pdf.title} (${pdf.subjectName || "Admin PDF"})`;
      break;
    }
  }

  const notePreview = bestExcerpt
    ? buildHandwrittenMessages(bestExcerpt, query)[0]
    : `📓 *Topic:* *${escapeMarkdownText(query)}*\n✍️ • Key definitions, main points, aur examples ke saath answer likhein.`;

  if (lang === "hindi") {
    return `🤖 *AI सहायक*\n🔎 *विषय:* *${escapeMarkdownText(query)}*\n📂 *स्रोत:* ${escapeMarkdownText(sourceLabel)}\n\n${notePreview}`;
  }
  if (lang === "english") {
    return `🤖 *AI Assistant*\n🔎 *Topic:* *${escapeMarkdownText(query)}*\n📂 *Source:* ${escapeMarkdownText(sourceLabel)}\n\n${notePreview}`;
  }
  return `🤖 *AI Assistant*\n🔎 *Topic:* *${escapeMarkdownText(query)}*\n📂 *Source:* ${escapeMarkdownText(sourceLabel)}\n\n${notePreview}`;
}
function getMainMenuMarkup(user) {
  const roleLabel = isAdmin(user.id) ? "Admin" : "Student";

  const welcomeText =
`🌸 - <b>STUDY MATERIAL BOT</b> - 🌸

👤 Hello, <code>${escapeHtml(user.name)}</code> !

📚 <b>Your Complete Study Assistant</b>

➖ 📖 <b>Syllabus</b> (Subject > Units & Topics)
➖ ✍️ <b>Hand Written Notes</b> (Structured Notebook Format)
➖ 📝 <b>PYQ Question</b> (MCQ / Short / Long — 5-5 Set + Answers)
➖ 🎯 <b>Mock Test</b> (20 Questions Interactive Set)
➖ 🤖 <b>AI Assistant</b> (PDF Search)
➖ 🔗 <b>Links</b> (Admit Card & Result)

──────────────────────
👤 <b>User ID:</b> ${user.id}
🎖️ <b>Access:</b> ${roleLabel}
──────────────────────

<i>Tap any button below to begin.</i>`;

  const inline_keyboard = MAIN_MENU_BUTTONS.map((row) =>
    row.map((label) => {
      if (label === "🔗 Links") {
        return {
          text: label,
          callback_data: "links_menu"
        };
      }
      const idx = ALLOWED_STUDY_TYPES.indexOf(label);
      return {
        text: label,
        callback_data: `type_${idx}`
      };
    })
  );

  return { resText: welcomeText, reply_markup: { inline_keyboard } };
}

function renderMockQuestionMessage(session) {
  const qIndex = session.currentIndex;
  const total = session.questions.length;
  const item = session.questions[qIndex];

  const text =
`🎯 <b>MOCK TEST — ${escapeHtml(session.unitName)}</b>
📘 <b>Subject:</b> ${escapeHtml(session.subjectName)}
📊 <b>Question ${qIndex + 1} / ${total}</b>
✅ Correct: ${session.correctCount} | ❌ Wrong: ${session.wrongCount} | ⏭️ Skipped: ${session.skippedCount}

<b>Q${qIndex + 1}. ${escapeHtml(item.question)}</b>

<b>A)</b> ${escapeHtml(item.options.A)}
<b>B)</b> ${escapeHtml(item.options.B)}
<b>C)</b> ${escapeHtml(item.options.C)}
<b>D)</b> ${escapeHtml(item.options.D)}
<b>E)</b> <i>Chhodne ka (Skip)</i>`;

  const inline_keyboard = [
    [
      { text: "A", callback_data: `mockans_${qIndex}_A` },
      { text: "B", callback_data: `mockans_${qIndex}_B` },
      { text: "C", callback_data: `mockans_${qIndex}_C` },
      { text: "D", callback_data: `mockans_${qIndex}_D` }
    ],
    [
      { text: "E — Chhodne Ka (Skip)", callback_data: `mockans_${qIndex}_E` }
    ],
    [
      { text: "🔙 Main Menu", callback_data: "main_menu" }
    ]
  ];

  return { text, reply_markup: { inline_keyboard } };
}

function renderMockSummaryMessage(session) {
  const total = session.questions.length;
  const text =
`🏁 <b>MOCK TEST COMPLETED!</b>

📘 <b>Subject:</b> ${escapeHtml(session.subjectName)}
📂 <b>Unit:</b> ${escapeHtml(session.unitName)}
──────────────────────
📝 <b>Total Questions:</b> ${total}
✅ <b>Sahi (Correct):</b> ${session.correctCount}
❌ <b>Galat (Wrong):</b> ${session.wrongCount}
⏭️ <b>Chhode Gaye (Skipped):</b> ${session.skippedCount}
──────────────────────`;

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Restart 20-Q Mock Test", callback_data: `sunit_${session.navSuffix}` }],
        [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
      ]
    }
  };
}

function renderPyqSetMessage(pyqRec, pyqType, setIdx, subjectName, unitName, navSuffix) {
  const list = (pyqRec && pyqRec.pyqStructured && pyqRec.pyqStructured[pyqType]) || [];
  const totalAvailable = list.length;
  const pageSize = 5;
  const totalSets = Math.max(1, Math.ceil(totalAvailable / pageSize));
  const safeSetIdx = Math.max(0, Math.min(setIdx, totalSets - 1));
  const start = safeSetIdx * pageSize;
  const slice = list.slice(start, start + pageSize);

  const typeLabel =
    pyqType === "mcq"
      ? "MCQ QUESTIONS"
      : pyqType === "short"
        ? "SHORT QUESTIONS"
        : "LONG QUESTIONS";

  let body = "";
  if (slice.length === 0) {
    body = "Is unit ke liye abhi questions generate nahi hue hain. Admin ek baar PDF upload kare.";
  } else {
    body = slice
      .map((item, idx) => {
        const qNum = start + idx + 1;
        if (pyqType === "mcq") {
          const opts = item.options || {};
          return (
`<b>Q${qNum}. ${escapeHtml(item.question)}</b>
A) ${escapeHtml(opts.A || "")}
B) ${escapeHtml(opts.B || "")}
C) ${escapeHtml(opts.C || "")}
D) ${escapeHtml(opts.D || "")}

<b>✅ Answer:</b> ${escapeHtml(item.answer || "")}`
          );
        }
        return (
`<b>Q${qNum}. ${escapeHtml(item.question)}</b>

<b>✅ Answer:</b> ${escapeHtml(item.answer || "")}`
        );
      })
      .join("\n\n\n");
  }

  const navRow = [];
  if (safeSetIdx > 0) {
    navRow.push({
      text: `⬅️ Set ${safeSetIdx}`,
      callback_data: `pyqset_${pyqType}_${safeSetIdx - 1}_${navSuffix}`
    });
  }
  if (safeSetIdx + 1 < totalSets) {
    navRow.push({
      text: `Next Set ${safeSetIdx + 2} ➡️`,
      callback_data: `pyqset_${pyqType}_${safeSetIdx + 1}_${navSuffix}`
    });
  }

  const keyboard = [];
  if (navRow.length > 0) keyboard.push(navRow);
  keyboard.push([{ text: "🔙 Back to PYQ Type", callback_data: `sunit_${navSuffix}` }]);
  keyboard.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

  const text =
`📝 <b>PYQ ${typeLabel} — ${escapeHtml(unitName)}</b>
📘 <b>Subject:</b> ${escapeHtml(subjectName)}
📊 <b>Total PYQs Found:</b> ${totalAvailable} | <b>Set ${safeSetIdx + 1} / ${totalSets}</b> (5 Questions/Set)


${body}`;

  return { text, reply_markup: { inline_keyboard: keyboard } };
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

      if (update.message.document || (Array.isArray(update.message.photo) && update.message.photo.length > 0)) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "🚫 <b>Permission Denied:</b> Sirf Admin hi PDF ya Photo upload kar sakta hai.",
            parse_mode: "HTML"
          });
          return;
        }

        const flow = user.adminUploadFlow;
        if (!flow || !flow.category || !flow.course || !flow.periodKey || !flow.subjectName || !flow.unitName) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Pehle <code>/add_pdf Category | Course | Year (or -) | Semester | Subject | Unit | Title</code> command bhejein, phir PDF ya Photo bhejein.",
            parse_mode: "HTML"
          });
          return;
        }

        const itemTitle = flow.title || "Unit Material";
        const notesUnit = ensureUnitRecord(
          flow.category,
          flow.course,
          flow.periodKey,
          "Hand Written Notes",
          flow.subjectName,
          flow.unitName,
          true
        );

        if (Array.isArray(update.message.photo) && update.message.photo.length > 0) {
          const bestPhoto = update.message.photo[update.message.photo.length - 1];
          const photoRecord = {
            title: itemTitle,
            fileId: bestPhoto.file_id,
            fileSize: bestPhoto.file_size || 0,
            category: flow.category,
            course: flow.course,
            periodKey: flow.periodKey,
            subjectName: flow.subjectName,
            unitName: flow.unitName,
            addedBy: from.id,
            addedAt: new Date().toISOString()
          };

          notesUnit.photos.push(photoRecord);
          persistAll();

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text:
`🖼️ <b>Photo Added (${notesUnit.photos.length} Total Photos in Unit)!</b>

📌 <b>Title:</b> <code>${escapeHtml(itemTitle)}</code>
🎓 <b>Course:</b> ${escapeHtml(flow.course)} (${escapeHtml(flow.periodKey)})
📘 <b>Subject:</b> ${escapeHtml(flow.subjectName)}
📂 <b>Unit:</b> ${escapeHtml(flow.unitName)}

<i>Aap is unit mein aur photos ya PDFs bhi bhej sakte hain.</i>`,
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
            text: "⚠️ Kripya <b>PDF</b> file ya <b>Photo</b> bhejein.",
            parse_mode: "HTML"
          });
          return;
        }

        const fileSizeBytes = Number(doc.file_size || 0);
        const fileSizeMb = fileSizeBytes > 0 ? (fileSizeBytes / (1024 * 1024)).toFixed(2) : "Unknown";
        let extractedText = "";
        let downloadNote = "Text extracted";

        if (pdfParse) {
          if (fileSizeBytes > 20 * 1024 * 1024) {
            downloadNote = `Large file (${fileSizeMb} MB) saved by file_id`;
          } else {
            try {
              const fileInfoRes = await axios.get(`${TELEGRAM_API}/getFile`, {
                params: { file_id: doc.file_id },
                timeout: 25000
              });
              const filePath = fileInfoRes.data && fileInfoRes.data.result && fileInfoRes.data.result.file_path;
              if (filePath) {
                const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
                const pdfBufferRes = await axios.get(fileUrl, {
                  responseType: "arraybuffer",
                  timeout: 45000
                });
                const parsedPdf = await pdfParse(Buffer.from(pdfBufferRes.data));
                extractedText = (parsedPdf.text || "").trim();
              }
            } catch (pdfErr) {
              console.log("PDF parse/download error:", pdfErr.message);
              downloadNote = `Saved by file_id (${fileSizeMb} MB) — large/scanned PDF fallback`;
            }
          }
        } else {
          downloadNote = `Saved by file_id (${fileSizeMb} MB)`;
        }

        const pdfTitle = flow.title || doc.file_name || "Unit PDF";
        const pdfRecord = {
          title: pdfTitle,
          fileName: doc.file_name || "document.pdf",
          fileId: doc.file_id,
          fileSize: fileSizeBytes,
          category: flow.category,
          course: flow.course,
          periodKey: flow.periodKey,
          subjectName: flow.subjectName,
          unitName: flow.unitName,
          extractedText,
          addedBy: from.id,
          addedAt: new Date().toISOString()
        };

        studyDb.uploadedPdfs.push(pdfRecord);

        const pdfMeta = {
          title: pdfTitle,
          fileName: doc.file_name || "document.pdf",
          fileId: doc.file_id,
          fileSizeMb,
          uploadedAt: new Date().toISOString()
        };

        notesUnit.pdfs.push(pdfMeta);

        if (extractedText.length > 0) {
          const structuredSection = buildStructuredNotesText(
            extractedText,
            `${flow.unitName} — ${pdfTitle}`,
            flow.subjectName
          );
          notesUnit.handwrittenNotes = notesUnit.handwrittenNotes
            ? `${notesUnit.handwrittenNotes}\n\n${structuredSection}`
            : structuredSection;

          const generated = generateStudyMaterialsFromPdfText(
            extractedText,
            flow.subjectName,
            flow.unitName
          );

          const pyqUnit = ensureUnitRecord(
            flow.category,
            flow.course,
            flow.periodKey,
            "PYQ Question",
            flow.subjectName,
            flow.unitName,
            true
          );
          pyqUnit.pdfs.push(pdfMeta);
          pyqUnit.pyqStructured = {
            mcq: [...(pyqUnit.pyqStructured.mcq || []), ...generated.pyqStructured.mcq],
            short: [...(pyqUnit.pyqStructured.short || []), ...generated.pyqStructured.short],
            long: [...(pyqUnit.pyqStructured.long || []), ...generated.pyqStructured.long]
          };
          pyqUnit.pyqQuestions = [
            ...pyqUnit.pyqStructured.mcq.map((q) => `${q.question} — ${q.answer}`),
            ...pyqUnit.pyqStructured.short.map((q) => `${q.question} — ${q.answer}`),
            ...pyqUnit.pyqStructured.long.map((q) => `${q.question} — ${q.answer}`)
          ];

          const mockUnit = ensureUnitRecord(
            flow.category,
            flow.course,
            flow.periodKey,
            "Mock Test",
            flow.subjectName,
            flow.unitName,
            true
          );
          mockUnit.pdfs.push(pdfMeta);
          const combinedMock = [...(mockUnit.mockMcqSet || []), ...generated.mockMcqSet].slice(0, 20);
          mockUnit.mockMcqSet = combinedMock;
          mockUnit.mockQuestions = combinedMock.map((q) => q.question);
        } else if (!notesUnit.handwrittenNotes) {
          notesUnit.handwrittenNotes = buildStructuredNotesText(
            `${pdfTitle} (${doc.file_name || "PDF"}) uploaded (${fileSizeMb} MB).`,
            flow.unitName,
            flow.subjectName
          );
        }

        persistAll();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text:
`✅ <b>PDF Added (${notesUnit.pdfs.length} Total PDFs in Unit)!</b>

📄 <b>Title:</b> <code>${escapeHtml(pdfTitle)}</code>
📦 <b>Size:</b> ${escapeHtml(String(fileSizeMb))} MB
🎓 <b>Course:</b> ${escapeHtml(flow.course)} (${escapeHtml(flow.periodKey)})
📘 <b>Subject:</b> ${escapeHtml(flow.subjectName)}
📂 <b>Unit:</b> ${escapeHtml(flow.unitName)}
📝 <b>Status:</b> ${escapeHtml(downloadNote)} (${extractedText.length} chars)

<i>Aap is unit mein aur PDFs ya photos bhi bhej sakte hain.</i>`,
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
        user.activeMockSession = null;
        persistAll();

        const menu = getMainMenuMarkup(user);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: menu.resText,
          parse_mode: "HTML",
          reply_markup: menu.reply_markup
        });
      }
      else if (text.startsWith('/add_cat')) {
        if (!isAdmin(from.id)) return;
        const catName = text.replace('/add_cat', '').trim();
        if (!catName) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_cat CategoryName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        if (!CATEGORIES[catName]) CATEGORIES[catName] = [];
        if (!studyDb.materials[catName]) studyDb.materials[catName] = {};
        persistAll();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Category Added:</b> <code>${escapeHtml(catName)}</code>`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/del_cat')) {
        if (!isAdmin(from.id)) return;
        const catName = text.replace('/del_cat', '').trim();
        if (!catName || !CATEGORIES[catName]) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/del_cat CategoryName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        delete CATEGORIES[catName];
        if (studyDb.materials[catName]) delete studyDb.materials[catName];
        persistAll();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🗑️ <b>Category Removed:</b> <code>${escapeHtml(catName)}</code>`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_course')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/add_course', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_course Category | CourseName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, courseName] = parts;
        if (!CATEGORIES[category]) CATEGORIES[category] = [];
        if (!CATEGORIES[category].includes(courseName)) CATEGORIES[category].push(courseName);
        if (!studyDb.materials[category]) studyDb.materials[category] = {};
        if (!studyDb.materials[category][courseName]) studyDb.materials[category][courseName] = {};
        persistAll();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Course Added:</b> <code>${escapeHtml(courseName)}</code> in <b>${escapeHtml(category)}</b>`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/del_course')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/del_course', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/del_course Category | CourseName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, courseName] = parts;
        if (Array.isArray(CATEGORIES[category])) {
          CATEGORIES[category] = CATEGORIES[category].filter((c) => c !== courseName);
        }
        if (studyDb.materials[category] && studyDb.materials[category][courseName]) {
          delete studyDb.materials[category][courseName];
        }
        persistAll();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🗑️ <b>Course Removed:</b> <code>${escapeHtml(courseName)}</code> from <b>${escapeHtml(category)}</b>`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_year')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/add_year', '').trim().split('|').map((s) => s.trim());
        const [category, course, yearName] = parts;
        if (!category || !course || !yearName) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_year Category | Course | YearName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        ensureDbDefaults();
        const key = `${category}::${course}`;
        if (!Array.isArray(studyDb.customYears[key])) studyDb.customYears[key] = [];
        if (!studyDb.customYears[key].includes(yearName)) studyDb.customYears[key].push(yearName);
        persistAll();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Year Added:</b> <code>${escapeHtml(yearName)}</code> (${escapeHtml(course)})`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_sem')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/add_sem', '').trim().split('|').map((s) => s.trim());
        const [category, course, yearRaw, semName] = parts;
        if (!category || !course || !yearRaw || !semName) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_sem Category | Course | Year (or -) | SemesterName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        ensureDbDefaults();
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const key = yearName ? `${category}::${course}::${yearName}` : `${category}::${course}`;
        if (!Array.isArray(studyDb.customSemesters[key])) studyDb.customSemesters[key] = [];
        if (!studyDb.customSemesters[key].includes(semName)) studyDb.customSemesters[key].push(semName);
        persistAll();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Semester Added:</b> <code>${escapeHtml(semName)}</code> (${escapeHtml(course)})`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_subject')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/add_subject', '').trim().split('|').map((s) => s.trim());
        const [category, course, yearRaw, semester, studyTypeRaw, subjectName] = parts;
        if (!category || !course || !yearRaw || !semester || !studyTypeRaw || !subjectName) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_subject Category | Course | Year (or -) | Semester | StudyType | SubjectName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);
        const bucket = getSubjectBucket(category, course, periodKey, studyTypeRaw, true);
        if (!bucket.subjects[subjectName]) bucket.subjects[subjectName] = { units: {} };
        persistAll();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Subject Added:</b> <code>${escapeHtml(subjectName)}</code> (${escapeHtml(course)} > ${escapeHtml(periodKey)})`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/list_pdfs')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/list_pdfs', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 6 || parts.some((p) => !p)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/list_pdfs Category | Course | Year (or -) | Semester | Subject | Unit</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, subjectName, unitName] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        const notesRec = ensureUnitRecord(category, course, periodKey, "Hand Written Notes", subjectName, unitName, false);
        const unitPdfs = notesRec && Array.isArray(notesRec.pdfs) ? notesRec.pdfs : [];
        const unitPhotos = notesRec && Array.isArray(notesRec.photos) ? notesRec.photos : [];

        if (unitPdfs.length === 0 && unitPhotos.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📂 Is unit mein koi PDF ya Photo nahi mili:\n<b>${escapeHtml(course)} > ${escapeHtml(periodKey)} > ${escapeHtml(subjectName)} > ${escapeHtml(unitName)}</b>`,
            parse_mode: "HTML"
          });
          return;
        }

        const pdfLines = unitPdfs.map(
          (pdf, i) => `${i + 1}. 📄 <b>${escapeHtml(pdf.title || pdf.fileName || "PDF")}</b> (${escapeHtml(String(pdf.fileSizeMb || "?"))} MB)`
        );
        const photoLines = unitPhotos.map(
          (ph, i) => `${i + 1}. 🖼️ <b>${escapeHtml(ph.title || "Unit Photo")}</b>`
        );

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text:
`📂 <b>FILES IN UNIT</b>
🎓 <b>Course:</b> ${escapeHtml(course)} (${escapeHtml(periodKey)})
📘 <b>Subject:</b> ${escapeHtml(subjectName)}
📂 <b>Unit:</b> ${escapeHtml(unitName)}

<b>PDFs (${unitPdfs.length}):</b>
${pdfLines.length ? pdfLines.join("\n") : "• None"}

<b>Photos (${unitPhotos.length}):</b>
${photoLines.length ? photoLines.join("\n") : "• None"}`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_link')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/add_link', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 5 || parts.some((p) => !p)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_link Admit Card | Pharmacy | 1st Year | Semester 1 | https://example.com</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [typeRaw, pharmacyOrCategory, yearVal, semesterVal, ...urlParts] = parts;
        const urlVal = urlParts.join(" | ").trim();
        const typeLower = typeRaw.toLowerCase();
        const linkType = typeLower.includes("result")
          ? "Result"
          : typeLower.includes("admit")
            ? "Admit Card"
            : null;

        if (!linkType) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Type mein <b>Admit Card</b> ya <b>Result</b> likhein.",
            parse_mode: "HTML"
          });
          return;
        }

        ensureDbDefaults();
        studyDb.examLinks[linkType].push({
          category: pharmacyOrCategory,
          year: yearVal,
          semester: semesterVal,
          url: urlVal
        });
        persistAll();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text:
`✅ <b>${escapeHtml(linkType)} Link Added!</b>
${escapeHtml(pharmacyOrCategory)}
${escapeHtml(yearVal)}
${escapeHtml(semesterVal)}
${escapeHtml(urlVal)}`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/del_link')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/del_link', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/del_link Admit Card | 1</code> or <code>/del_link Result | 1</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [typeRaw, indexStr] = parts;
        const typeLower = typeRaw.toLowerCase();
        const linkType = typeLower.includes("result")
          ? "Result"
          : typeLower.includes("admit")
            ? "Admit Card"
            : null;
        const idx = parseInt(indexStr, 10) - 1;

        ensureDbDefaults();
        const arr = linkType ? studyDb.examLinks[linkType] : null;
        if (!arr || isNaN(idx) || idx < 0 || idx >= arr.length) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Valid link type aur serial number (1, 2, ...) dein.",
            parse_mode: "HTML"
          });
          return;
        }
        const removed = arr.splice(idx, 1)[0];
        persistAll();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🗑️ <b>${escapeHtml(linkType)} Link Removed:</b> ${escapeHtml(removed.category)} - ${escapeHtml(removed.year)} - ${escapeHtml(removed.semester)}`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_topic')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/add_topic', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_topic Category | Course | Year (or -) | Semester | Subject | Unit | Topic1, Topic2</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, subjectName, unitName, topicsRaw] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        const unitRec = ensureUnitRecord(category, course, periodKey, "Syllabus", subjectName, unitName, true);
        const newTopics = topicsRaw.split(',').map((t) => t.trim()).filter(Boolean);
        for (const tp of newTopics) {
          if (!unitRec.topics.includes(tp)) unitRec.topics.push(tp);
        }
        persistAll();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Syllabus Topics Added!</b>\n${escapeHtml(course)} > ${escapeHtml(periodKey)} > <b>${escapeHtml(subjectName)}</b>\nUnit: <b>${escapeHtml(unitName)}</b>`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_pdf')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/add_pdf', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_pdf Category | Course | Year (or -) | Semester | Subject | Unit | PDF Title</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, subjectName, unitName, ...titleParts] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);
        const title = titleParts.join(" | ");

        user.adminUploadFlow = {
          step: "WAITING_MULTI_PDF_OR_PHOTO",
          category,
          course,
          periodKey,
          subjectName,
          unitName,
          title
        };
        persistAll();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📎 PDF ya Photo bhejein (<b>${escapeHtml(title)}</b>). Aap is unit mein jitni chahein utni PDFs/photos bhej sakte hain.`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/update_course')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/update_course', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 3) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/update_course Category | OldCourseName | NewCourseName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, oldCourse, newCourse] = parts;
        if (CATEGORIES[category] && CATEGORIES[category].includes(oldCourse)) {
          CATEGORIES[category] = CATEGORIES[category].map((c) => (c === oldCourse ? newCourse : c));
        }
        if (studyDb.materials[category] && studyDb.materials[category][oldCourse]) {
          studyDb.materials[category][newCourse] = studyDb.materials[category][oldCourse];
          delete studyDb.materials[category][oldCourse];
        }
        persistAll();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✏️ <b>Course Updated:</b> <code>${escapeHtml(oldCourse)}</code> ➡️ <code>${escapeHtml(newCourse)}</code> (${escapeHtml(category)})`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/update_unit')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/update_unit', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 8) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/update_unit Category | Course | Year (or -) | Semester | StudyType | Subject | OldUnitName | NewUnitName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, studyType, subjectName, oldUnit, newUnit] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        const bucket = getSubjectBucket(category, course, periodKey, studyType, false);
        if (bucket && bucket.subjects[subjectName] && bucket.subjects[subjectName].units && bucket.subjects[subjectName].units[oldUnit]) {
          bucket.subjects[subjectName].units[newUnit] = bucket.subjects[subjectName].units[oldUnit];
          delete bucket.subjects[subjectName].units[oldUnit];
          persistAll();

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `✏️ <b>Unit Updated:</b> <code>${escapeHtml(oldUnit)}</code> ➡️ <code>${escapeHtml(newUnit)}</code>`,
            parse_mode: "HTML"
          });
        } else {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Unit nahi mili. Details check karein.",
            parse_mode: "HTML"
          });
        }
      }
      else if (text.startsWith('/del_unit')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/del_unit', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/del_unit Category | Course | Year (or -) | Semester | StudyType | Subject | UnitName</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, studyType, subjectName, unitName] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);

        const bucket = getSubjectBucket(category, course, periodKey, studyType, false);
        if (bucket && bucket.subjects[subjectName] && bucket.subjects[subjectName].units && bucket.subjects[subjectName].units[unitName]) {
          delete bucket.subjects[subjectName].units[unitName];
          persistAll();
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🗑️ <b>Unit Removed:</b> <code>${escapeHtml(unitName)}</code> (${escapeHtml(subjectName)})`,
            parse_mode: "HTML"
          });
        } else {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Ye unit nahi mili.",
            parse_mode: "HTML"
          });
        }
      }
      else if (user.selectedType === "AI Assistant" && text.length > 0) {
        const reply = buildSmartAiAssistantResponse(text);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: reply,
          parse_mode: "Markdown"
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
        user.activeMockSession = null;
        persistAll();
        await deletePrevMessage();
        const menu = getMainMenuMarkup(user);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: menu.resText,
          parse_mode: "HTML",
          reply_markup: menu.reply_markup
        });
      }
      else if (data === "links_menu") {
        await deletePrevMessage();
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: "🔗 <b>LINKS MENU</b>\n\nKya dekhna chahte hain?",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🪪 Admit Card", callback_data: "linkcat_Admit Card" }],
              [{ text: "📊 Result", callback_data: "linkcat_Result" }],
              [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
            ]
          }
        });
      }
      else if (data.startsWith("linkcat_")) {
        ensureDbDefaults();
        const linkType = data.replace("linkcat_", "");
        const items = studyDb.examLinks[linkType] || [];

        await deletePrevMessage();

        if (items.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🔗 <b>${escapeHtml(linkType)}</b>\n\nAbhi koi link add nahi kiya gaya hai.`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔙 Back to Links", callback_data: "links_menu" }],
                [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
              ]
            }
          });
        } else {
          const blocks = items.map((item, i) =>
`<b>${i + 1}.</b>
<b>${escapeHtml(item.category)}</b>
<b>${escapeHtml(item.year)}</b>
<b>${escapeHtml(item.semester)}</b>
<a href="${item.url}">${escapeHtml(item.url)}</a>`
          );

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🔗 <b>${escapeHtml(linkType)}</b>\n\n${blocks.join("\n\n──────────────────────\n\n")}`,
            parse_mode: "HTML",
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔙 Back to Links", callback_data: "links_menu" }],
                [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
              ]
            }
          });
        }
      }
      else if (data.startsWith("type_")) {
        const idx = parseInt(data.replace("type_", ""), 10);
        const typeName = ALLOWED_STUDY_TYPES[idx];

        if (!typeName) return;
        user.selectedType = typeName;
        user.selectedCategory = null;
        user.selectedStream = null;
        user.selectedYear = null;
        user.selectedSemester = null;
        persistAll();

        await deletePrevMessage();

        if (typeName === "AI Assistant") {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "🤖 <b>AI ASSISTANT READY</b>\n\nApna topic ya sawaal likhein.",
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const catList = getCategoryList();
        const catButtons = catList.map((catName, cIdx) => [
          { text: `🎓 ${catName}`, callback_data: `cat_${cIdx}` }
        ]);
        catButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📚 <b>${escapeHtml(typeName.toUpperCase())}</b>\n\nCategory chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: catButtons }
        });
      }
      else if (data.startsWith("cat_")) {
        const cIdx = parseInt(data.replace("cat_", ""), 10);
        const catList = getCategoryList();
        const catName = catList[cIdx];
        const courses = getCoursesForCategory(catName);
        user.selectedCategory = catName;
        persistAll();

        await deletePrevMessage();
        const courseButtons = courses.map((courseName, sIdx) => [
          { text: `📘 ${courseName}`, callback_data: `str_${cIdx}_${sIdx}` }
        ]);
        courseButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `⚡ <b>${escapeHtml(catName.toUpperCase())} — ${escapeHtml(user.selectedType || "")}</b>\n\nApna <b>Course</b> chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: courseButtons }
        });
      }
      else if (data.startsWith("str_")) {
        const [, cIdxStr, sIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const catName = getCategoryList()[cIdx];
        const courseName = getCoursesForCategory(catName)[sIdx];
        const studyType = user.selectedType || "Syllabus";

        user.selectedCategory = catName;
        user.selectedStream = courseName;
        persistAll();

        await deletePrevMessage();

        const years = getYearsForCourse(catName, courseName);
        if (years.length > 0) {
          const yearButtons = years.map((yrName, yIdx) => [
            { text: `📅 ${yrName}`, callback_data: `yr_${cIdx}_${sIdx}_${yIdx}` }
          ]);
          yearButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🎓 <b>${escapeHtml(courseName)} — ${escapeHtml(studyType)}</b>\n\nApna <b>Year</b> chunein:`,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: yearButtons }
          });
          return;
        }

        const sems = getSemestersForCourse(catName, courseName, null);
        const semButtons = sems.map((semName, semIdx) => [
          { text: `🗓️ ${semName}`, callback_data: `sem_${cIdx}_${sIdx}_n_${semIdx}` }
        ]);
        semButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🎓 <b>${escapeHtml(courseName)} — ${escapeHtml(studyType)}</b>\n\nApna <b>Semester</b> chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: semButtons }
        });
      }
      else if (data.startsWith("yr_")) {
        const [, cIdxStr, sIdxStr, yIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const yIdx = parseInt(yIdxStr, 10);

        const catName = getCategoryList()[cIdx];
        const courseName = getCoursesForCategory(catName)[sIdx];
        const yearName = getYearsForCourse(catName, courseName)[yIdx];
        const studyType = user.selectedType || "Syllabus";

        user.selectedYear = yearName;
        persistAll();

        await deletePrevMessage();

        const sems = getSemestersForCourse(catName, courseName, yearName);
        const semButtons = sems.map((semName, semIdx) => [
          { text: `🗓️ ${semName}`, callback_data: `sem_${cIdx}_${sIdx}_${yIdx}_${semIdx}` }
        ]);
        semButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🎓 <b>${escapeHtml(courseName)} — ${escapeHtml(yearName)}</b>\n📚 Module: <b>${escapeHtml(studyType)}</b>\n\nApna <b>Semester</b> chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: semButtons }
        });
      }
      else if (data.startsWith("sem_")) {
        const [, cIdxStr, sIdxStr, yPart, semIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);

        const catName = getCategoryList()[cIdx];
        const courseName = getCoursesForCategory(catName)[sIdx];
        const yearName = yPart === "n" ? null : getYearsForCourse(catName, courseName)[parseInt(yPart, 10)];
        const semName = getSemestersForCourse(catName, courseName, yearName)[semIdx];
        const studyType = user.selectedType || "Syllabus";
        const periodKey = buildPeriodStorageKey(yearName, semName);

        user.selectedSemester = semName;
        persistAll();

        await deletePrevMessage();

        const tIdx = ALLOWED_STUDY_TYPES.indexOf(studyType);
        const bucket = getSubjectBucket(catName, courseName, periodKey, studyType, false);
        const subjects = bucket ? Object.keys(bucket.subjects) : [];

        if (subjects.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📘 <b>${escapeHtml(courseName)} > ${escapeHtml(periodKey)} — ${escapeHtml(studyType)}</b>\n\nIs semester mein abhi koi subject add nahi hua hai.`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const subjButtons = subjects.map((subjName, sbIdx) => [
          { text: `📘 ${subjName}`, callback_data: `subj_${cIdx}_${sIdx}_${yPart}_${semIdx}_${tIdx}_${sbIdx}` }
        ]);
        subjButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `🗓️ <b>${escapeHtml(courseName)} — ${escapeHtml(periodKey)} (${escapeHtml(studyType)})</b>\n\nApna <b>Subject</b> chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: subjButtons }
        });
      }
      else if (data.startsWith("subj_")) {
        const [, cIdxStr, sIdxStr, yPart, semIdxStr, tIdxStr, sbIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const sbIdx = parseInt(sbIdxStr, 10);

        const catName = getCategoryList()[cIdx];
        const courseName = getCoursesForCategory(catName)[sIdx];
        const yearName = yPart === "n" ? null : getYearsForCourse(catName, courseName)[parseInt(yPart, 10)];
        const semName = getSemestersForCourse(catName, courseName, yearName)[semIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];
        const periodKey = buildPeriodStorageKey(yearName, semName);

        const bucket = getSubjectBucket(catName, courseName, periodKey, studyType, false);
        const subjectName = bucket ? Object.keys(bucket.subjects)[sbIdx] : null;
        const unitsObj = subjectName ? (bucket.subjects[subjectName].units || {}) : {};
        const unitNames = Object.keys(unitsObj);

        await deletePrevMessage();

        if (studyType === "Syllabus") {
          let syllabusBody = "";
          if (unitNames.length === 0) {
            syllabusBody = "Is subject mein abhi koi unit / topic add nahi hua hai.";
          } else {
            syllabusBody = unitNames
              .map((uName, idx) => {
                const tList = unitsObj[uName].topics || [];
                const topicLines = tList.length > 0
                  ? tList.map((tp, tIndex) => `   ${tIndex + 1}. ${escapeHtml(tp)}`).join("\n")
                  : "   • (Topics add karna baaki hai)";
                return `📂 <b>Unit ${idx + 1}: ${escapeHtml(uName)}</b>\n${topicLines}`;
              })
              .join("\n\n──────────────────────\n\n");
          }

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📖 <b>SYLLABUS — ${escapeHtml(subjectName || "")}</b>\n🎓 <b>Course:</b> ${escapeHtml(courseName)} (${escapeHtml(periodKey)})\n\n${syllabusBody}`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        if (unitNames.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📂 <b>${escapeHtml(subjectName || "")} — ${escapeHtml(studyType)}</b>\n\nIs subject mein abhi koi unit available nahi hai.`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        const unitButtons = unitNames.map((uName, uIdx) => [
          { text: `📂 ${uName}`, callback_data: `sunit_${cIdx}_${sIdx}_${yPart}_${semIdx}_${tIdx}_${sbIdx}_${uIdx}` }
        ]);
        unitButtons.push([{ text: "🔙 Main Menu", callback_data: "main_menu" }]);

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📘 <b>${escapeHtml(subjectName || "")} — ${escapeHtml(studyType)}</b>\n\nUnit / Chapter chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: unitButtons }
        });
      }
      else if (data.startsWith("sunit_")) {
        const parts = data.split("_");
        const navSuffix = parts.slice(1).join("_");
        const [cIdxStr, sIdxStr, yPart, semIdxStr, tIdxStr, sbIdxStr, uIdxStr] = parts.slice(1);

        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const sbIdx = parseInt(sbIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);

        const catName = getCategoryList()[cIdx];
        const courseName = getCoursesForCategory(catName)[sIdx];
        const yearName = yPart === "n" ? null : getYearsForCourse(catName, courseName)[parseInt(yPart, 10)];
        const semName = getSemestersForCourse(catName, courseName, yearName)[semIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];
        const periodKey = buildPeriodStorageKey(yearName, semName);

        const bucket = getSubjectBucket(catName, courseName, periodKey, studyType, false);
        const subjectName = bucket ? Object.keys(bucket.subjects)[sbIdx] : null;
        const unitName = subjectName ? Object.keys(bucket.subjects[subjectName].units || {})[uIdx] : null;
        const unitRec = unitName ? bucket.subjects[subjectName].units[unitName] : null;

        await deletePrevMessage();

        if (studyType === "Hand Written Notes") {
          const rawNotes = (unitRec && unitRec.handwrittenNotes) || "";
          const noteMessages = buildHandwrittenMessages(rawNotes, `${unitName} (${subjectName})`);
          const photosList = Array.isArray(unitRec && unitRec.photos) ? unitRec.photos : [];

          for (let i = 0; i < noteMessages.length; i++) {
            const isLastText = i === noteMessages.length - 1 && photosList.length === 0;
            const partLabel = noteMessages.length > 1 ? `\n📄 *Page ${i + 1} / ${noteMessages.length}*` : "";

            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: `${noteMessages[i]}${partLabel}`,
              parse_mode: "Markdown",
              reply_markup: isLastText
                ? { inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]] }
                : undefined
            });
          }

          for (let pIdx = 0; pIdx < photosList.length; pIdx++) {
            const ph = photosList[pIdx];
            const isLastPhoto = pIdx === photosList.length - 1;
            await axios.post(`${TELEGRAM_API}/sendPhoto`, {
              chat_id: chatId,
              photo: ph.fileId,
              caption: `🖼️ <b>${escapeHtml(ph.title || unitName || "Unit Photo")}</b> (${pIdx + 1}/${photosList.length})`,
              parse_mode: "HTML",
              reply_markup: isLastPhoto
                ? { inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]] }
                : undefined
            });
          }
          return;
        }

        if (studyType === "PYQ Question") {
          const st = (unitRec && unitRec.pyqStructured) || { mcq: [], short: [], long: [] };
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text:
`📝 <b>PYQ QUESTION BANK — ${escapeHtml(unitName || "")}</b>
📘 <b>Subject:</b> ${escapeHtml(subjectName || "")}

Available PYQs (5-5 ke Set mein Question + Answer):
• MCQ PYQs: <b>${st.mcq.length}</b>
• Short Questions: <b>${st.short.length}</b>
• Long Questions: <b>${st.long.length}</b>

Question type chunein:`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: `🧠 MCQ (${st.mcq.length})`, callback_data: `pyqset_mcq_0_${navSuffix}` }],
                [{ text: `✍️ Short (${st.short.length})`, callback_data: `pyqset_short_0_${navSuffix}` }],
                [{ text: `📖 Long (${st.long.length})`, callback_data: `pyqset_long_0_${navSuffix}` }],
                [{ text: "🔙 Main Menu", callback_data: "main_menu" }]
              ]
            }
          });
          return;
        }

        if (studyType === "Mock Test") {
          const qSet = (unitRec && Array.isArray(unitRec.mockMcqSet) && unitRec.mockMcqSet.length > 0)
            ? unitRec.mockMcqSet.slice(0, 20)
            : generateStudyMaterialsFromPdfText(
                (unitRec && unitRec.handwrittenNotes) || "",
                subjectName || "",
                unitName || ""
              ).mockMcqSet;

          user.activeMockSession = {
            subjectName: subjectName || "",
            unitName: unitName || "",
            navSuffix,
            questions: qSet,
            currentIndex: 0,
            correctCount: 0,
            wrongCount: 0,
            skippedCount: 0
          };
          persistAll();

          const firstView = renderMockQuestionMessage(user.activeMockSession);
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: firstView.text,
            parse_mode: "HTML",
            reply_markup: firstView.reply_markup
          });
        }
      }
      else if (data.startsWith("pyqset_")) {
        const [, pyqType, setIdxStr, ...navParts] = data.split("_");
        const navSuffix = navParts.join("_");
        const [cIdxStr, sIdxStr, yPart, semIdxStr, tIdxStr, sbIdxStr, uIdxStr] = navParts;

        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const sbIdx = parseInt(sbIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);

        const catName = getCategoryList()[cIdx];
        const courseName = getCoursesForCategory(catName)[sIdx];
        const yearName = yPart === "n" ? null : getYearsForCourse(catName, courseName)[parseInt(yPart, 10)];
        const semName = getSemestersForCourse(catName, courseName, yearName)[semIdx];
        const studyType = ALLOWED_STUDY_TYPES[tIdx];
        const periodKey = buildPeriodStorageKey(yearName, semName);

        const bucket = getSubjectBucket(catName, courseName, periodKey, studyType, false);
        const subjectName = bucket ? Object.keys(bucket.subjects)[sbIdx] : "";
        const unitName = subjectName ? Object.keys(bucket.subjects[subjectName].units || {})[uIdx] : "";
        const unitRec = unitName ? bucket.subjects[subjectName].units[unitName] : null;

        await deletePrevMessage();
        const pyqView = renderPyqSetMessage(unitRec, pyqType, parseInt(setIdxStr, 10), subjectName, unitName, navSuffix);
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: pyqView.text,
          parse_mode: "HTML",
          reply_markup: pyqView.reply_markup
        });
      }
      else if (data.startsWith("mockans_")) {
        const [, qIdxStr, chosenOption] = data.split("_");
        const qIdx = parseInt(qIdxStr, 10);
        const session = user.activeMockSession;

        if (!session || !Array.isArray(session.questions) || qIdx !== session.currentIndex) {
          await deletePrevMessage();
          return;
        }

        const currentQ = session.questions[qIdx];
        let feedbackLine = "";

        if (chosenOption === "E") {
          session.skippedCount += 1;
          feedbackLine = `⏭️ <b>Question ${qIdx + 1} Chhod Diya (Skipped)</b> | Sahi Uttar: <b>${escapeHtml(currentQ.correctOption)}</b>`;
        } else if (chosenOption === currentQ.correctOption) {
          session.correctCount += 1;
          feedbackLine = `✅ <b>Sahi Uttar (${escapeHtml(chosenOption)})!</b>`;
        } else {
          session.wrongCount += 1;
          feedbackLine = `❌ <b>Galat Uttar (${escapeHtml(chosenOption)})!</b> Sahi Uttar: <b>${escapeHtml(currentQ.correctOption)}</b>`;
        }

        session.currentIndex += 1;
        await deletePrevMessage();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: feedbackLine,
          parse_mode: "HTML"
        });

        if (session.currentIndex >= session.questions.length) {
          const summary = renderMockSummaryMessage(session);
          user.activeMockSession = null;
          persistAll();

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: summary.text,
            parse_mode: "HTML",
            reply_markup: summary.reply_markup
          });
        } else {
          persistAll();
          const nextView = renderMockQuestionMessage(session);
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: nextView.text,
            parse_mode: "HTML",
            reply_markup: nextView.reply_markup
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