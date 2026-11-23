const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "study_data.json");

const DEFAULT_DATA = {
  materials: {},
  links: {
    admitCards: {},
    results: {}
  }
};

function ensureStorage() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
  }
}

function loadData() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      materials: parsed.materials || {},
      links: {
        admitCards: (parsed.links && parsed.links.admitCards) || {},
        results: (parsed.links && parsed.links.results) || {}
      }
    };
  } catch (err) {
    console.error("Error reading study_data.json:", err);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getBucket(data, category, stream, studyType, createIfMissing = false) {
  const key = `${category}::${stream}::${studyType}`;
  if (!data.materials[key]) {
    if (!createIfMissing) return null;
    data.materials[key] = { units: {} };
  }
  if (!data.materials[key].units) {
    data.materials[key].units = {};
  }
  return data.materials[key];
}

function addUnit(category, stream, studyType, unitName, adminId) {
  const data = loadData();
  const bucket = getBucket(data, category, stream, studyType, true);
  if (!bucket.units[unitName]) {
    bucket.units[unitName] = {
      chapters: {},
      createdBy: adminId,
      createdAt: new Date().toISOString()
    };
  }
  saveData(data);
  return data;
}

function addChapter(category, stream, studyType, unitName, chapterName, adminId) {
  const data = loadData();
  const bucket = getBucket(data, category, stream, studyType, true);
  if (!bucket.units[unitName]) {
    bucket.units[unitName] = {
      chapters: {},
      createdBy: adminId,
      createdAt: new Date().toISOString()
    };
  }
  if (!bucket.units[unitName].chapters[chapterName]) {
    bucket.units[unitName].chapters[chapterName] = [];
  }
  saveData(data);
  return data;
}

function addPdfToChapter(category, stream, studyType, unitName, chapterName, pdfItem) {
  const data = loadData();
  const bucket = getBucket(data, category, stream, studyType, true);
  if (!bucket.units[unitName]) {
    bucket.units[unitName] = { chapters: {} };
  }
  if (!bucket.units[unitName].chapters[chapterName]) {
    bucket.units[unitName].chapters[chapterName] = [];
  }
  bucket.units[unitName].chapters[chapterName].push(pdfItem);
  saveData(data);
  return data;
}

function setPortalLink(type, category, stream, label, url, adminId) {
  const data = loadData();
  const key = `${category}::${stream}`;
  const target = type === "admit" ? data.links.admitCards : data.links.results;
  if (!target[key]) {
    target[key] = [];
  }
  target[key].push({
    label,
    url,
    addedBy: adminId,
    addedAt: new Date().toISOString()
  });
  saveData(data);
}

module.exports = {
  loadData,
  saveData,
  getBucket,
  addUnit,
  addChapter,
  addPdfToChapter,
  setPortalLink
};
