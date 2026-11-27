<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Study Hub — Syllabus, Notes, PYQ, Mock Test & Lectures</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --card-2: #162033;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-2: #22c55e;
      --danger: #ef4444;
      --border: #334155;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }

    body {
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 16px;
    }

    .container {
      max-width: 980px;
      margin: 0 auto;
    }

    header {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
    }

    header h1 {
      font-size: 1.35rem;
    }

    header p {
      color: var(--muted);
      font-size: 0.9rem;
      margin-top: 4px;
    }

    .badge {
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.35);
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .tabs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 6px;
      margin-bottom: 16px;
    }

    .tab-btn {
      background: var(--card);
      color: var(--muted);
      border: 1px solid var(--border);
      padding: 10px 16px;
      border-radius: 10px;
      cursor: pointer;
      font-weight: 600;
      white-space: nowrap;
      transition: 0.15s;
    }

    .tab-btn.active {
      background: var(--accent);
      color: #062030;
      border-color: var(--accent);
    }

    .panel {
      display: none;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
    }

    .panel.active {
      display: block;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 16px;
    }

    input, select, textarea, button {
      border-radius: 10px;
      border: 1px solid var(--border);
      padding: 10px 12px;
      font-size: 0.95rem;
    }

    input, select, textarea {
      background: var(--card-2);
      color: var(--text);
      width: 100%;
    }

    .toolbar input, .toolbar select {
      width: auto;
      min-width: 180px;
      flex: 1;
    }

    .btn {
      background: var(--accent);
      color: #062030;
      font-weight: 700;
      cursor: pointer;
      border: none;
    }

    .btn.secondary {
      background: var(--card-2);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .btn.success {
      background: var(--accent-2);
      color: #052e16;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
      gap: 14px;
    }

    .item-card {
      background: var(--card-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .meta {
      font-size: 0.8rem;
      color: var(--muted);
    }

    .syllabus-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--card-2);
      border: 1px solid var(--border);
      padding: 12px 14px;
      border-radius: 10px;
      margin-bottom: 10px;
    }

    .syllabus-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .syllabus-left input[type="checkbox"] {
      width: 18px;
      height: 18px;
      accent-color: var(--accent-2);
      cursor: pointer;
    }

    .progress-bar {
      width: 100%;
      height: 10px;
      background: var(--card-2);
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 16px;
      border: 1px solid var(--border);
    }

    .progress-fill {
      height: 100%;
      background: var(--accent-2);
      width: 0%;
      transition: width 0.25s ease;
    }

    .option-btn {
      display: block;
      width: 100%;
      text-align: left;
      background: var(--card-2);
      color: var(--text);
      margin-top: 8px;
      cursor: pointer;
    }

    .option-btn.correct {
      border-color: var(--accent-2);
      background: rgba(34, 197, 94, 0.18);
    }

    .option-btn.wrong {
      border-color: var(--danger);
      background: rgba(239, 68, 68, 0.18);
    }

    .solution-box {
      margin-top: 10px;
      padding: 10px;
      border-radius: 8px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.3);
      font-size: 0.9rem;
      display: none;
    }

    .add-box {
      background: var(--card-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 16px;
      display: grid;
      gap: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Study Hub Portal</h1>
        <p>Syllabus, Notes, PYQs, Mock Tests & Video Lectures</p>
      </div>
      <div class="badge" id="overallProgressBadge">Syllabus: 0% Complete</div>
    </header>

    <div class="tabs">
      <button class="tab-btn active" data-tab="syllabus">Syllabus</button>
      <button class="tab-btn" data-tab="notes">Notes</button>
      <button class="tab-btn" data-tab="pyq">PYQs</button>
      <button class="tab-btn" data-tab="mock">Mock Test</button>
      <button class="tab-btn" data-tab="lectures">Lectures</button>
    </div>

    <!-- 1. SYLLABUS -->
    <section id="syllabus" class="panel active">
      <div class="progress-bar">
        <div class="progress-fill" id="syllabusBar"></div>
      </div>
      <div class="add-box">
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <input id="sylSubject" placeholder="Subject (e.g. Physics)" style="flex:1; min-width:160px;" />
          <input id="sylTopic" placeholder="Topic / Chapter name" style="flex:2; min-width:200px;" />
          <button class="btn" onclick="addSyllabusItem()">+ Add Topic</button>
        </div>
      </div>
      <div id="syllabusList"></div>
    </section>

    <!-- 2. NOTES -->
    <section id="notes" class="panel">
      <div class="toolbar">
        <input id="noteSearch" placeholder="Search notes..." oninput="renderNotes()" />
        <button class="btn" onclick="toggleNoteForm()">+ New Note</button>
      </div>

      <div id="noteForm" class="add-box" style="display:none;">
        <input id="noteTitle" placeholder="Note title" />
        <input id="noteSubject" placeholder="Subject / Tag" />
        <textarea id="noteContent" rows="4" placeholder="Write concise study notes here..."></textarea>
        <button class="btn success" onclick="saveNote()">Save Note</button>
      </div>

      <div class="grid" id="notesGrid"></div>
    </section>

    <!-- 3. PYQ -->
    <section id="pyq" class="panel">
      <div class="toolbar">
        <select id="pyqYearFilter" onchange="renderPyqs()">
          <option value="ALL">All Years</option>
          <option value="2025">2025</option>
          <option value="2024">2024</option>
          <option value="2023">2023</option>
        </select>
        <select id="pyqSubjectFilter" onchange="renderPyqs()">
          <option value="ALL">All Subjects</option>
          <option value="General">General</option>
          <option value="Core">Core</option>
          <option value="Reasoning">Reasoning</option>
        </select>
      </div>
      <div id="pyqList"></div>
    </section>

    <!-- 4. MOCK TEST -->
    <section id="mock" class="panel">
      <div class="toolbar" style="justify-content:space-between; align-items:center;">
        <div class="badge" id="mockScoreBadge">Score: 0 / 0</div>
        <button class="btn secondary" onclick="resetMockTest()">Restart Test</button>
      </div>
      <div id="mockContainer"></div>
    </section>

    <!-- 5. LECTURES -->
    <section id="lectures" class="panel">
      <div class="toolbar">
        <input id="lectureSearch" placeholder="Search lecture or topic..." oninput="renderLectures()" />
      </div>
      <div class="grid" id="lecturesGrid"></div>
    </section>
  </div>
  <script>
    const STORAGE_KEY = "study_hub_data_v1";

    const defaultData = {
      syllabus: [
        { id: 1, subject: "Fundamentals", topic: "Core Concepts & Terminology", done: true },
        { id: 2, subject: "Fundamentals", topic: "Problem Solving Frameworks", done: false },
        { id: 3, subject: "Applied", topic: "Case Studies & Real Scenarios", done: false },
        { id: 4, subject: "Revision", topic: "Formula & Concept Summary Sheet", done: false }
      ],
      notes: [
        {
          id: 1,
          title: "Key Revision Checklist",
          subject: "General",
          content: "Review high-weightage topics first, solve timed PYQs daily, and maintain an error log for mock tests."
        },
        {
          id: 2,
          title: "Exam Strategy Notes",
          subject: "Strategy",
          content: "Attempt high-accuracy questions in Round 1, mark doubtful ones for Round 2, and avoid blind guessing."
        }
      ],
      pyqs: [
        {
          id: 1,
          year: "2025",
          subject: "Core",
          question: "Which approach best minimizes careless mistakes during timed practice?",
          solution: "Reading all options before selecting and re-checking units/conditions in the last 10 seconds."
        },
        {
          id: 2,
          year: "2024",
          subject: "Reasoning",
          question: "If all A are B and some B are C, does it necessarily follow that some A are C?",
          solution: "No. 'Some B are C' does not guarantee overlap with the subset A."
        },
        {
          id: 3,
          year: "2023",
          subject: "General",
          question: "What is the primary purpose of analyzing mock test wrong answers?",
          solution: "Identifying whether an error came from a concept gap, misreading, or time pressure."
        }
      ],
      mockQuestions: [
        {
          q: "1. What should be your first step when starting a new chapter?",
          options: ["Jump straight to hard questions", "Check syllabus & core concepts", "Skip notes completely", "Memorize without understanding"],
          answer: 1,
          explain: "Checking the syllabus and building core concepts gives structure before practice."
        },
        {
          q: "2. How do PYQs help most in exam preparation?",
          options: ["They replace all study material", "They show question patterns & difficulty level", "They guarantee exact repeat questions", "They are only useful in the last hour"],
          answer: 1,
          explain: "PYQs clarify exam patterns, recurring themes, and expected depth."
        },
        {
          q: "3. After completing a mock test, what is most effective?",
          options: ["Ignore the score", "Review every mistake and note the reason", "Take 5 more tests back-to-back without review", "Delete previous attempts"],
          answer: 1,
          explain: "Post-test review turns mistakes into permanent improvements."
        }
      ],
      lectures: [
        {
          id: 1,
          title: "Lecture 01: Complete Roadmap & Syllabus Breakdown",
          instructor: "Faculty Team",
          duration: "28 mins",
          url: "https://example.com/lecture-1",
          watched: false
        },
        {
          id: 2,
          title: "Lecture 02: High-Yield Concepts & PYQ Walkthrough",
          instructor: "Faculty Team",
          duration: "42 mins",
          url: "https://example.com/lecture-2",
          watched: false
        }
      ]
    };

    let state = loadState();
    let mockAnswers = {};

    function loadState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...defaultData, ...JSON.parse(raw) } : structuredClone(defaultData);
      } catch {
        return structuredClone(defaultData);
      }
    }

    function saveState() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      updateSyllabusProgress();
    }

    // Tabs
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active");
      });
    });

    // Syllabus
    function updateSyllabusProgress() {
      const total = state.syllabus.length;
      const done = state.syllabus.filter((x) => x.done).length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      document.getElementById("syllabusBar").style.width = pct + "%";
      document.getElementById("overallProgressBadge").textContent = `Syllabus: ${pct}% Complete (${done}/${total})`;
    }

    function addSyllabusItem() {
      const subject = document.getElementById("sylSubject").value.trim() || "General";
      const topic = document.getElementById("sylTopic").value.trim();
      if (!topic) return;
      state.syllabus.push({ id: Date.now(), subject, topic, done: false });
      document.getElementById("sylTopic").value = "";
      saveState();
      renderSyllabus();
    }

    function toggleSyllabusItem(id) {
      const item = state.syllabus.find((x) => x.id === id);
      if (item) {
        item.done = !item.done;
        saveState();
        renderSyllabus();
      }
    }

    function renderSyllabus() {
      const el = document.getElementById("syllabusList");
      el.innerHTML = state.syllabus
        .map(
          (item) => `
          <div class="syllabus-row">
            <div class="syllabus-left">
              <input type="checkbox" ${item.done ? "checked" : ""} onchange="toggleSyllabusItem(${item.id})" />
              <div>
                <div style="font-weight:600; ${item.done ? "text-decoration:line-through; opacity:0.7;" : ""}">${escapeHtml(item.topic)}</div>
                <div class="meta">${escapeHtml(item.subject)}</div>
              </div>
            </div>
            <span class="meta">${item.done ? "Completed" : "Pending"}</span>
          </div>`
        )
        .join("");
      updateSyllabusProgress();
    }

    // Notes
    function toggleNoteForm() {
      const form = document.getElementById("noteForm");
      form.style.display = form.style.display === "none" ? "grid" : "none";
    }

    function saveNote() {
      const title = document.getElementById("noteTitle").value.trim();
      const subject = document.getElementById("noteSubject").value.trim() || "General";
      const content = document.getElementById("noteContent").value.trim();
      if (!title || !content) return;
      state.notes.unshift({ id: Date.now(), title, subject, content });
      document.getElementById("noteTitle").value = "";
      document.getElementById("noteContent").value = "";
      toggleNoteForm();
      saveState();
      renderNotes();
    }

    function renderNotes() {
      const q = (document.getElementById("noteSearch").value || "").toLowerCase();
      const filtered = state.notes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.subject.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q)
      );
      document.getElementById("notesGrid").innerHTML = filtered
        .map(
          (n) => `
          <div class="item-card">
            <div class="meta">${escapeHtml(n.subject)}</div>
            <h3>${escapeHtml(n.title)}</h3>
            <p style="color:#cbd5e1; font-size:0.92rem; line-height:1.45;">${escapeHtml(n.content)}</p>
          </div>`
        )
        .join("");
    }

    // PYQ
    function renderPyqs() {
      const year = document.getElementById("pyqYearFilter").value;
      const subj = document.getElementById("pyqSubjectFilter").value;
      const list = state.pyqs.filter(
        (p) => (year === "ALL" || p.year === year) && (subj === "ALL" || p.subject === subj)
      );
      document.getElementById("pyqList").innerHTML = list
        .map(
          (p) => `
          <div class="item-card" style="margin-bottom:12px;">
            <div class="meta">Year: ${escapeHtml(p.year)} • Subject: ${escapeHtml(p.subject)}</div>
            <div style="font-weight:600;">${escapeHtml(p.question)}</div>
            <div>
              <button class="btn secondary" onclick="toggleSol('sol-${p.id}')">Show / Hide Solution</button>
            </div>
            <div id="sol-${p.id}" class="solution-box">${escapeHtml(p.solution)}</div>
          </div>`
        )
        .join("");
    }

    function toggleSol(id) {
      const box = document.getElementById(id);
      box.style.display = box.style.display === "block" ? "none" : "block";
    }

    // Mock Test
    function selectOption(qIdx, optIdx) {
      mockAnswers[qIdx] = optIdx;
      renderMockTest();
    }

    function resetMockTest() {
      mockAnswers = {};
      renderMockTest();
    }

    function renderMockTest() {
      let score = 0;
      state.mockQuestions.forEach((item, idx) => {
        if (mockAnswers[idx] === item.answer) score++;
      });
      document.getElementById("mockScoreBadge").textContent =
        `Score: ${score} / ${state.mockQuestions.length}`;

      document.getElementById("mockContainer").innerHTML = state.mockQuestions
        .map((item, qIdx) => {
          const picked = mockAnswers[qIdx];
          const answered = picked !== undefined;
          return `
            <div class="item-card" style="margin-bottom:14px;">
              <div style="font-weight:600;">${escapeHtml(item.q)}</div>
              ${item.options
                .map((opt, oIdx) => {
                  let cls = "option-btn";
                  if (answered) {
                    if (oIdx === item.answer) cls += " correct";
                    else if (oIdx === picked) cls += " wrong";
                  }
                  return `<button class="${cls}" onclick="selectOption(${qIdx}, ${oIdx})">${escapeHtml(opt)}</button>`;
                })
                .join("")}
              ${
                answered
                  ? `<div class="solution-box" style="display:block;"><strong>Explanation:</strong> ${escapeHtml(item.explain)}</div>`
                  : ""
              }
            </div>`;
        })
        .join("");
    }

    // Lectures
    function toggleLectureWatched(id) {
      const lec = state.lectures.find((l) => l.id === id);
      if (lec) {
        lec.watched = !lec.watched;
        saveState();
        renderLectures();
      }
    }

    function renderLectures() {
      const q = (document.getElementById("lectureSearch").value || "").toLowerCase();
      const filtered = state.lectures.filter(
        (l) => l.title.toLowerCase().includes(q) || l.instructor.toLowerCase().includes(q)
      );
      document.getElementById("lecturesGrid").innerHTML = filtered
        .map(
          (l) => `
          <div class="item-card">
            <div class="meta">${escapeHtml(l.instructor)} • ${escapeHtml(l.duration)}</div>
            <h3>${escapeHtml(l.title)}</h3>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:auto;">
              <a href="${escapeAttr(l.url)}" target="_blank" rel="noopener" class="btn" style="text-decoration:none;">Open Lecture</a>
              <button class="btn secondary" onclick="toggleLectureWatched(${l.id})">${l.watched ? "Watched ✓" : "Mark Watched"}</button>
            </div>
          </div>`
        )
        .join("");
    }

    function escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, (m) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[m]));
    }

    function escapeAttr(str) {
      const s = String(str).trim();
      return /^https?:\/\//i.test(s) ? escapeHtml(s) : "#";
    }

    renderSyllabus();
    renderNotes();
    renderPyqs();
    renderMockTest();
    renderLectures();
  </script>
</body>
</html>
