const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.log("⚠️ 'pdf-parse' module not installed; PDF text extraction will use fallback/manual notes.");
}

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
  "Commerce": ["B.Com"],
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

            if (
              text.includes("Syllabus") ||
              text.includes("Hand Written Notes") ||
              text.includes("Year") ||
              text.includes("Semester")
            ) {
              style = "primary";
            } else if (text.includes("Back") || text.includes("Main Menu")) {
              style = "danger";
            } else if (callback.startsWith("yr_") || callback.startsWith("sem_") || callback.startsWith("subj_")) {
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
      if (parsed.uploadedPdfs) studyDb.uploadedPdfs = parsed.uploadedPdfs;
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
    ? `${category}::${course}::${yearName}` : `${category}::${course}`;  let baseSems = []; if (yearName && DEFAULT_SEMESTERS_BY_YEAR[course] && DEFAULT_SEMESTERS_BY_YEAR[course][yearName]) { baseSems = [...DEFAULT_SEMESTERS_BY_YEAR[course][yearName]]; } else if (!yearName && DEFAULT_DIRECT_SEMESTERS_BY_COURSE[course]) { baseSems = [...DEFAULT_DIRECT_SEMESTERS_BY_COURSE[course]]; } else if (!yearName && !DEFAULT_YEARS_BY_COURSE[course]) { baseSems = ["Semester 1", "Semester 2"]; }  const extraSems = studyDb.customSemesters[key] \vert{}\vert{} []; const merged = [...baseSems];  if (!yearName && studyDb.materials[category] && studyDb.materials[category][course]) { for (const semKey of Object.keys(studyDb.materials[category][course])) { if (!semKey.includes(" > ") && !merged.includes(semKey)) { merged.push(semKey); } } } else if (yearName && studyDb.materials[category] && studyDb.materials[category][course]) { const prefix = `${yearName} > `;
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
  return yearName ? `${yearName} >${semesterName}` : semesterName;
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
      pyqQuestions: [],
      mcqQuestions: [],
      mockQuestions: [],
      revisionNotes: ""
    };
  }
  return bucket.subjects[subjectName].units[unitName];
}

function detectLanguage(text) {
  if (/[\u0900-\u097F]/.test(text)) {
    return "hindi";
  }
  const lower = text.toLowerCase();
  const hinglishWords = [
    "kya", "hai", "hain", "kaise", "kese", "kaun", "kon", "aur", "me", "mein",
    "se", "ko", "ki", "ke", "ka", "likhna", "samjha", "batao", "bataiye",
    "dhoondh", "dhundh", "wala", "wali", "wale", "karna", "karein", "chahiye",
    "hota", "hoti", "hote", "ban", "sakte", "gaye", "hue", "hui", "puchha"
  ];
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const matchCount = tokens.filter((w) => hinglishWords.includes(w)).length;
  if (matchCount >= 1) {
    return "hinglish";
  }
  return "english";
}

function escapeMarkdownText(str) {
  return String(str || "").replace(/([_*`\[])/g, "\\$1");
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

function buildHandwrittenMessages(rawText, title, lang) {
  const rawLines = (rawText || "").split(/\r?\n/);
  const cleanedLines = rawLines.map(cleanPdfLine).filter(Boolean);

  const titleParts = String(title || "").split("—");
  const unitPart = titleParts.length > 1 ? titleParts.slice(1).join("—").trim() : String(title || "").trim();
  const unitMatch = unitPart.match(/^(unit\s*\d+)\s*[-–—:]\s*(.+)$/i);

  const unitLabel = unitMatch
    ? `${escapeMarkdownText(unitMatch[1].replace(/\b\w/g, (c) => c.toUpperCase()))}: *${escapeMarkdownText(unitMatch[2].trim())}*`
    : `*${escapeMarkdownText(unitPart)}*`;

  if (cleanedLines.length === 0) {
    const emptyMsg =
      lang === "hindi"
        ? `📌 ${unitLabel}\n\n✍️ *हस्तलिखित नोट्स:*\n  • अभी इस इकाई के नोट्स उपलब्ध नहीं हैं।`
        : lang === "english"
          ? `📌 ${unitLabel}\n\n✍️ *Handwritten Notes:*\n  • Notes for this unit are currently being updated.`
          : `📌 ${unitLabel}\n\n✍️ *Hand Written Notes:*\n  • Is unit ke notes abhi update kiye ja rahe hain.`;
    return [emptyMsg];
  }

  const formattedBodyLines = [];
  for (const line of cleanedLines) {
    const safeLine = escapeMarkdownText(line);
    if (isLikelyHeading(line)) {
      const cleanHeading = safeLine.replace(/:$/, "");
      formattedBodyLines.push(`\n*📌 ${cleanHeading}*`);
    } else if (isSubPoint(line)) {
      const strippedPoint = safeLine
        .replace(/^(\d+[\).\s-]|[a-dA-D]\)\s*|[-–•●▪◦]\s*)+/, "")
        .trim();
      formattedBodyLines.push(`  ✍️ • ${strippedPoint || safeLine}`);
    } else {
      formattedBodyLines.push(`  ✍️ ${safeLine}`);
    }
  }

  const header =
    lang === "hindi"
      ? `📚 ${unitLabel}\n──────────────────────\n✍️ *हस्तलिखित नोट्स (PDF अनुसार)*\n`
      : lang === "english"
        ? `📚 ${unitLabel}\n──────────────────────\n✍️ *Handwritten Notes (As per PDF)*\n`
        : `📚 ${unitLabel}\n──────────────────────\n✍️ *Hand Written Notes (PDF Ke Hisaab Se)*\n`;

  const footer =
    lang === "hindi"
      ? `\n──────────────────────\n📝 *परीक्षा टिप:* मुख्य हेडिंग, परिभाषा और बिंदु साफ-सुथरे ढंग से लिखें।`
      : lang === "english"
        ? `\n──────────────────────\n📝 *Exam Tip:* Write clear headings, definitions, and structured points.`
        : `\n──────────────────────\n📝 *Exam Tip:* Main headings, definitions, aur points saaf tarike se likhein.`;

  const maxChunkLen = 3350;
  const chunks = [];
  let current = header;

  for (const entry of formattedBodyLines) {
    const block = `${entry}\n`;
    if ((current + block).length > maxChunkLen) {
      chunks.push(`${current.trimEnd()}${footer}`);
      current = `${header}${block}`;
    } else {
      current += block;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(`${current.trimEnd()}${footer}`);
  }

  return chunks;
}

function buildHandwrittenPreview(rawText, title, lang) {
  const msgs = buildHandwrittenMessages(rawText, title, lang);
  return msgs[0];
}

function searchAdminPdfsForQuery(query) {
  const qLower = (query || "").toLowerCase();
  const keywords = qLower
    .split(/[^a-z0-9\u0900-\u097F]+/i)
    .filter((w) => w.length >= 2);

  const matches = [];
  for (const pdf of studyDb.uploadedPdfs || []) {
    const text = pdf.extractedText || "";
    const textLower = text.toLowerCase();
    const metaStr = `${pdf.category || ""} ${pdf.course || ""} ${pdf.periodKey || ""} ${pdf.subjectName || ""} ${pdf.unitName || ""} ${pdf.title || ""}`.toLowerCase();

    let score = 0;
    if (qLower.length >= 3 && textLower.includes(qLower)) score += 10;
    if (qLower.length >= 3 && metaStr.includes(qLower)) score += 8;

    const matchedLines = [];
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    for (const kw of keywords) {
      if (textLower.includes(kw)) score += 2;
      if (metaStr.includes(kw)) score += 2;
    }

    for (const line of lines) {
      const lLower = line.toLowerCase();
      if (keywords.some((kw) => lLower.includes(kw))) {
        matchedLines.push(line);
      }
      if (matchedLines.length >= 10) break;
    }

    if (score > 0 || matchedLines.length > 0) {
      matches.push({
        pdf,
        score,
        excerpt: matchedLines.join("\n") || lines.slice(0, 8).join("\n")
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches;
}

function collectStoredQuestionsForQuery(query) {
  const qLower = (query || "").toLowerCase();
  const keywords = qLower
    .split(/[^a-z0-9\u0900-\u097F]+/i)
    .filter((w) => w.length >= 2);

  const pyqs = [];
  const mocks = [];

  const traverse = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj.pyqQuestions)) {
      for (const item of obj.pyqQuestions) {
        const s = String(item);
        if (!keywords.length || keywords.some((k) => s.toLowerCase().includes(k)) || s.toLowerCase().includes(qLower)) {
          pyqs.push(s);
        }
      }
    }
    if (Array.isArray(obj.mockQuestions)) {
      for (const item of obj.mockQuestions) {
        const s = String(item);
        if (!keywords.length || keywords.some((k) => s.toLowerCase().includes(k)) || s.toLowerCase().includes(qLower)) {
          mocks.push(s);
        }
      }
    }
    for (const val of Object.values(obj)) {
      if (val && typeof val === "object") traverse(val);
    }
  };

  traverse(studyDb.materials);
  return { pyqs, mocks };
}

function buildSmartAiAssistantResponse(query) {
  const lang = detectLanguage(query);
  const matches = searchAdminPdfsForQuery(query);
  const { pyqs, mocks } = collectStoredQuestionsForQuery(query);
  const bestMatch = matches[0] || null;

  const sourceLabel = bestMatch
    ? `${bestMatch.pdf.title} (${bestMatch.pdf.subjectName || bestMatch.pdf.course || "Admin PDF"})`
    : (studyDb.uploadedPdfs.length > 0 ? "Admin Uploaded PDFs" : "General Study Knowledge");

  const handwrittenSnippet = bestMatch
    ? buildHandwrittenPreview(bestMatch.excerpt, `${query} — ${sourceLabel}`, lang)
    : buildHandwrittenPreview(
        `Topic "${query}" ke main concepts ko points mein samjhein.\nKey definitions, classification/steps, aur examples par focus karein.`,
        query,
        lang
      );

  const pyqSectionText = pyqs.length > 0
    ? pyqs.slice(0, 6).map((q, i) => `  • PYQ ${i + 1}: ${q}`).join("\n")
    : (lang === "hindi"
        ? "  • अभी इस विषय के लिए सहेजे गए PYQ प्रश्न नहीं मिले।"
        : lang === "english"
          ? "  • No saved PYQ questions found for this exact topic yet."
          : "  • Is topic ke liye abhi saved PYQ questions nahi mile.");

  const mockSectionText = mocks.length > 0
    ? mocks.slice(0, 5).map((q, i) => `  • Mock ${i + 1}: ${q}`).join("\n")
    : (lang === "hindi"
        ? `  • संभावित प्रश्न: "${query}" की परिभाषा, मुख्य प्रकार/विशेषताएँ और उपयोग लिखिए।`
        : lang === "english"
          ? `  • Practice Question: Define "${query}", explain its key types/features, and give examples.`
          : `  • Practice Question: "${query}" ki definition, main types/features, aur examples likhein.`);

  if (lang === "hindi") {
    return (
`🤖 *AI सहायक — हस्तलिखित शैली उत्तर*
🔎 *खोजा गया विषय:* *${query}*
📂 *स्रोत (PDFs में से):* ${sourceLabel} (कुल PDFs: ${studyDb.uploadedPdfs.length})

${handwrittenSnippet}

❓ *इस विषय से किस-किस प्रकार के प्रश्न बन सकते हैं:*
  • *Short Answer (2–3 अंक):* परिभाषा, महत्व या संक्षिप्त अंतर।
  • *Long / Descriptive Answer (5–10 अंक):* पूरा विवरण, वर्गीकरण, कार्यप्रणाली या चरण।
  • *Application / Case / MCQ:* व्यावहारिक उपयोग, उदाहरण और सही विकल्प चुनने वाले प्रश्न।

📌 *पहले से बने हुए प्रश्न (PYQ / Mock):*
${pyqSectionText}
${mockSectionText}

✍️ *उत्तर कैसे लिखना चाहिए:*
  1. *परिभाषा / परिचय:* 2–3 स्पष्ट पंक्तियों में शुरुआत करें।
  2. *मुख्य बिंदु / वर्गीकरण:* बुलेट या हेडिंग के साथ व्यवस्थित बिंदु लिखें।
  3. *उदाहरण / रेखाचित्र:* जहाँ संभव हो वहाँ उदाहरण या सरल डायग्राम बनाएँ।
  4. *निष्कर्ष:* अंत में 1–2 पंक्तियों में सारांश लिखें।`
    );
  }

  if (lang === "english") {
    return (
`🤖 *AI Assistant — Handwritten Study Response*
🔎 *Topic Queried:* *${query}*
📂 *Source (From Admin PDFs):* ${sourceLabel} (Total PDFs: ${studyDb.uploadedPdfs.length})

${handwrittenSnippet}

❓ *Types of Questions That Can Be Asked:*
  • *Short Answer (2–3 Marks):* Definitions, core terms, or concise differences.
  • *Long / Structured Answer (5–10 Marks):* Detailed explanation, classification, mechanisms, or steps.
  • *MCQs & Case/Application Questions:* Concept checks, real-world scenarios, and exceptions.

📌 *Questions Already Available (PYQ / Mock):*
${pyqSectionText}
${mockSectionText}

✍️ *How to Write the Answer in Exams:*
  1. *Definition / Intro:* Start with a clear, concise definition.
  2. *Structured Points / Classification:* Use headings or bullet points with key terms.
  3. *Examples / Diagrams:* Add examples or a simple flow/diagram where helpful.
  4. *Summary:* Conclude with a brief wrap-up line.`
    );
  }

  return (
`🤖 *AI Assistant — Hand Written Style Explanation*
🔎 *Topic:* *${query}*
📂 *PDF Search Source:* ${sourceLabel} (Total Admin PDFs: ${studyDb.uploadedPdfs.length})

${handwrittenSnippet}

❓ *Kis-Kis Type Ke Questions Ban Sakte Hain:*
  • *Short Questions (2–3 Marks):* Definition, key points, ya short difference.
  • *Long Questions (5–10 Marks):* Complete explanation, classification, process/mechanism, ya examples.
  • *MCQ & Application Questions:* Concept-based MCQs ya practical/case scenarios.

📌 *Kaun-Kaun Se Questions Ban Chuke Hain (PYQ / Mock):*
${pyqSectionText}
${mockSectionText}

✍️ *Answer Kaise Likhna Hai:*
  1. *Introduction / Definition:* Pehle 2–3 line mein clear definition likhein.
  2. *Main Points / Classification:* Headings aur bullet points mein neat points likhein.
  3. *Examples / Flow Diagram:* Jahan zaroorat ho wahan example ya simple diagram banayein.
  4. *Conclusion:* Last mein 1–2 line mein short summary likhein.`
  );
}

function getMainMenuMarkup(user) {
  const roleLabel = isAdmin(user.id) ? "Admin" : "Student";

  const welcomeText =
`🌸 - <b>STUDY MATERIAL BOT</b> - 🌸

👤 Hello, <code>${user.name}</code> !

📚 <b>Your Complete Study Assistant</b>

➖ 📖 <b>Syllabus</b> (Subject > Units & Topics Text)
➖ ✍️ <b>Hand Written Notes</b> (Full Notebook Style Text)
➖ 📝 <b>PYQ Question</b> (Chapter Wise Past Questions)
➖ 🧠 <b>MCQ Question</b>
➖ 🎯 <b>Mock Test</b> (Chapter Wise Practice Questions)
➖ 🤖 <b>AI Assistant</b> (PDF Search + Hinglish/English/Hindi)
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

      if (update.message.document) {
        if (!isAdmin(from.id)) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "🚫 <b>Permission Denied:</b> Sirf Admin hi PDF ya study material add kar sakta hai.",
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

        const flow = user.adminUploadFlow || {};
        let extractedText = "";

        if (pdfParse) {
          try {
            const fileInfoRes = await axios.get(`${TELEGRAM_API}/getFile`, {
              params: { file_id: doc.file_id }
            });
            const filePath = fileInfoRes.data && fileInfoRes.data.result && fileInfoRes.data.result.file_path;
            if (filePath) {
              const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
              const pdfBufferRes = await axios.get(fileUrl, { responseType: "arraybuffer" });
              const parsedPdf = await pdfParse(Buffer.from(pdfBufferRes.data));
              extractedText = (parsedPdf.text || "").trim();
            }
          } catch (pdfErr) {
            console.log("PDF parse error:", pdfErr.message);
          }
        }

        const pdfRecord = {
          title: flow.title || doc.file_name || "Uploaded PDF",
          fileName: doc.file_name || "document.pdf",
          fileId: doc.file_id,
          category: flow.category || "Pharmacy",
          course: flow.course || "B.Pharma",
          periodKey: flow.periodKey || "1st Year > Semester 1",
          subjectName: flow.subjectName || "",
          unitName: flow.unitName || "",
          extractedText,
          addedBy: from.id,
          addedAt: new Date().toISOString()
        };

        studyDb.uploadedPdfs.push(pdfRecord);

        if (flow.category && flow.course && flow.periodKey && flow.subjectName && flow.unitName) {
          const unitRec = ensureUnitRecord(
            flow.category,
            flow.course,
            flow.periodKey,
            "Hand Written Notes",
            flow.subjectName,
            flow.unitName,
            true
          );
          if (extractedText) {
            unitRec.handwrittenNotes = unitRec.handwrittenNotes
              ? `${unitRec.handwrittenNotes}\n${extractedText}`
              : extractedText;
          }
        }

        user.adminUploadFlow = null;
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text:
`✅ <b>PDF Indexed for Handwritten Notes & AI Assistant!</b>

📄 <b>Title:</b> <code>${pdfRecord.title}</code>
📝 <b>Extracted Text Length:</b> ${extractedText.length} characters
📚 <b>Total Indexed PDFs:</b> ${studyDb.uploadedPdfs.length}

<i>Ab Hand Written Notes mein poori PDF ka handwritten-style text aayega aur AI Assistant isi PDF text mein se search karega.</i>`,
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
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Syllabus Topics Added!</b>\n${course} > ${periodKey} > <b>${subjectName}</b>\nUnit: <b>${unitName}</b>\nTopics: ${unitRec.topics.join(", ")}`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/set_notes')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/set_notes', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/set_notes Category | Course | Year (or -) | Semester | Subject | Unit | Notes Text</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, subjectName, unitName, ...notesParts] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);
        const notesText = notesParts.join(" | ");

        const unitRec = ensureUnitRecord(category, course, periodKey, "Hand Written Notes", subjectName, unitName, true);
        unitRec.handwrittenNotes = notesText;
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>Hand Written Notes Saved!</b>\n${course} > ${periodKey} > <b>${subjectName}</b> > <b>${unitName}</b>`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_pyq')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/add_pyq', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_pyq Category | Course | Year (or -) | Semester | Subject | Unit | Q1; Q2</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, subjectName, unitName, ...qParts] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);
        const qList = qParts.join(" | ").split(';').map((q) => q.trim()).filter(Boolean);

        const unitRec = ensureUnitRecord(category, course, periodKey, "PYQ Question", subjectName, unitName, true);
        unitRec.pyqQuestions.push(...qList);
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>${qList.length} PYQ Question(s) Added!</b>\n${course} > ${periodKey} > <b>${subjectName}</b> > <b>${unitName}</b>`,
          parse_mode: "HTML"
        });
      }
      else if (text.startsWith('/add_mock')) {
        if (!isAdmin(from.id)) return;
        const parts = text.replace('/add_mock', '').trim().split('|').map((s) => s.trim());
        if (parts.length < 7) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Use: <code>/add_mock Category | Course | Year (or -) | Semester | Subject | Unit | Q1; Q2</code>",
            parse_mode: "HTML"
          });
          return;
        }
        const [category, course, yearRaw, semester, subjectName, unitName, ...qParts] = parts;
        const yearName = (!yearRaw || yearRaw === "-" || yearRaw.toLowerCase() === "none") ? null : yearRaw;
        const periodKey = buildPeriodStorageKey(yearName, semester);
        const qList = qParts.join(" | ").split(';').map((q) => q.trim()).filter(Boolean);

        const unitRec = ensureUnitRecord(category, course, periodKey, "Mock Test", subjectName, unitName, true);
        unitRec.mockQuestions.push(...qList);
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ <b>${qList.length} Mock Question(s) Added!</b>\n${course} > ${periodKey} > <b>${subjectName}</b> > <b>${unitName}</b>`,
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
          step: "WAITING_PDF",
          category,
          course,
          periodKey,
          subjectName,
          unitName,
          title
        };
        saveData();

        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `📎 Ab <b>${title}</b> ke liye PDF bhejein. Bot uska text extract karke Hand Written Notes aur AI Assistant mein jodega.`,
          parse_mode: "HTML"
        });
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
          saveData();
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🗑️ <b>Unit Removed:</b> <code>${unitName}</code> (${subjectName})`,
            parse_mode: "HTML"
          });
        } else {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: "⚠️ Ye unit nahi mili. Spelling/format check karein.",
            parse_mode: "HTML"
          });
        }
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
        user.selectedYear = null;
        user.selectedSemester = null;
        saveData();

        await deletePrevMessage();

        if (typeName === "AI Assistant") {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text:
`🤖 <b>AI ASSISTANT READY</b>

Kisi bhi topic ya question ke baare mein poochhein (Hinglish, English, ya Hindi mein).
Bot admin ki uploaded PDFs mein se topic dhoondh kar:
• Handwritten style notes dega
• Batayega kis-kis type ke questions ban sakte hain
• Kaun-kaun se questions ban chuke hain
• Aur answer kaise likhna hai, sab samjhayega!`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

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
      else if (data.startsWith("yr_")) {
        const [, cIdxStr, sIdxStr, yPart, semIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const courseName = CATEGORIES[catName][sIdx];
        const yearName = yPart === "n" ? null : getYearsForCourse(catName, courseName)[parseInt(yPart, 10)];
        const semName = getSemestersForCourse(catName, courseName, yearName)[semIdx];
        const studyType = user.selectedType || "Syllabus";
        const periodKey = buildPeriodStorageKey(yearName, semName);

        user.selectedCategory = catName;
        user.selectedStream = courseName;
        user.selectedYear = yearName;
        user.selectedSemester = semName;
        saveData();

        await deletePrevMessage();

        const tIdx = ALLOWED_STUDY_TYPES.indexOf(studyType);
        const bucket = getSubjectBucket(catName, courseName, periodKey, studyType, false);
        const subjects = bucket ? Object.keys(bucket.subjects) : [];

        if (subjects.length === 0) {
          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📘 <b>${courseName} > ${periodKey} — ${studyType}</b>\n\nIs semester mein abhi koi subject add nahi hua hai.`,
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
          text: `🗓️ <b>${courseName} — ${periodKey} (${studyType})</b>\n\nApna <b>Subject</b> chunein:`,
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

        const catName = CATEGORY_LIST[cIdx];
        const courseName = CATEGORIES[catName][sIdx];
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
                  ? tList.map((tp, tIndex) => `   ${tIndex + 1}. ${tp}`).join("\n")
                  : "   • (Is unit ke topics add karna baaki hai)";
                return `📂 <b>Unit ${idx + 1}: ${uName}</b>\n${topicLines}`;
              })
              .join("\n\n──────────────────────\n\n");
          }

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text:
`📖 <b>SYLLABUS — ${subjectName}</b>
🎓 <b>Course:</b> ${courseName} (${periodKey})
📊 <b>Total Units:</b> ${unitNames.length}

${syllabusBody}`,
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
            text: `📂 <b>${subjectName} — ${studyType}</b>\n\nIs subject mein abhi koi unit / chapter available nahi hai.`,
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
          text: `📘 <b>${subjectName} — ${studyType}</b>\n\nUnit / Chapter chunein:`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: unitButtons }
        });
      }
      else if (data.startsWith("sunit_")) {
        const [, cIdxStr, sIdxStr, yPart, semIdxStr, tIdxStr, sbIdxStr, uIdxStr] = data.split("_");
        const cIdx = parseInt(cIdxStr, 10);
        const sIdx = parseInt(sIdxStr, 10);
        const semIdx = parseInt(semIdxStr, 10);
        const tIdx = parseInt(tIdxStr, 10);
        const sbIdx = parseInt(sbIdxStr, 10);
        const uIdx = parseInt(uIdxStr, 10);

        const catName = CATEGORY_LIST[cIdx];
        const courseName = CATEGORIES[catName][sIdx];
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
          const lang = detectLanguage(unitName || "");
          const combinedPdfText = (studyDb.uploadedPdfs || [])
            .filter((p) =>
              (!p.subjectName || p.subjectName.toLowerCase().includes((subjectName || "").toLowerCase())) &&
              p.extractedText
            )
            .map((p) => p.extractedText)
            .join("\n");

          const sourceText =
            (unitRec && unitRec.handwrittenNotes) ||
            combinedPdfText ||
            (unitRec && (unitRec.topics || []).join("\n")) ||
            "";

          const noteMessages = buildHandwrittenMessages(sourceText, `${subjectName} — ${unitName}`, lang);

          for (let i = 0; i < noteMessages.length; i++) {
            const isLast = i === noteMessages.length - 1;
            const partLabel = noteMessages.length > 1 ? `\n📄 *Part ${i + 1} / ${noteMessages.length}*` : "";

            await axios.post(`${TELEGRAM_API}/sendMessage`, {
              chat_id: chatId,
              text: `${noteMessages[i]}${partLabel}`,
              parse_mode: "Markdown",
              reply_markup: isLast
                ? { inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]] }
                : undefined
            });
          }
          return;
        }

        if (studyType === "PYQ Question") {
          const pyqs = (unitRec && unitRec.pyqQuestions) || [];
          const body = pyqs.length > 0
            ? pyqs.map((q, i) => `${i + 1}. ${q}`).join("\n\n")
            : "Is chapter / unit mein abhi koi PYQ question add nahi hua hai.";

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `📝 <b>PYQ QUESTIONS — ${unitName}</b>\n📘 Subject: ${subjectName}\n\n${body}`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
          });
          return;
        }

        if (studyType === "Mock Test") {
          const mocks = (unitRec && unitRec.mockQuestions) || [];
          const fallbackTopics = (unitRec && unitRec.topics) || [];
          const body = mocks.length > 0
            ? mocks.map((q, i) => `Q${i + 1}. ${q}`).join("\n\n")
            : fallbackTopics.length > 0
              ? fallbackTopics.map((tp, i) => `Q${i + 1}. Explain "${tp}" with key points and examples.`).join("\n\n")
              : "Is chapter / unit mein abhi koi Mock Test question available nahi hai.";

          await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: `🎯 <b>MOCK TEST — ${unitName}</b>\n📘 Subject: ${subjectName}\n\n${body}`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Main Menu", callback_data: "main_menu" }]]
            }
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