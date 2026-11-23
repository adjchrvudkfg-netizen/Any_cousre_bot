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
  "CET": ["CET 12th Level", "CET Graduation Level"],
  "12th": ["Science", "Commerce", "Arts"],
  "SSC": ["SSC GD", "SSC CHSL", "SSC CGL", "SSC MTS"],
  "Railway": ["RRB NTPC", "RRB Group D", "RRB ALP", "RRB JE"],
  "Air Force": ["Group X (Science)", "Group Y (Non-Tech)", "Agniveer Vayu"],
  "Army": ["Agniveer GD", "Agniveer Technical", "Nursing Assistant", "Clerk / SKT"],
  "Navy": ["Agniveer SSR", "Agniveer MR"]
};

const CATEGORY_LIST = Object.keys(CATEGORIES);

module.exports = {
  ALLOWED_STUDY_TYPES,
  MAIN_MENU_BUTTONS,
  CATEGORIES,
  CATEGORY_LIST
};
