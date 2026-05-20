#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const MONTHS = [
  ["januar", 1],
  ["februar", 2],
  ["marts", 3],
  ["april", 4],
  ["maj", 5],
  ["juni", 6],
  ["juli", 7],
  ["august", 8],
  ["september", 9],
  ["oktober", 10],
  ["november", 11],
  ["december", 12]
];

const WEEKDAYS = new Map([
  ["mandag", "Mandag"],
  ["tirsdag", "Tirsdag"],
  ["onsdag", "Onsdag"],
  ["torsdag", "Torsdag"],
  ["fredag", "Fredag"],
  ["loerdag", "Lørdag"],
  ["lordag", "Lørdag"],
  ["soendag", "Søndag"],
  ["sondag", "Søndag"],
  ["ma", "Mandag"],
  ["ti", "Tirsdag"],
  ["on", "Onsdag"],
  ["to", "Torsdag"],
  ["fr", "Fredag"],
  ["loe", "Lørdag"],
  ["lo", "Lørdag"],
  ["soe", "Søndag"],
  ["so", "Søndag"],
  ["man", "Mandag"],
  ["tir", "Tirsdag"],
  ["ons", "Onsdag"],
  ["tor", "Torsdag"],
  ["fre", "Fredag"],
  ["loer", "Lørdag"],
  ["lor", "Lørdag"],
  ["soen", "Søndag"],
  ["son", "Søndag"]
]);

const CATEGORY_ALIASES = [
  { key: "ikea_detail", label: "IKEA detail", programCode: "hovedforloeb_detail_ikea", classCategoryKey: "detail_ikea", patterns: [/ikea\s*detail/i, /detail\s*ikea/i, /\bikea\b/i] },
  { key: "logistik", label: "Logistik", programCode: "hovedforloeb_logistik", classCategoryKey: "logistik", patterns: [/logistik/i] },
  { key: "blandet_detail", label: "Blandet detail", programCode: "hovedforloeb_detail", classCategoryKey: "detail", patterns: [/blandet\s*detail/i, /\bbl\.\s*detail/i, /\bdetail\b/i] },
  { key: "handel", label: "Handel", programCode: "hovedforloeb_handel", classCategoryKey: "handel", patterns: [/handel/i] },
  { key: "administration", label: "Administration", programCode: "hovedforloeb_administration", classCategoryKey: "administration", patterns: [/administration/i, /\badm\b/i] },
  { key: "off_adm", label: "Off. Adm", programCode: "hovedforloeb_administration", classCategoryKey: "administration", patterns: [/off\.?\s*adm/i, /offentlig\s*adm/i] },
  { key: "oekonomi", label: "Økonomi", programCode: "hovedforloeb_administration", classCategoryKey: "administration", patterns: [/økonomi/i, /oekonomi/i] },
  { key: "valgfag", label: "Valgfag", programCode: null, classCategoryKey: null, patterns: [/valgfag/i] }
];

const GLOBAL_ALL_EDUCATION_CATEGORY = {
  key: "alle_uddannelser",
  label: "Alle uddannelser",
  programCode: null,
  classCategoryKey: null
};

const COURSE_ALIASES = [
  ["ikea_fagproeve", "IKEA-fagpr", /ikea\s*[-.]?\s*fagpr/i],
  ["adm_fagproeve", "ADM-fagpr", /adm\s*[-.]?\s*(?:fagpr|fp)/i],
  ["oekonomi_fagproeve", "ØkonomiFP", /(?:\u00f8konomi|oekonomi)\s*fp/i],
  ["logistik_fagproeve", "LogFP", /\blog\s*fp\b/i],
  ["off_adm", "Off.adm", /off\.?\s*adm\d*/i],
  ["kap_kaede", "Kap.kæde", /kap\.?\s*k(?:\u00e6|ae|a)de(?:\s*[-.]?\s*(?:mod\.?)?\s*\d*)?/i],
  ["salgsass", "Salgsass", /salgsass\d*[a-z]?/i],
  ["salgsanalyse", "Salgsana", /salgsana\d*[a-z]?/i],
  ["indkoeb", "Indkøb", /indk(?:\u00f8|oe|o)b/i],
  ["pol_styring", "Pol.styring", /pol\.?\s*styring/i],
  ["inno_kval", "Inno-kval", /inno\s*[-.]?\s*kval/i],
  ["lov_mynd", "Lov-mynd", /lov\s*[-/]?\s*mynd/i],
  ["datahaand", "Datahånd", /datah(?:\u00e5|aa|a)nd/i],
  ["adm_pro", "Adm.pro", /\badm\.?\s*pro\b/i],
  ["opt_proc", "Opt.proc", /opt\.?\s*proc/i],
  ["projekt_skriv", "Proj.skriv", /proj\.?\s*skriv/i],
  ["projekt_praksis", "Proj.praksis", /proj\.?\s*praksis|projekt|praksis/i],
  ["moms_afgifter", "Moms-afgifter", /moms\s*[-.]?\s*afgifter/i],
  ["komm_form", "Komm.form", /komm\.?\s*form/i],
  ["komm_some", "KommSoMe", /komm\s*some/i],
  ["log_analyse", "Log.ana", /log\.?\s*ana\d*/i],
  ["prae_form", "Præ.form", /pr(?:\u00e6|ae|a)\.?\s*form/i],
  ["mdt_konflikt", "Mdt.Konflikt", /mdt\.?\s*konflikt/i],
  ["fagproeveuge", "Fagprøveuge", /fagpr(?:\u00f8|oe|o)ve/i],
  ["kap_kaede", "Kap.kæde", /kap\.?\s*k[æa]de/i],
  ["logistik", "Logistik", /logistik/i],
  ["salgsass", "Salgsass", /salgsass/i],
  ["indkoeb", "Indkøb", /indk[oø]b/i],
  ["pol_styring", "Pol.styring", /pol\.?\s*styring/i],
  ["lov_mynd", "Lov-mynd", /lov\s*[-/]?\s*mynd/i],
  ["off_udv_skr", "Off-Udv.skr", /off\s*[-/]?\s*udv\.?\s*skr/i],
  ["datahaand", "Datahånd", /datah[åa]nd/i],
  ["fagproeveuge", "Fagprøveuge", /fagpr[øo]ve/i],
  ["opsamling", "Opsamling", /opsamling/i],
  ["projekt_praksis", "Projekt/praksis", /projekt|praksis/i],
  ["oekonomi", "Økonomi", /økonomi|oekonomi/i],
  ["administration", "Administration", /administration/i]
];

const RESERVED_PATTERN = /frihold|friholdes|reserveret|spær|spaer|blocked|lukket/i;
const EXAM_PROJECT_PATTERN = /fagprøve|fagproeve|projekt|praksis/i;
const OPSAMLING_PATTERN = /opsamling/i;
const SAFE_COURSE_CATEGORY_RULES = [
  { category: GLOBAL_ALL_EDUCATION_CATEGORY, patterns: [/alle\s+udd\.?|alle\s+uddannelser/i] },
  { categoryKey: "ikea_detail", patterns: [/ikea/i] },
  { categoryKey: "logistik", patterns: [/log\.?\s*ana\d*/i, /log\s*fp\b/i, /logfp/i, /logistik/i] },
  { categoryKey: "off_adm", patterns: [/off\.?\s*adm\d*/i, /off\s*[-/]?\s*udv/i, /lov\s*[-/]?\s*mynd/i, /pol\.?\s*styring/i] },
  { categoryKey: "oekonomi", patterns: [/(?:\u00f8konomi|oekonomi)\s*fp/i, /\u00f8konomi|oekonomi/i] },
  {
    categoryKey: "administration",
    patterns: [
      /adm\.?\s*pro\b/i,
      /adm\s*[-.]?\s*(?:fagpr|fp)/i,
      /datah(?:\u00e5|aa|a)nd/i,
      /komm\.?\s*form/i,
      /moms\s*[-.]?\s*afgifter/i,
      /inno\s*[-.]?\s*kval/i,
      /opt\.?\s*proc/i
    ]
  }
];

const POSSIBLE_CATEGORY_RULES = [
  {
    label: "Blandet detail / Handel",
    confidence: "medium",
    patterns: [
      /salgsass/i,
      /salgsana/i,
      /kap\.?\s*k(?:\u00e6|ae|a)de/i,
      /pr(?:\u00e6|ae|a)\.?\s*form/i,
      /komm\s*some/i,
      /komm\.?\s*praksis/i,
      /indk(?:\u00f8|oe|o)b/i,
      /vis\.?\s*merch/i,
      /supp\.?\s*vare/i,
      /pers\.?\s*leder/i
    ]
  },
  {
    label: "Administration",
    confidence: "low",
    patterns: [/mdt\.?\s*konflikt/i, /proj\.?\s*skriv/i, /proj\.?\s*praksis/i]
  }
];

const COMMON_PARENTHETICAL_WORDS = new Set(["AF", "AFLYST", "ER", "EL", "ELLER", "OG"]);
const KNOWN_TEACHER_INITIALS = loadKnownTeacherInitials();

function parseArgs(argv) {
  const args = {
    file: "Kalender 2023-2028 nyt forslag.xlsx",
    dryRun: false,
    schoolSlug: process.env.SCHOOL_SLUG || "heg",
    organizationSlug: process.env.ORGANIZATION_SLUG || "heg",
    sourceNote: "Official hovedforloeb calendar imported from Excel.",
    sampleSize: 10
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--file") {
      args.file = argv[++index];
    } else if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length);
    } else if (arg === "--school-slug") {
      args.schoolSlug = argv[++index];
    } else if (arg.startsWith("--school-slug=")) {
      args.schoolSlug = arg.slice("--school-slug=".length);
    } else if (arg === "--organization-slug") {
      args.organizationSlug = argv[++index];
    } else if (arg.startsWith("--organization-slug=")) {
      args.organizationSlug = arg.slice("--organization-slug=".length);
    } else if (arg === "--source-note") {
      args.sourceNote = argv[++index];
    } else if (arg.startsWith("--source-note=")) {
      args.sourceNote = arg.slice("--source-note=".length);
    } else if (arg === "--sample-size") {
      args.sampleSize = Number(argv[++index]) || 10;
    } else if (!arg.startsWith("--")) {
      args.file = arg;
    }
  }

  return args;
}

async function loadXlsx() {
  try {
    const module = await import("xlsx");
    return module.default || module;
  } catch {
    const fallback = path.resolve(__dirname, "../../xlsx.full.min.js");
    if (fs.existsSync(fallback)) {
      return require(fallback);
    }
    throw new Error("Could not load xlsx. Install the xlsx package or keep xlsx.full.min.js in the project root.");
  }
}

function loadKnownTeacherInitials() {
  const known = new Set(["LHV"]);
  const seedPath = path.resolve(__dirname, "../../seed-data.js");
  if (!fs.existsSync(seedPath)) {
    return known;
  }

  const seedText = fs.readFileSync(seedPath, "utf8");
  for (const match of seedText.matchAll(/"name"\s*:\s*"([A-ZÆØÅ]{2,5}\d?)"/g)) {
    known.add(match[1].toUpperCase());
  }
  return known;
}

function fold(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("æ", "ae")
    .replaceAll("ø", "oe")
    .replaceAll("å", "aa")
    .replaceAll("æ", "ae")
    .replaceAll("ø", "oe")
    .replaceAll("å", "aa")
    .replaceAll("é", "e")
    .replaceAll("è", "e")
    .replaceAll("ü", "u");
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return fold(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "ukendt";
}

function cellText(cell) {
  if (!cell) {
    return "";
  }
  if (cell.v instanceof Date) {
    return cell.v.toISOString().slice(0, 10);
  }
  return clean(cell.w ?? cell.v ?? "");
}

function sheetCell(sheet, row, col, XLSX) {
  return sheet[XLSX.utils.encode_cell({ r: row, c: col })];
}

function findMonth(text) {
  const folded = fold(text);
  for (const [name, number] of MONTHS) {
    if (folded === fold(name) || folded.startsWith(`${fold(name)} `)) {
      return { monthName: capitalizeMonth(name), monthNo: number };
    }
  }
  return null;
}

function capitalizeMonth(name) {
  return name.slice(0, 1).toUpperCase() + name.slice(1);
}

function sheetYear(sheetName) {
  const match = String(sheetName).trim().match(/^(202[3-8])(?:\s*\(\d+\))?$/);
  return match ? Number(match[1]) : null;
}

function excelDateToDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  return null;
}

function parseDayValue(text, cell) {
  const dateValue = excelDateToDate(cell?.v);
  if (dateValue) {
    return { day: dateValue.getDate(), date: dateValue };
  }

  const numeric = clean(text).match(/^(\d{1,2})(?:\.|\s|$)/);
  if (!numeric) {
    return null;
  }

  const day = Number(numeric[1]);
  return day >= 1 && day <= 31 ? { day, date: null } : null;
}

function parseWeekValue(text) {
  const folded = fold(text);
  const match = folded.match(/\b(?:uge|u)\.?\s*(\d{1,2})\b/);
  if (!match) {
    return null;
  }
  const week = Number(match[1]);
  return week >= 1 && week <= 53 ? week : null;
}

function parseWeekday(text) {
  const key = fold(text).replace(/[^a-z]+/g, "");
  return WEEKDAYS.get(key) || null;
}

function makeDate(year, monthNo, day) {
  const date = new Date(Date.UTC(year, monthNo - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthNo - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function isoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
}

function weekdayFromDate(date) {
  return ["Søndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag"][date.getUTCDay()];
}

function isKnownTeacherInitial(token) {
  const normalized = token.toUpperCase();
  const base = normalized.replace(/\d+$/, "");
  return KNOWN_TEACHER_INITIALS.has(normalized) || KNOWN_TEACHER_INITIALS.has(base);
}

function extractTeacherInitials(text) {
  const initials = [];
  const value = String(text);
  const addInitial = (rawPart, hasTeacherListSeparator) => {
    if (!/^[A-ZÆØÅ]{2,5}\d?$/.test(rawPart)) {
      return;
    }

    const part = rawPart.toUpperCase();
    if (COMMON_PARENTHETICAL_WORDS.has(part)) {
      return;
    }

    const knownTeacher = isKnownTeacherInitial(part);
    const looksLikeInitial = /^[A-ZÆØÅ]{3,5}\d?$/.test(part);
    if ((knownTeacher || (hasTeacherListSeparator && looksLikeInitial)) && !initials.includes(part)) {
      initials.push(part);
    }
  };

  const matches = value.matchAll(/\(([^)]+)\)/g);
  for (const match of matches) {
    const group = match[1];
    const hasTeacherListSeparator = /[\/,+;&]/.test(group);
    const parts = group
      .split(/[\/,+;&\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const rawPart of parts) {
      addInitial(rawPart, hasTeacherListSeparator);
    }
  }

  for (const match of value.matchAll(/\b([A-ZÆØÅ]{2,5}\d?)\s*(?:\/|\+|,|;|&)\s*([A-ZÆØÅ]{2,5}\d?)\b/g)) {
    addInitial(match[1], true);
    addInitial(match[2], true);
  }

  return initials;
}

function removeTeacherInitials(text) {
  return clean(String(text)
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/\b[A-ZÆØÅ]{2,5}\d?\s*(?:\/|\+|,|;|&)\s*[A-ZÆØÅ]{2,5}\d?\b/g, " "));
}

function inferCourse(rawText) {
  const withoutTeachers = removeTeacherInitials(rawText);
  if (!withoutTeachers) {
    return { courseCode: null, courseName: null };
  }

  for (const [courseCode, courseName, pattern] of COURSE_ALIASES) {
    if (pattern.test(withoutTeachers)) {
      return { courseCode, courseName };
    }
  }

  return {
    courseCode: slug(withoutTeachers),
    courseName: withoutTeachers
  };
}

function categoryFromText(text) {
  for (const alias of CATEGORY_ALIASES) {
    if (alias.patterns.some((pattern) => pattern.test(text))) {
      return alias;
    }
  }
  return null;
}

function categoryByKey(key) {
  return CATEGORY_ALIASES.find((alias) => alias.key === key) || null;
}

function categoryFromCourseText(text) {
  for (const rule of SAFE_COURSE_CATEGORY_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(text))) {
      continue;
    }
    return rule.category || categoryByKey(rule.categoryKey);
  }
  return null;
}

function possibleCategoryFromCourseText(text) {
  for (const rule of POSSIBLE_CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { label: rule.label, confidence: rule.confidence };
    }
  }
  return null;
}

function inferCategory(rawText, columnCategory) {
  const textCategory = categoryFromCourseText(rawText);
  if (textCategory) {
    return {
      category: textCategory,
      possibleCategory: null,
      categoryConfidence: "high",
      categorySource: "text",
      globalOrAllEducation: textCategory.key === GLOBAL_ALL_EDUCATION_CATEGORY.key
    };
  }

  if (columnCategory) {
    return {
      category: columnCategory,
      possibleCategory: null,
      categoryConfidence: "high",
      categorySource: "column",
      globalOrAllEducation: false
    };
  }

  const possible = possibleCategoryFromCourseText(rawText);
  return {
    category: null,
    possibleCategory: possible?.label || null,
    categoryConfidence: possible?.confidence || null,
    categorySource: possible ? "text_hint" : null,
    globalOrAllEducation: false
  };
}

function findMonthHeaders(sheet, range, XLSX) {
  const headers = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const text = cellText(sheetCell(sheet, row, col, XLSX));
      const month = findMonth(text);
      if (month) {
        headers.push({ row, col, ...month });
      }
    }
  }
  return headers.sort((a, b) => a.row - b.row || a.col - b.col);
}

function mergedColumnsForCell(sheet, row, col) {
  const merges = sheet["!merges"] || [];
  const merge = merges.find((item) => (
    row >= item.s.r && row <= item.e.r && col >= item.s.c && col <= item.e.c
  ));
  if (!merge) {
    return [col];
  }
  return Array.from({ length: merge.e.c - merge.s.c + 1 }, (_, offset) => merge.s.c + offset);
}

function buildCategoryByColumn(sheet, range, XLSX) {
  const categoryByColumn = new Map();
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const text = cellText(sheetCell(sheet, row, col, XLSX));
      const category = categoryFromText(text);
      if (!category) {
        continue;
      }
      for (const categoryCol of mergedColumnsForCell(sheet, row, col)) {
        categoryByColumn.set(categoryCol, category);
      }
    }
  }
  return categoryByColumn;
}

function blockEnd(headers, header, range) {
  const nextSameRow = headers.find((candidate) => candidate.row === header.row && candidate.col > header.col);
  return nextSameRow ? nextSameRow.col - 1 : range.e.c;
}

function blockRowEnd(headers, header, range) {
  const nextHeaderBelow = headers.find((candidate) => candidate.row > header.row);
  const naturalEnd = Math.min(range.e.r, header.row + 45);
  return nextHeaderBelow ? Math.min(naturalEnd, nextHeaderBelow.row - 1) : naturalEnd;
}

function rowDateContext(sheet, row, startCol, endCol, year, monthNo, XLSX) {
  let dayInfo = null;
  let weekday = null;
  let week = null;
  const metaEnd = Math.min(endCol, startCol + 4);

  for (let col = startCol; col <= metaEnd; col += 1) {
    const cell = sheetCell(sheet, row, col, XLSX);
    const text = cellText(cell);
    if (!dayInfo) {
      dayInfo = parseDayValue(text, cell);
    }
    if (!weekday) {
      weekday = parseWeekday(text);
    }
    if (!week) {
      week = parseWeekValue(text);
    }
  }

  if (!dayInfo) {
    return null;
  }

  const parsedDate = dayInfo.date || makeDate(year, monthNo, dayInfo.day);
  if (!parsedDate) {
    return null;
  }

  return {
    day: dayInfo.day,
    date: parsedDate,
    isoWeek: week || isoWeek(parsedDate),
    weekday: weekday || weekdayFromDate(parsedDate)
  };
}

function contentIgnoreReason(text) {
  const folded = fold(text);
  if (!folded) {
    return "blank";
  }
  if (parseWeekday(text)) {
    return "weekday";
  }
  if (findMonth(text) || parseWeekValue(text)) {
    return "metadata";
  }
  if (/^\d{1,2}\.?$/.test(folded)) {
    return "metadata";
  }
  if (/^(dato|dag|uge|u)$/.test(folded)) {
    return "metadata";
  }
  return null;
}

function shouldIgnoreContent(text) {
  return Boolean(contentIgnoreReason(text));
}

function parseWorkbook(filePath, XLSX) {
  const workbookBuffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(workbookBuffer, { type: "buffer", cellDates: true, raw: false });
  const entries = [];
  const warnings = [];
  const sheetSummaries = [];
  const stats = {
    ignored_weekday_cells: 0,
    ignored_metadata_cells: 0
  };

  for (const sheetName of workbook.SheetNames) {
    const year = sheetYear(sheetName);
    if (!year) {
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const ref = sheet["!ref"];
    if (!ref) {
      warnings.push({ type: "empty_sheet", severity: "warning", sheetName, message: `Sheet ${sheetName} has no used range.` });
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    const monthHeaders = findMonthHeaders(sheet, range, XLSX);
    const categoryByColumn = buildCategoryByColumn(sheet, range, XLSX);
    let sheetEntryCount = 0;

    if (!monthHeaders.length) {
      warnings.push({ type: "missing_month_headers", severity: "warning", sheetName, message: `Sheet ${sheetName} has no recognizable month headers.` });
      continue;
    }

    for (const header of monthHeaders) {
      const startCol = header.col;
      const endCol = blockEnd(monthHeaders, header, range);
      const endRow = blockRowEnd(monthHeaders, header, range);

      for (let row = header.row + 1; row <= endRow; row += 1) {
        const context = rowDateContext(sheet, row, startCol, endCol, year, header.monthNo, XLSX);
        if (!context) {
          continue;
        }

        for (let col = startCol; col <= endCol; col += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: col });
          const rawText = cellText(sheet[address]);
          const ignoreReason = contentIgnoreReason(rawText);
          if (ignoreReason) {
            if (ignoreReason === "weekday") {
              stats.ignored_weekday_cells += 1;
            } else if (ignoreReason !== "blank") {
              stats.ignored_metadata_cells += 1;
            }
            continue;
          }

          const withoutTeachers = removeTeacherInitials(rawText);
          if (!withoutTeachers) {
            continue;
          }

          const teacherInitials = extractTeacherInitials(rawText);
          const course = inferCourse(rawText);
          const categoryMatch = inferCategory(rawText, categoryByColumn.get(col) || null);
          const category = categoryMatch.category;
          const isExamOrProject = EXAM_PROJECT_PATTERN.test(rawText);
          const isOpsamling = OPSAMLING_PATTERN.test(rawText);
          const isReservedOrBlocked = RESERVED_PATTERN.test(rawText);

          const entry = {
            calendar_year: year,
            sheet_name: sheetName,
            cell_address: address,
            source_row: row + 1,
            source_col: col + 1,
            month_no: header.monthNo,
            month_name: header.monthName,
            day_of_month: context.day,
            date: dateString(context.date),
            iso_week: context.isoWeek,
            weekday: context.weekday,
            raw_text: rawText,
            course_code: course.courseCode,
            course_name: course.courseName,
            course_category: category?.label || null,
            teacher_initials: teacherInitials.length ? teacherInitials : null,
            is_exam_or_project: isExamOrProject,
            is_opsamling: isOpsamling,
            is_reserved_or_blocked: isReservedOrBlocked,
            lock_level: "official",
            metadata: {
              parser: "import-official-hf-calendar.mjs",
              category_key: category?.key || null,
              program_code: category?.programCode || null,
              class_category_key: category?.classCategoryKey || null,
              possible_category: categoryMatch.possibleCategory,
              category_confidence: categoryMatch.categoryConfidence,
              category_source: categoryMatch.categorySource,
              global_or_all_education: categoryMatch.globalOrAllEducation
            }
          };

          if (!entry.course_category && !entry.is_reserved_or_blocked) {
            warnings.push({
              type: "unmatched_category",
              severity: "warning",
              sheetName,
              sourceRow: entry.source_row,
              entityLegacyId: `${sheetName}!${address}`,
              message: categoryMatch.possibleCategory
                ? `Could not infer secure course category for "${rawText}" (possible: ${categoryMatch.possibleCategory}).`
                : `Could not infer course category for "${rawText}".`
            });
          }

          entries.push(entry);
          sheetEntryCount += 1;
        }
      }
    }

    sheetSummaries.push({
      sheetName,
      year,
      monthHeaders: monthHeaders.length,
      entries: sheetEntryCount
    });
  }

  return { entries: dedupeEntries(entries), warnings, sheetSummaries, stats };
}

function dedupeEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.sheet_name}|${entry.cell_address}|${entry.raw_text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function summarize(entries, warnings, sheetSummaries, sampleSize, parserStats = {}) {
  const byYear = countBy(entries, (entry) => entry.calendar_year);
  const byCategory = countBy(entries, (entry) => entry.course_category || "Unmatched");
  const unmatched = entries.filter((entry) => !entry.course_category || !entry.course_code || !entry.course_name);
  const entriesWithPossibleCategory = entries.filter((entry) => Boolean(entry.metadata?.possible_category));
  const unmatchedWithoutPossibleCategory = unmatched.filter((entry) => !entry.metadata?.possible_category);

  return {
    sheets_read: sheetSummaries.length,
    sheet_summaries: sheetSummaries,
    entries_found: entries.length,
    entries_by_year: byYear,
    entries_by_category: byCategory,
    unmatched: unmatched.length,
    unmatched_without_possible_category: unmatchedWithoutPossibleCategory.length,
    entries_with_possible_category: entriesWithPossibleCategory.length,
    entries_global_or_all_education: entries.filter((entry) => entry.metadata?.global_or_all_education).length,
    entries_exam_or_project: entries.filter((entry) => entry.is_exam_or_project).length,
    entries_opsamling: entries.filter((entry) => entry.is_opsamling).length,
    ignored_weekday_cells: parserStats.ignored_weekday_cells || 0,
    ignored_metadata_cells: parserStats.ignored_metadata_cells || 0,
    entries_with_teacher_initials: entries.filter((entry) => Array.isArray(entry.teacher_initials) && entry.teacher_initials.length > 0).length,
    entries_reserved_or_blocked: entries.filter((entry) => entry.is_reserved_or_blocked).length,
    top_20_unmatched_texts: topTextCounts(unmatched, (entry) => entry.raw_text, 20),
    top_20_possible_category_texts: topTextCounts(entriesWithPossibleCategory, (entry) => `${entry.raw_text} -> ${entry.metadata.possible_category} (${entry.metadata.category_confidence})`, 20),
    top_20_raw_texts: topTextCounts(entries, (entry) => entry.raw_text, 20),
    sample_entries: entries.slice(0, sampleSize),
    sample_warnings: warnings.slice(0, sampleSize)
  };
}

function topTextCounts(items, keyFn, limit) {
  return Object.entries(countBy(items, keyFn))
    .sort(([leftText, leftCount], [rightText, rightCount]) => (
      rightCount - leftCount || leftText.localeCompare(rightText, "da")
    ))
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = String(keyFn(item));
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function calendarYearBounds(entries) {
  const years = entries.map((entry) => entry.calendar_year).filter(Number.isFinite);
  return {
    start: years.length ? Math.min(...years) : 2023,
    end: years.length ? Math.max(...years) : 2028
  };
}

class SupabaseRest {
  constructor({ url, key }) {
    this.url = url.replace(/\/+$/, "");
    this.key = key;
  }

  async request(method, table, { query = {}, body = null, prefer = null } = {}) {
    const url = new URL(`${this.url}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const headers = {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json"
    };
    if (prefer) {
      headers.Prefer = prefer;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`${method} ${table} failed: ${response.status} ${text}`);
    }
    return data;
  }

  select(table, query) {
    return this.request("GET", table, { query });
  }

  insert(table, body) {
    return this.request("POST", table, {
      body,
      prefer: "return=representation"
    });
  }

  upsert(table, body, onConflict) {
    return this.request("POST", table, {
      query: { on_conflict: onConflict },
      body,
      prefer: "resolution=merge-duplicates,return=representation"
    });
  }
}

async function getSchool(client, organizationSlug, schoolSlug) {
  const organizations = await client.select("organizations", {
    select: "id,slug,name",
    slug: `eq.${organizationSlug}`,
    limit: "1"
  });
  if (!organizations.length) {
    throw new Error(`No organization found with slug ${organizationSlug}. Run migrations through 004 first.`);
  }

  const schools = await client.select("schools", {
    select: "id,slug,name,organization_id",
    organization_id: `eq.${organizations[0].id}`,
    slug: `eq.${schoolSlug}`,
    limit: "1"
  });
  if (!schools.length) {
    throw new Error(`No school found with slug ${schoolSlug} in organization ${organizationSlug}. Run migrations through 004 first.`);
  }

  return schools[0];
}

async function loadLookupMaps(client, schoolId) {
  const [programs, categories] = await Promise.all([
    client.select("education_programs", { select: "id,code,name", school_id: `eq.${schoolId}` }),
    client.select("class_categories", { select: "id,normalized_key,name", school_id: `eq.${schoolId}` })
  ]);

  return {
    programByCode: new Map(programs.map((program) => [String(program.code), program.id])),
    categoryByKey: new Map(categories.map((category) => [category.normalized_key || slug(category.name), category.id]))
  };
}

function applyDatabaseMatches(entries, lookupMaps, warnings) {
  return entries.map((entry) => {
    const programCode = entry.metadata.program_code;
    const classCategoryKey = entry.metadata.class_category_key;
    const educationProgramId = programCode ? lookupMaps.programByCode.get(programCode) || null : null;
    const classCategoryId = classCategoryKey ? lookupMaps.categoryByKey.get(classCategoryKey) || null : null;

    if (programCode && !educationProgramId) {
      warnings.push({
        type: "unmatched_education_program",
        severity: "warning",
        sheetName: entry.sheet_name,
        sourceRow: entry.source_row,
        entityLegacyId: `${entry.sheet_name}!${entry.cell_address}`,
        message: `Could not match education program code ${programCode} for "${entry.raw_text}".`
      });
    }
    if (classCategoryKey && !classCategoryId) {
      warnings.push({
        type: "unmatched_class_category",
        severity: "warning",
        sheetName: entry.sheet_name,
        sourceRow: entry.source_row,
        entityLegacyId: `${entry.sheet_name}!${entry.cell_address}`,
        message: `Could not match class category key ${classCategoryKey} for "${entry.raw_text}".`
      });
    }

    return {
      ...entry,
      education_program_id: educationProgramId,
      class_category_id: classCategoryId
    };
  });
}

async function ensureOfficialImport(client, schoolId, filename, bounds, sourceNote, summary) {
  const existing = await client.select("official_hf_calendar_imports", {
    select: "id,data_import_id",
    school_id: `eq.${schoolId}`,
    filename: `eq.${filename}`,
    calendar_year_start: `eq.${bounds.start}`,
    calendar_year_end: `eq.${bounds.end}`,
    limit: "1"
  });

  let dataImportId = existing[0]?.data_import_id || null;
  if (!dataImportId) {
    const [dataImport] = await client.insert("data_imports", [{
      school_id: schoolId,
      source_kind: "excel",
      source_name: filename,
      import_version: "official-hf-calendar-v1",
      metadata: {
        source: "official_hf_calendar",
        calendar_year_start: bounds.start,
        calendar_year_end: bounds.end,
        summary
      }
    }]);
    dataImportId = dataImport.id;
  }

  const [officialImport] = await client.upsert("official_hf_calendar_imports", [{
    school_id: schoolId,
    data_import_id: dataImportId,
    filename,
    calendar_year_start: bounds.start,
    calendar_year_end: bounds.end,
    source_note: sourceNote,
    metadata: {
      parser: "import-official-hf-calendar.mjs",
      summary
    }
  }], "school_id,filename,calendar_year_start,calendar_year_end");

  return officialImport;
}

async function upsertEntries(client, importId, schoolId, entries) {
  const rows = entries.map((entry) => ({
    import_id: importId,
    school_id: schoolId,
    ...entry
  }));

  let written = 0;
  for (const chunk of chunks(rows, 500)) {
    const result = await client.upsert(
      "official_hf_calendar_entries",
      chunk,
      "import_id,sheet_name,cell_address,raw_text"
    );
    written += result.length;
  }
  return written;
}

async function insertWarnings(client, dataImportId, schoolId, warnings) {
  if (!warnings.length || !dataImportId) {
    return 0;
  }

  const existing = await client.select("import_warnings", {
    select: "source_sheet,source_row,entity_type,entity_legacy_id,message",
    data_import_id: `eq.${dataImportId}`
  });
  const existingKeys = new Set(existing.map(warningKey));

  const rows = warnings.map((warning) => ({
    school_id: schoolId,
    data_import_id: dataImportId,
    warning_type: warning.type || "official_hf_calendar_warning",
    severity: warning.severity || "warning",
    source_sheet: warning.sheetName || null,
    source_row: warning.sourceRow || null,
    entity_type: "official_hf_calendar_entry",
    entity_legacy_id: warning.entityLegacyId || null,
    message: warning.message,
    resolved: false
  })).filter((row) => !existingKeys.has(warningKey(row)));

  let inserted = 0;
  for (const chunk of chunks(rows, 500)) {
    const result = await client.insert("import_warnings", chunk);
    inserted += result.length;
  }
  return inserted;
}

function warningKey(warning) {
  return [
    warning.source_sheet || "",
    warning.source_row || "",
    warning.entity_type || "",
    warning.entity_legacy_id || "",
    warning.message || ""
  ].join("|");
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Workbook not found: ${filePath}`);
  }

  const XLSX = await loadXlsx();
  const parsed = parseWorkbook(filePath, XLSX);
  const bounds = calendarYearBounds(parsed.entries);
  const summary = summarize(parsed.entries, parsed.warnings, parsed.sheetSummaries, args.sampleSize, parsed.stats);

  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running a real import.");
  }

  const client = new SupabaseRest({ url: supabaseUrl, key: supabaseKey });
  const school = await getSchool(client, args.organizationSlug, args.schoolSlug);
  const lookupMaps = await loadLookupMaps(client, school.id);
  const entries = applyDatabaseMatches(parsed.entries, lookupMaps, parsed.warnings);
  const importSummary = summarize(entries, parsed.warnings, parsed.sheetSummaries, args.sampleSize, parsed.stats);
  const officialImport = await ensureOfficialImport(
    client,
    school.id,
    path.basename(filePath),
    bounds,
    args.sourceNote,
    importSummary
  );

  const entriesWritten = await upsertEntries(client, officialImport.id, school.id, entries);
  const warningsInserted = await insertWarnings(client, officialImport.data_import_id, school.id, parsed.warnings);

  console.log(JSON.stringify({
    import_id: officialImport.id,
    data_import_id: officialImport.data_import_id,
    entries_written: entriesWritten,
    warnings_inserted: warningsInserted,
    summary: importSummary
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
