#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(__dirname, "../..");

const DEFAULT_EXCEL_FILENAMES = [
  "Databaser lister til skemal\u00e6gning l\u00e6rerkompetencer.xlsx",
  "_test_l\u00e6rerkompetencer.xlsx",
  "_test.xlsx",
  "Kopi af L\u00e6rerkompetencer til Toke.xlsx"
];

const DEFAULT_EXTERNAL_EXCEL_PATHS = [
  "C:/Users/tkl/OneDrive - Himmerlands Erhvervs- og Gymnasieuddannelser/Dokumenter/Skrivebord/Databaser lister til skemal\u00e6gning l\u00e6rerkompetencer.xlsx",
  "C:/Users/tkl/OneDrive - Himmerlands Erhvervs- og Gymnasieuddannelser/Dokumenter/Skrivebord/Kopi af L\u00e6rerkompetencer til Toke.xlsx"
];

const IMPORT_VERSION = "stamdata-v1";
const DEFAULT_BLOCK_HOURS = 1.5;
const ALLOWED_TARGET_TABLES = new Set([
  "data_imports",
  "import_warnings",
  "campuses",
  "teachers",
  "teacher_unavailable_days",
  "rooms",
  "class_groups",
  "class_active_weeks",
  "course_subjects",
  "teacher_competencies",
  "education_requirements",
  "subject_pairing_groups",
  "subject_offerings",
  "teaching_assignments",
  "teacher_suggestions"
]);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    seedPath: path.resolve(REPO_ROOT, "seed-data.js"),
    excelPath: null,
    sampleSize: 20,
    organizationSlug: process.env.ORGANIZATION_SLUG || "heg",
    schoolSlug: process.env.SCHOOL_SLUG || "heg",
    includeExternalExcel: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--seed") {
      args.seedPath = path.resolve(process.cwd(), argv[++index]);
    } else if (arg.startsWith("--seed=")) {
      args.seedPath = path.resolve(process.cwd(), arg.slice("--seed=".length));
    } else if (arg === "--excel") {
      args.excelPath = path.resolve(process.cwd(), argv[++index]);
    } else if (arg.startsWith("--excel=")) {
      args.excelPath = path.resolve(process.cwd(), arg.slice("--excel=".length));
    } else if (arg === "--sample-size") {
      args.sampleSize = Number(argv[++index]) || 20;
    } else if (arg.startsWith("--sample-size=")) {
      args.sampleSize = Number(arg.slice("--sample-size=".length)) || 20;
    } else if (arg === "--organization-slug") {
      args.organizationSlug = argv[++index];
    } else if (arg.startsWith("--organization-slug=")) {
      args.organizationSlug = arg.slice("--organization-slug=".length);
    } else if (arg === "--school-slug") {
      args.schoolSlug = argv[++index];
    } else if (arg.startsWith("--school-slug=")) {
      args.schoolSlug = arg.slice("--school-slug=".length);
    } else if (arg === "--workspace-only") {
      args.includeExternalExcel = false;
    } else if (!arg.startsWith("--")) {
      args.excelPath = path.resolve(process.cwd(), arg);
    }
  }

  return args;
}

async function loadXlsx() {
  try {
    const module = await import("xlsx");
    return module.default || module;
  } catch {
    const fallback = path.resolve(REPO_ROOT, "xlsx.full.min.js");
    if (fs.existsSync(fallback)) {
      return require(fallback);
    }
    throw new Error("Kunne ikke indl\u00e6se Excel-l\u00e6ser. Behold xlsx.full.min.js i projektroden eller installer pakken xlsx.");
  }
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fold(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("\u00e6", "ae")
    .replaceAll("\u00f8", "oe")
    .replaceAll("\u00e5", "aa");
}

function normalizedKey(value) {
  return fold(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "ukendt";
}

function stableId(prefix, key) {
  return `${prefix}-${normalizedKey(key)}`;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = String(keyFn(item) || "ukendt");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function numberValue(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function isMarked(value) {
  const text = fold(value).replace(/\s+/g, "");
  return ["x", "(x)", "xx", "1", "ja", "yes", "true"].includes(text);
}

function competencyLevel(value) {
  const text = fold(value);
  if (!text) {
    return null;
  }
  if (text.includes("cert")) {
    return "certified";
  }
  if (text.includes("(") || text.includes("sek") || text.includes("secondary")) {
    return "secondary";
  }
  if (isMarked(value)) {
    return "primary";
  }
  return null;
}

function looksLikeInitials(value) {
  return /^[A-Z\u00c6\u00d8\u00c5]{2,5}$/.test(clean(value));
}

function canonicalSubjectName(name) {
  return clean(name)
    .replace(/\bSt\u00e5\b/gi, "ST\u00c5")
    .replace(/\bUsf\b/g, "USF")
    .replace(/\bEop\b/g, "EOP")
    .replace(/\bEo([12])\b/gi, "EO$1");
}

function subjectNameFromParts(subject, level) {
  const base = canonicalSubjectName(subject);
  const cleanLevel = clean(level).toUpperCase();
  if (!base) {
    return "";
  }
  if (!cleanLevel) {
    return base;
  }
  if (new RegExp(`\\b${cleanLevel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(base)) {
    return base;
  }
  return `${base} ${cleanLevel}`;
}

function classMapping(className) {
  const key = fold(className);

  if (/\bgf1\b/.test(key)) {
    return { class_category_key: "gf1", program_code: "gf1", confidence: "high" };
  }
  if (/\bgf2\b/.test(key)) {
    return { class_category_key: "gf2", program_code: "gf2", confidence: "high" };
  }
  if (key.includes("studenter") || key.includes("staa")) {
    return {
      class_category_key: "staa",
      program_code: "staa",
      confidence: "low",
      possible_category: "ST\u00c5",
      possible_category_keys: ["staa"],
      possible_program_codes: ["staa"],
      common_education_program_code: "staa",
      cohort_type: null,
      cohort_label: null,
      possible_cohort_types: ["staa1", "staa2"],
      cohort_confidence: "unknown",
      combined_teaching_group_key: "staa_combined",
      note: "Studenter\u00e5ret mappes til f\u00e6lles ST\u00c5-forl\u00f8b; ST\u00c51/ST\u00c52-kohorte kan ikke udledes sikkert af stamdata alene."
    };
  }
  if (key.includes("eus5")) {
    if (key.includes("dh")) {
      return {
        class_category_key: null,
        program_code: null,
        confidence: "low",
        possible_category: "EUS / hovedforl\u00f8b detail-handel",
        possible_category_keys: ["detail", "handel"],
        possible_program_codes: ["hovedforloeb_detail", "hovedforloeb_handel"],
        note: "EUS5 DH er ikke sikkert mappet; review om det skal v\u00e6re detail, handel eller en s\u00e6rskilt EUS-kategori."
      };
    }
    if (/\bk\b/.test(key) || key.endsWith(" k")) {
      return {
        class_category_key: null,
        program_code: null,
        confidence: "low",
        possible_category: "EUS / kontor-administration",
        possible_category_keys: ["administration"],
        possible_program_codes: ["hovedforloeb_administration"],
        note: "EUS5 K er ikke sikkert mappet; review om det skal v\u00e6re kontor/administration eller en s\u00e6rskilt EUS-kategori."
      };
    }
    return {
      class_category_key: null,
      program_code: null,
      confidence: "low",
      possible_category: "EUS",
      possible_category_keys: ["detail", "handel", "administration"],
      possible_program_codes: ["hovedforloeb_detail", "hovedforloeb_handel", "hovedforloeb_administration"],
      note: "EUS5 er ikke sikkert mappet ud fra stamdata alene."
    };
  }
  if (key.includes("ikea") && key.includes("detail")) {
    return { class_category_key: "detail_ikea", program_code: "hovedforloeb_detail_ikea", confidence: "high" };
  }
  if (key.includes("ikea") && key.includes("logistik")) {
    return {
      class_category_key: "logistik",
      program_code: "hovedforloeb_logistik",
      confidence: "medium",
      possible_category: "IKEA/logistik",
      possible_category_keys: ["logistik", "detail_ikea"],
      possible_program_codes: ["hovedforloeb_logistik", "hovedforloeb_detail_ikea"],
      note: "IKEA logistik er mappet til logistik, men kan reviewes ift. IKEA detail/logistik."
    };
  }
  if (key.includes("detail")) {
    return { class_category_key: "detail", program_code: "hovedforloeb_detail", confidence: "high" };
  }
  if (key.includes("logistik")) {
    return { class_category_key: "logistik", program_code: "hovedforloeb_logistik", confidence: "high" };
  }
  if (key.includes("handel")) {
    return { class_category_key: "handel", program_code: "hovedforloeb_handel", confidence: "high" };
  }
  if (key.includes("offentlig") || key.includes("administration")) {
    return { class_category_key: "administration", program_code: "hovedforloeb_administration", confidence: "high" };
  }
  if (key === "kontor") {
    return {
      class_category_key: "administration",
      program_code: "hovedforloeb_administration",
      confidence: "medium",
      possible_category: "Kontor/administration",
      possible_category_keys: ["administration"],
      possible_program_codes: ["hovedforloeb_administration"],
      note: "Kontor er mappet til administration, men b\u00f8r reviewes som kontorretning."
    };
  }
  if (key.includes("kontor")) {
    return {
      class_category_key: "administration",
      program_code: "hovedforloeb_administration",
      confidence: "medium",
      possible_category: "Administration/\u00f8konomi",
      possible_category_keys: ["administration"],
      possible_program_codes: ["hovedforloeb_administration"],
      note: "Kontor/\u00f8konomi er mappet til administration, da schemaet ikke har en s\u00e6rskilt \u00f8konomikategori."
    };
  }
  if (key.includes("brobyg")) {
    return { class_category_key: "oevrig", program_code: "brobygning_oevrig", confidence: "medium" };
  }
  if (key.includes("amu")) {
    return { class_category_key: "amu", program_code: "amu", confidence: "high" };
  }

  return { class_category_key: null, program_code: null, confidence: "none", possible_category: null };
}

function derivePriority(subject) {
  const hours = Number(subject.totalHours || subject.total_hours || 0);
  if (hours >= 80) {
    return "high";
  }
  if (hours > 0 && hours <= 30) {
    return "low";
  }
  return "medium";
}

function moduleBounds(totalHours, periodValue) {
  if (!totalHours || !periodValue) {
    return { min: null, max: null, weeklyHours: null };
  }
  const weeklyHours = Number((totalHours / periodValue).toFixed(2));
  const modules = Math.max(1, weeklyHours / (DEFAULT_BLOCK_HOURS * 2));
  return {
    min: Math.max(1, Math.floor(modules)),
    max: Math.max(1, Math.ceil(modules)),
    weeklyHours
  };
}

function classMetadata(mapping, activeWeeksCount, source) {
  return {
    source,
    category_confidence: mapping.confidence,
    possible_category: mapping.possible_category || null,
    possible_category_keys: mapping.possible_category_keys || [],
    possible_program_codes: mapping.possible_program_codes || [],
    common_education_program_code: mapping.common_education_program_code || null,
    cohort_type: mapping.cohort_type || null,
    cohort_label: mapping.cohort_label || null,
    possible_cohort_types: mapping.possible_cohort_types || [],
    cohort_confidence: mapping.cohort_confidence || null,
    combined_teaching_group_key: mapping.combined_teaching_group_key || null,
    active_weeks_count: activeWeeksCount
  };
}

function resolveExcelPath(args) {
  if (args.excelPath && fs.existsSync(args.excelPath)) {
    return args.excelPath;
  }

  const candidates = [];
  for (const filename of DEFAULT_EXCEL_FILENAMES.slice(0, 1)) {
    candidates.push(path.resolve(process.cwd(), filename));
    candidates.push(path.resolve(REPO_ROOT, filename));
  }
  if (args.includeExternalExcel) {
    candidates.push(...DEFAULT_EXTERNAL_EXCEL_PATHS);
  }
  for (const filename of DEFAULT_EXCEL_FILENAMES.slice(1)) {
    candidates.push(path.resolve(process.cwd(), filename));
    candidates.push(path.resolve(REPO_ROOT, filename));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadSeedData(seedPath) {
  if (!fs.existsSync(seedPath)) {
    throw new Error(`Fandt ikke seed-data.js: ${seedPath}`);
  }
  const text = fs.readFileSync(seedPath, "utf8");
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(text, context, { filename: seedPath });
  if (!context.window.SCHEDULE_SEED_DATA) {
    throw new Error("seed-data.js indeholder ikke window.SCHEDULE_SEED_DATA.");
  }
  return context.window.SCHEDULE_SEED_DATA;
}

function sheetRows(workbook, sheetName, XLSX) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: null,
    raw: false
  });
}

function loadWorkbook(excelPath, XLSX) {
  if (!excelPath) {
    return null;
  }
  const workbook = XLSX.read(fs.readFileSync(excelPath), { type: "buffer", cellDates: true, raw: false });
  return {
    path: excelPath,
    workbook,
    rowsBySheet: new Map(workbook.SheetNames.map((sheetName) => [sheetName, sheetRows(workbook, sheetName, XLSX)]))
  };
}

function addWarning(warnings, warning) {
  warnings.push({
    severity: warning.severity || "warning",
    source: warning.source || "stamdata",
    type: warning.type,
    entity_type: warning.entity_type || null,
    entity_legacy_id: warning.entity_legacy_id || null,
    source_sheet: warning.source_sheet || null,
    source_row: warning.source_row ?? null,
    message: warning.message
  });
}

function parseExcelTeachers(rows) {
  const teachers = new Map();
  for (const row of rows) {
    const initialsCount = row.filter((cell) => looksLikeInitials(cell)).length;
    if (initialsCount < 3) {
      continue;
    }
    for (const cell of row) {
      const text = clean(cell);
      if (looksLikeInitials(text)) {
        teachers.set(text, {
          legacy_id: stableId("teacher", text),
          initials: text,
          display_name: text,
          metadata: { source: "excel_header" }
        });
      }
    }
  }
  return teachers;
}

function parseCompetenciesFromExcel(workbookData) {
  const competencies = [];
  const subjects = new Map();
  const teacherInitials = new Set();
  if (!workbookData) {
    return { competencies, subjects, teacherInitials };
  }
  const rows = workbookData.rowsBySheet.get("L\u00e6rerkompetencer") || [];
  const header = rows[0] || [];
  const teacherColumns = [];
  for (let col = 1; col < header.length; col += 1) {
    const initials = clean(header[col]);
    if (looksLikeInitials(initials)) {
      teacherColumns.push({ col, initials });
      teacherInitials.add(initials);
    }
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const subjectName = canonicalSubjectName(row[0]);
    if (!subjectName) {
      continue;
    }
    const rowCompetencies = [];
    for (const { col, initials } of teacherColumns) {
      const level = competencyLevel(row[col]);
      if (!level) {
        continue;
      }
      rowCompetencies.push({
        teacher_legacy_id: stableId("teacher", initials),
        teacher_initials: initials,
        course_subject_key: normalizedKey(subjectName),
        course_subject_name: subjectName,
        level,
        source: "excel_l\u00e6rerkompetencer",
        metadata: { source_sheet: "L\u00e6rerkompetencer", source_row: rowIndex + 1 }
      });
    }
    if (rowCompetencies.length) {
      subjects.set(normalizedKey(subjectName), {
        name: subjectName,
        normalized_key: normalizedKey(subjectName),
        metadata: { source: "excel_l\u00e6rerkompetencer" }
      });
      competencies.push(...rowCompetencies);
    }
  }

  return { competencies, subjects, teacherInitials };
}

function parseHoldOgFag(workbookData) {
  const result = {
    classes: new Map(),
    subjects: new Map(),
    offerings: []
  };
  if (!workbookData) {
    return result;
  }
  const rows = workbookData.rowsBySheet.get("Hold og fag") || [];
  if (rows.length < 4) {
    return result;
  }

  const addressRow = rows[0] || [];
  const classRow = rows[2] || [];
  const columns = [];
  for (let col = 1; col < classRow.length; col += 1) {
    const name = clean(classRow[col]);
    if (!name) {
      continue;
    }
    const address = clean(addressRow[col]) || inferCampus(name);
    const legacyId = stableId("class", name);
    result.classes.set(legacyId, {
      legacy_id: legacyId,
      name,
      address_label: address,
      campus_name: address,
      metadata: { source: "excel_hold_og_fag" }
    });
    columns.push({ col, legacyId, className: name });
  }

  for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const subjectName = canonicalSubjectName(row[0]);
    if (!subjectName) {
      continue;
    }
    const subjectKey = normalizedKey(subjectName);
    result.subjects.set(subjectKey, {
      name: subjectName,
      normalized_key: subjectKey,
      metadata: { source: "excel_hold_og_fag" }
    });
    for (const column of columns) {
      if (!isMarked(row[column.col])) {
        continue;
      }
      result.offerings.push({
        legacy_id: stableId("subject", `${column.legacyId}-${subjectName}`),
        class_legacy_id: column.legacyId,
        class_name: column.className,
        course_subject_key: subjectKey,
        name: subjectName,
        metadata: {
          source: "excel_hold_og_fag",
          source_sheet: "Hold og fag",
          source_row: rowIndex + 1
        }
      });
    }
  }

  return result;
}

function parseFagOgTimer(workbookData) {
  const rows = workbookData?.rowsBySheet.get("Fag og timer") || [];
  const requirements = [];
  const subjects = new Map();

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const holdType = clean(row[0]);
    const subjectName = subjectNameFromParts(row[1], row[2]);
    const totalHours = numberValue(row[3]);
    if (!holdType || !subjectName) {
      continue;
    }

    const subjectKey = normalizedKey(subjectName);
    subjects.set(subjectKey, {
      name: subjectName,
      normalized_key: subjectKey,
      metadata: { source: "excel_fag_og_timer" }
    });

    const programCode = programCodeFromHoldType(holdType);
    requirements.push({
      hold_type: holdType,
      program_code: programCode,
      course_subject_key: subjectKey,
      course_subject_name: subjectName,
      total_hours: totalHours,
      source: "excel_fag_og_timer",
      metadata: { source_sheet: "Fag og timer", source_row: rowIndex + 1 }
    });
  }

  return { requirements, subjects };
}

function parseRoomsFromExcel(workbookData) {
  const rooms = new Map();
  if (!workbookData) {
    return rooms;
  }
  const rows = workbookData.rowsBySheet.get("Lokaler") || [];
  const addresses = rows[0] || [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    for (let col = 1; col < row.length; col += 1) {
      const name = clean(row[col]);
      const address = clean(addresses[col]) || inferCampus(name);
      if (!name) {
        continue;
      }
      const legacyId = stableId("room", `${address}-${name}`);
      rooms.set(legacyId, {
        legacy_id: legacyId,
        name,
        address_label: address,
        campus_name: address,
        room_type_code: "standard_classroom",
        metadata: {
          source: "excel_lokaler",
          source_sheet: "Lokaler",
          source_row: rowIndex + 1
        }
      });
    }
  }

  return rooms;
}

function parseActiveWeeksFromExcel(workbookData) {
  const activeWeeks = [];
  if (!workbookData) {
    return activeWeeks;
  }
  const rows = workbookData.rowsBySheet.get("Kalender") || [];
  if (rows.length < 4) {
    return activeWeeks;
  }
  const classRow = rows[0] || [];
  const columns = [];
  for (let col = 1; col < classRow.length; col += 1) {
    const className = clean(classRow[col]);
    if (className) {
      columns.push({ col, class_legacy_id: stableId("class", className), class_name: className });
    }
  }
  for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const weekNo = numberValue(row[0]);
    if (!weekNo) {
      continue;
    }
    for (const column of columns) {
      if (isMarked(row[column.col])) {
        activeWeeks.push({
          class_legacy_id: column.class_legacy_id,
          class_name: column.class_name,
          week_no: weekNo,
          source: "excel_kalender"
        });
      }
    }
  }
  return activeWeeks;
}

function parseFagfordeling(workbookData, teachersByInitials, subjectsByKey, warnings) {
  const assignments = [];
  if (!workbookData) {
    return assignments;
  }
  for (const sheetName of ["Fagfordeling Aars", "Fagfordeling Hobro"]) {
    const rows = workbookData.rowsBySheet.get(sheetName) || [];
    if (!rows.length) {
      continue;
    }
    const headerIndex = rows.findIndex((row) => row.some((cell) => looksLikeInitials(cell)));
    if (headerIndex < 0) {
      addWarning(warnings, {
        type: "missing_assignment_header",
        source: "excel",
        source_sheet: sheetName,
        message: `Fandt ikke l\u00e6rerinitialer i ${sheetName}.`
      });
      continue;
    }

    const header = rows[headerIndex] || [];
    const campus = inferCampus(clean(header[0]) || sheetName);
    const teacherColumns = [];
    for (let col = 1; col < header.length; col += 1) {
      const initials = clean(header[col]);
      if (looksLikeInitials(initials)) {
        teacherColumns.push({ col, initials });
        if (!teachersByInitials.has(initials)) {
          teachersByInitials.set(initials, {
            legacy_id: stableId("teacher", initials),
            initials,
            display_name: initials,
            skills_summary: null,
            metadata: { source: "excel_fagfordeling_header" }
          });
        }
      }
    }

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const subjectName = canonicalSubjectName(row[0]);
      if (!subjectName) {
        continue;
      }
      const subjectKey = normalizedKey(subjectName);
      if (!subjectsByKey.has(subjectKey)) {
        subjectsByKey.set(subjectKey, {
          name: subjectName,
          normalized_key: subjectKey,
          metadata: { source: "excel_fagfordeling" }
        });
      }

      const markedTeachers = teacherColumns.filter(({ col }) => isMarked(row[col])).map(({ initials }) => initials);
      for (const initials of markedTeachers) {
        assignments.push({
          course_subject_key: subjectKey,
          course_subject_name: subjectName,
          teacher_legacy_id: stableId("teacher", initials),
          teacher_initials: initials,
          campus_name: campus,
          source: "excel_fagfordeling",
          source_sheet: sheetName,
          source_row: rowIndex + 1
        });
      }
    }
  }
  return assignments;
}

function inferCampus(value) {
  const text = fold(value);
  if (text.includes("hobro") || /^ha\d+/.test(text)) {
    return "Hobro";
  }
  if (text.includes("aars") || text.includes("aalestrup") || /^r\d+/.test(text)) {
    return "Aars";
  }
  return clean(value) || null;
}

function programCodeFromHoldType(value) {
  const text = fold(value);
  if (text.includes("gf1")) {
    return "gf1";
  }
  if (text.includes("gf2")) {
    return "gf2";
  }
  if (text.includes("staa") || text.includes("studenter")) {
    return "staa";
  }
  if (text.includes("detail") && text.includes("ikea")) {
    return "hovedforloeb_detail_ikea";
  }
  if (text.includes("detail")) {
    return "hovedforloeb_detail";
  }
  if (text.includes("logistik")) {
    return "hovedforloeb_logistik";
  }
  if (text.includes("handel")) {
    return "hovedforloeb_handel";
  }
  if (text.includes("adm") || text.includes("kontor") || text.includes("okonomi")) {
    return "hovedforloeb_administration";
  }
  if (text.includes("amu")) {
    return "amu";
  }
  return null;
}

function buildModel(seedData, workbookData, args, XLSX) {
  const warnings = [];
  const seedPath = args.seedPath;
  const excelPath = workbookData?.path || null;

  const teachersByInitials = new Map();
  const teachersByLegacy = new Map();
  const subjectsByKey = new Map();
  const classesByLegacy = new Map();
  const roomsByLegacy = new Map();
  const campusesByName = new Map();

  for (const teacher of seedData.teachers || []) {
    const initials = clean(teacher.name || teacher.initials || teacher.id);
    const row = {
      legacy_id: teacher.id || stableId("teacher", initials),
      initials,
      display_name: teacher.displayName || initials,
      skills_summary: teacher.skills || null,
      metadata: {
        source: "seed-data.js",
        seed_path: seedPath,
        skill_details_count: Array.isArray(teacher.skillDetails) ? teacher.skillDetails.length : 0
      }
    };
    teachersByInitials.set(initials, row);
    teachersByLegacy.set(row.legacy_id, row);
  }

  for (const teacher of seedData.teachers || []) {
    for (const detail of teacher.skillDetails || []) {
      const subjectName = canonicalSubjectName(detail.subject);
      if (!subjectName) {
        continue;
      }
      subjectsByKey.set(normalizedKey(subjectName), {
        name: subjectName,
        normalized_key: normalizedKey(subjectName),
        metadata: { source: "seed-data.js:teacher.skillDetails" }
      });
    }
  }

  for (const subject of seedData.subjects || []) {
    const subjectName = canonicalSubjectName(subject.name);
    if (!subjectName) {
      continue;
    }
    subjectsByKey.set(normalizedKey(subjectName), {
      name: subjectName,
      normalized_key: normalizedKey(subjectName),
      metadata: { source: "seed-data.js:subjects" }
    });
  }

  for (const klass of seedData.classes || []) {
    const mapping = classMapping(klass.name);
    const campus = inferCampus(klass.address || klass.name);
    if (campus) {
      campusesByName.set(campus, { name: campus, legacy_label: campus, metadata: { source: "seed-data.js:classes" } });
    }
    const row = {
      legacy_id: klass.id,
      name: clean(klass.name),
      address_label: campus,
      campus_name: campus,
      default_period_weeks: numberValue(klass.durationWeeks),
      class_category_key: mapping.class_category_key,
      education_program_code: mapping.program_code,
      planning_notes: mapping.note || null,
      scheduling_notes: null,
      metadata: classMetadata(mapping, Array.isArray(klass.activeWeeks) ? klass.activeWeeks.length : 0, "seed-data.js")
    };
    classesByLegacy.set(row.legacy_id, row);
    if (!mapping.class_category_key && mapping.possible_category) {
      addWarning(warnings, {
        type: mapping.possible_cohort_types?.length ? "class_cohort_uncertain" : "class_category_uncertain",
        entity_type: "class_group",
        entity_legacy_id: klass.id,
        message: mapping.possible_cohort_types?.length
          ? `Holdet "${klass.name}" mappes til f\u00e6lles ST\u00c5-forl\u00f8b, men ST\u00c51/ST\u00c52-kohorten kan ikke udledes sikkert.`
          : `Holdet "${klass.name}" har ingen sikker kategori. Mulig kategori: ${mapping.possible_category}.`
      });
    } else if (!mapping.class_category_key) {
      addWarning(warnings, {
        type: "class_missing_category",
        entity_type: "class_group",
        entity_legacy_id: klass.id,
        message: `Holdet "${klass.name}" kunne ikke matches til en holdkategori.`
      });
    } else if (mapping.confidence !== "high") {
      addWarning(warnings, {
        type: mapping.possible_cohort_types?.length ? "class_cohort_uncertain" : "class_category_uncertain",
        entity_type: "class_group",
        entity_legacy_id: klass.id,
        message: mapping.possible_cohort_types?.length
          ? `Holdet "${klass.name}" mappes til f\u00e6lles ST\u00c5-program (${mapping.program_code}) og kategori (${mapping.class_category_key}), men ST\u00c51/ST\u00c52-kohorten kan ikke udledes sikkert.`
          : mapping.class_category_key
            ? `Holdet "${klass.name}" er mappet til ${mapping.class_category_key} med ${mapping.confidence} sikkerhed. Mulig kategori: ${mapping.possible_category || mapping.class_category_key}.`
            : `Holdet "${klass.name}" har ingen sikker kategori. Mulig kategori: ${mapping.possible_category || "ukendt"}.`
      });
    }
    if (!Array.isArray(klass.activeWeeks) || !klass.activeWeeks.length) {
      addWarning(warnings, {
        type: "class_missing_active_weeks",
        entity_type: "class_group",
        entity_legacy_id: klass.id,
        message: `Holdet "${klass.name}" har ingen aktive uger.`
      });
    }
  }

  for (const room of seedData.rooms || []) {
    const campus = inferCampus(room.address || room.name);
    if (campus) {
      campusesByName.set(campus, { name: campus, legacy_label: campus, metadata: { source: "seed-data.js:rooms" } });
    }
    roomsByLegacy.set(room.id, {
      legacy_id: room.id,
      name: clean(room.name),
      address_label: campus,
      campus_name: campus,
      room_type_code: "standard_classroom",
      metadata: { source: "seed-data.js" }
    });
    if (!campus) {
      addWarning(warnings, {
        type: "room_missing_address",
        entity_type: "room",
        entity_legacy_id: room.id,
        message: `Lokalet "${room.name}" mangler adresse/campus.`
      });
    }
  }

  if (workbookData) {
    const allExcelRows = [...workbookData.rowsBySheet.values()].flat();
    for (const [initials, teacher] of parseExcelTeachers(allExcelRows)) {
      if (!teachersByInitials.has(initials)) {
        teachersByInitials.set(initials, teacher);
      }
    }

    const excelCompetencies = parseCompetenciesFromExcel(workbookData);
    for (const [key, subject] of excelCompetencies.subjects) {
      subjectsByKey.set(key, subject);
    }
    for (const initials of excelCompetencies.teacherInitials) {
      if (!teachersByInitials.has(initials)) {
        const teacher = {
          legacy_id: stableId("teacher", initials),
          initials,
          display_name: initials,
          skills_summary: null,
          metadata: { source: "excel_l\u00e6rerkompetencer_header" }
        };
        teachersByInitials.set(initials, teacher);
      }
    }

    const holdOgFag = parseHoldOgFag(workbookData);
    for (const [key, subject] of holdOgFag.subjects) {
      subjectsByKey.set(key, subject);
    }
    for (const [legacyId, klass] of holdOgFag.classes) {
      const existingClass = [...classesByLegacy.values()].find((item) => fold(item.name) === fold(klass.name));
      if (!existingClass && !classesByLegacy.has(legacyId)) {
        const mapping = classMapping(klass.name);
        classesByLegacy.set(legacyId, {
          ...klass,
          class_category_key: mapping.class_category_key,
          education_program_code: mapping.program_code,
          default_period_weeks: null,
          planning_notes: mapping.note || null,
          scheduling_notes: null,
          metadata: {
            ...klass.metadata,
            ...classMetadata(mapping, 0, klass.metadata?.source || "excel_hold_og_fag")
          }
        });
      }
    }

    const fagOgTimer = parseFagOgTimer(workbookData);
    for (const [key, subject] of fagOgTimer.subjects) {
      subjectsByKey.set(key, subject);
    }

    for (const [legacyId, room] of parseRoomsFromExcel(workbookData)) {
      const existingRoom = [...roomsByLegacy.values()].find((item) => (
        fold(item.name) === fold(room.name) && fold(item.campus_name) === fold(room.campus_name)
      ));
      if (!existingRoom && !roomsByLegacy.has(legacyId)) {
        roomsByLegacy.set(legacyId, room);
      }
      if (room.campus_name) {
        campusesByName.set(room.campus_name, { name: room.campus_name, legacy_label: room.campus_name, metadata: { source: "excel_lokaler" } });
      }
    }
  }

  for (const teacher of teachersByInitials.values()) {
    teachersByLegacy.set(teacher.legacy_id, teacher);
  }

  const competencies = buildCompetencies(seedData, workbookData, teachersByInitials, subjectsByKey);
  const activeWeeks = buildActiveWeeks(seedData, workbookData, classesByLegacy);
  const subjectOfferings = buildSubjectOfferings(seedData, subjectsByKey, classesByLegacy, warnings);
  const pairingGroups = buildPairingGroups(seedData.subjects || []);

  const workbookAssignments = parseFagfordeling(workbookData, teachersByInitials, subjectsByKey, warnings);
  const teachingAssignments = buildTeachingAssignments(seedData, workbookAssignments, subjectOfferings, teachersByInitials, competencies, warnings);
  const teacherSuggestions = buildTeacherSuggestions(seedData, subjectOfferings, teachersByLegacy, warnings);
  const hourRules = parseFagOgTimer(workbookData).requirements;
  const educationRequirements = buildEducationRequirements(subjectOfferings, classesByLegacy, subjectsByKey);
  const unavailableDays = buildUnavailableDays(seedData, teachersByLegacy, warnings);

  for (const offering of subjectOfferings) {
    if (offering.hours_missing) {
      addWarning(warnings, {
        type: "subject_missing_hours",
        entity_type: "subject_offering",
        entity_legacy_id: offering.legacy_id,
        message: `${offering.class_name} / ${offering.name} mangler timetal.`
      });
    }
    const assignmentCount = teachingAssignments.filter((assignment) => assignment.subject_offering_legacy_id === offering.legacy_id).length;
    if (!assignmentCount) {
      addWarning(warnings, {
        type: "subject_missing_teacher_assignment",
        entity_type: "subject_offering",
        entity_legacy_id: offering.legacy_id,
        message: `${offering.class_name} / ${offering.name} har ingen fagfordeling endnu.`
      });
    }
  }

  return {
    metadata: {
      seed_path: seedPath,
      excel_path: excelPath,
      source_metadata: seedData.metadata || null,
      workbook_sheets: workbookData?.workbook.SheetNames || []
    },
    campuses: [...campusesByName.values()].sort((a, b) => a.name.localeCompare(b.name, "da")),
    teachers: [...teachersByInitials.values()].sort((a, b) => a.initials.localeCompare(b.initials, "da")),
    rooms: [...roomsByLegacy.values()].sort((a, b) => `${a.campus_name} ${a.name}`.localeCompare(`${b.campus_name} ${b.name}`, "da")),
    classes: [...classesByLegacy.values()].sort((a, b) => a.name.localeCompare(b.name, "da")),
    subjects: [...subjectsByKey.values()].sort((a, b) => a.name.localeCompare(b.name, "da")),
    competencies,
    unavailableDays,
    activeWeeks,
    educationRequirements,
    subjectOfferings,
    teachingAssignments,
    teacherSuggestions,
    pairingGroups,
    hourRules,
    warnings
  };
}

function buildCompetencies(seedData, workbookData, teachersByInitials, subjectsByKey) {
  const rows = [];
  for (const teacher of seedData.teachers || []) {
    const initials = clean(teacher.name);
    for (const detail of teacher.skillDetails || []) {
      const subjectName = canonicalSubjectName(detail.subject);
      const subjectKey = normalizedKey(subjectName);
      if (!subjectName || !subjectsByKey.has(subjectKey)) {
        continue;
      }
      rows.push({
        teacher_legacy_id: teacher.id,
        teacher_initials: initials,
        course_subject_key: subjectKey,
        course_subject_name: subjectsByKey.get(subjectKey).name,
        level: ["primary", "secondary", "certified"].includes(detail.level) ? detail.level : "primary",
        source: "seed-data.js",
        metadata: { source: "seed-data.js:teacher.skillDetails" }
      });
    }
  }

  const excelCompetencies = parseCompetenciesFromExcel(workbookData);
  for (const item of excelCompetencies.competencies) {
    const teacher = teachersByInitials.get(item.teacher_initials);
    rows.push({
      ...item,
      teacher_legacy_id: teacher?.legacy_id || item.teacher_legacy_id
    });
  }

  return uniqueBy(rows, (row) => `${row.teacher_legacy_id}|${row.course_subject_key}|${row.level}`)
    .sort((a, b) => `${a.teacher_initials} ${a.course_subject_name} ${a.level}`.localeCompare(`${b.teacher_initials} ${b.course_subject_name} ${b.level}`, "da"));
}

function buildUnavailableDays(seedData, teachersByLegacy, warnings) {
  const rows = [];
  for (const teacher of seedData.teachers || []) {
    const blockedDays = teacher.blockedDays || teacher.unavailableDays || [];
    if (!Array.isArray(blockedDays)) {
      continue;
    }
    for (const day of blockedDays) {
      const dayNo = numberValue(day);
      if (dayNo == null || dayNo < 0 || dayNo > 6) {
        addWarning(warnings, {
          type: "teacher_unavailable_day_invalid",
          entity_type: "teacher_unavailable_days",
          entity_legacy_id: teacher.id,
          message: `${teacher.name || teacher.id} har en ugyldig fridag/sp\u00e6rredag: ${day}.`
        });
        continue;
      }
      rows.push({
        teacher_legacy_id: teacher.id,
        teacher_initials: teachersByLegacy.get(teacher.id)?.initials || clean(teacher.name),
        day_of_week: dayNo,
        reason: "prototype_blocked_day"
      });
    }
  }
  return uniqueBy(rows, (row) => `${row.teacher_legacy_id}|${row.day_of_week}`);
}

function buildActiveWeeks(seedData, workbookData, classesByLegacy) {
  const rows = [];
  for (const klass of seedData.classes || []) {
    for (const weekNo of klass.activeWeeks || []) {
      rows.push({
        class_legacy_id: klass.id,
        class_name: klass.name,
        week_no: Number(weekNo),
        source: "seed-data.js"
      });
    }
  }
  rows.push(...parseActiveWeeksFromExcel(workbookData).filter((row) => classesByLegacy.has(row.class_legacy_id)));
  return uniqueBy(rows, (row) => `${row.class_legacy_id}|${row.week_no}`)
    .sort((a, b) => a.class_name.localeCompare(b.class_name, "da") || a.week_no - b.week_no);
}

function buildSubjectOfferings(seedData, subjectsByKey, classesByLegacy, warnings) {
  const rows = [];
  for (const subject of seedData.subjects || []) {
    const klass = classesByLegacy.get(subject.classId);
    const subjectName = canonicalSubjectName(subject.name);
    const subjectKey = normalizedKey(subjectName);
    if (!klass) {
      addWarning(warnings, {
        type: "subject_class_not_found",
        entity_type: "subject_offering",
        entity_legacy_id: subject.id,
        message: `Faget "${subject.name}" peger p\u00e5 ukendt hold-id ${subject.classId}.`
      });
      continue;
    }
    if (!subjectsByKey.has(subjectKey)) {
      subjectsByKey.set(subjectKey, {
        name: subjectName,
        normalized_key: subjectKey,
        metadata: { source: "seed-data.js:subjects" }
      });
    }
    const totalHours = numberValue(subject.totalHours) || 0;
    rows.push({
      legacy_id: subject.id,
      class_legacy_id: subject.classId,
      class_name: klass.name,
      campus_name: klass.campus_name,
      course_subject_key: subjectKey,
      name: subjectsByKey.get(subjectKey).name,
      total_hours: totalHours,
      hours_missing: totalHours <= 0,
      hours_source: subject.hoursSource || null,
      period_value: numberValue(subject.periodValue) || klass.default_period_weeks || 1,
      period_unit: subject.periodUnit === "days" ? "days" : "weeks",
      start_week: numberValue(subject.startWeek) || klass.activeWeeks?.[0] || 1,
      priority: derivePriority(subject),
      pairing_legacy_id: subject.pairingId || null,
      sort_order: rows.length + 1,
      metadata: {
        source: subject.source || "seed-data.js",
        suggested_teacher_ids: subject.suggestedTeacherIds || [],
        original_teacher_id: subject.teacherId || null,
        combined_teaching_group_key: klass.metadata?.combined_teaching_group_key
          ? `${klass.metadata.combined_teaching_group_key}:${fold(klass.campus_name)}:${subjectKey}`
          : null,
        cohort_type: klass.metadata?.cohort_type || null,
        possible_cohort_types: klass.metadata?.possible_cohort_types || []
      }
    });
  }
  return rows;
}

function buildPairingGroups(subjects) {
  const pairings = new Map();
  for (const subject of subjects) {
    if (!subject.pairingId) {
      continue;
    }
    if (!pairings.has(subject.pairingId)) {
      pairings.set(subject.pairingId, {
        legacy_pairing_id: subject.pairingId,
        name: `Sammenl\u00e6sning ${subject.pairingId}`,
        metadata: { source: "seed-data.js:subjects.pairingId" }
      });
    }
  }
  return [...pairings.values()].sort((a, b) => a.legacy_pairing_id.localeCompare(b.legacy_pairing_id, "da"));
}

function buildTeachingAssignments(seedData, workbookAssignments, subjectOfferings, teachersByInitials, competencies, warnings) {
  const rows = [];
  const offeringsByLegacy = new Map(subjectOfferings.map((offering) => [offering.legacy_id, offering]));
  const offeringsByCampusSubject = new Map();
  for (const offering of subjectOfferings) {
    const key = `${fold(offering.campus_name)}|${offering.course_subject_key}`;
    if (!offeringsByCampusSubject.has(key)) {
      offeringsByCampusSubject.set(key, []);
    }
    offeringsByCampusSubject.get(key).push(offering);
  }

  for (const subject of seedData.subjects || []) {
    const offering = offeringsByLegacy.get(subject.id);
    if (!offering) {
      continue;
    }
    const teacherIds = Array.isArray(subject.teacherIds) && subject.teacherIds.length
      ? subject.teacherIds
      : [subject.teacherId].filter(Boolean);
    teacherIds.forEach((teacherLegacyId, index) => {
      rows.push({
        subject_offering_legacy_id: subject.id,
        subject_label: `${offering.class_name} / ${offering.name}`,
        teacher_legacy_id: teacherLegacyId,
        teacher_initials: null,
        assignment_order: index + 1,
        share_fraction: null,
        role: index === 0 ? "primary" : "co_teacher",
        source: "seed-data.js"
      });
    });
  }

  for (const assignment of workbookAssignments) {
    const key = `${fold(assignment.campus_name)}|${assignment.course_subject_key}`;
    const matches = offeringsByCampusSubject.get(key) || [];
    if (!matches.length) {
      addWarning(warnings, {
        type: "assignment_subject_not_found",
        source: "excel",
        source_sheet: assignment.source_sheet,
        source_row: assignment.source_row,
        entity_type: "teaching_assignment",
        entity_legacy_id: `${assignment.campus_name}:${assignment.course_subject_name}:${assignment.teacher_initials}`,
        message: `Fagfordeling for ${assignment.course_subject_name} i ${assignment.campus_name} kunne ikke matches til et konkret hold/fag.`
      });
      continue;
    }
    for (const offering of matches) {
      rows.push({
        subject_offering_legacy_id: offering.legacy_id,
        subject_label: `${offering.class_name} / ${offering.name}`,
        teacher_legacy_id: assignment.teacher_legacy_id,
        teacher_initials: assignment.teacher_initials,
        assignment_order: 1,
        share_fraction: null,
        role: "assigned",
        source: "excel_fagfordeling",
        metadata: {
          source_sheet: assignment.source_sheet,
          source_row: assignment.source_row
        }
      });
    }
  }

  const deduped = uniqueBy(rows, (row) => `${row.subject_offering_legacy_id}|${row.teacher_legacy_id}`);
  const grouped = countBy(deduped, (row) => row.subject_offering_legacy_id);
  const orderCounter = new Map();
  const competencyKeys = new Set(competencies.map((row) => `${row.teacher_legacy_id}|${row.course_subject_key}`));
  const offeringByLegacy = new Map(subjectOfferings.map((offering) => [offering.legacy_id, offering]));

  for (const row of deduped) {
    const nextOrder = (orderCounter.get(row.subject_offering_legacy_id) || 0) + 1;
    orderCounter.set(row.subject_offering_legacy_id, nextOrder);
    row.assignment_order = nextOrder;
    row.share_fraction = Number((1 / grouped[row.subject_offering_legacy_id]).toFixed(5));

    const teacher = [...teachersByInitials.values()].find((item) => item.legacy_id === row.teacher_legacy_id);
    if (teacher) {
      row.teacher_initials = row.teacher_initials || teacher.initials;
    }
    const offering = offeringByLegacy.get(row.subject_offering_legacy_id);
    if (offering && !competencyKeys.has(`${row.teacher_legacy_id}|${offering.course_subject_key}`)) {
      addWarning(warnings, {
        type: "teacher_missing_competency",
        entity_type: "teacher_competency",
        entity_legacy_id: `${row.teacher_legacy_id}:${offering.course_subject_key}`,
        message: `${row.teacher_initials || row.teacher_legacy_id} er fagfordelt p\u00e5 ${offering.class_name} / ${offering.name}, men har ikke registreret kompetence p\u00e5 faget.`
      });
    }
  }

  return deduped.sort((a, b) => a.subject_label.localeCompare(b.subject_label, "da") || a.assignment_order - b.assignment_order);
}

function buildTeacherSuggestions(seedData, subjectOfferings, teachersByLegacy, warnings) {
  const rows = [];
  const offeringsByLegacy = new Map(subjectOfferings.map((offering) => [offering.legacy_id, offering]));
  for (const subject of seedData.subjects || []) {
    const offering = offeringsByLegacy.get(subject.id);
    if (!offering) {
      continue;
    }
    for (const teacherLegacyId of subject.suggestedTeacherIds || []) {
      if (!teachersByLegacy.has(teacherLegacyId)) {
        addWarning(warnings, {
          type: "suggested_teacher_not_found",
          entity_type: "teacher_suggestion",
          entity_legacy_id: `${subject.id}:${teacherLegacyId}`,
          message: `Forsl\u00e5et l\u00e6rer ${teacherLegacyId} findes ikke for ${offering.class_name} / ${offering.name}.`
        });
        continue;
      }
      rows.push({
        subject_offering_legacy_id: subject.id,
        subject_label: `${offering.class_name} / ${offering.name}`,
        teacher_legacy_id: teacherLegacyId,
        reason: "prototype_suggested_teacher",
        source: "seed-data.js:suggestedTeacherIds"
      });
    }
  }
  return uniqueBy(rows, (row) => `${row.subject_offering_legacy_id}|${row.teacher_legacy_id}`);
}

function buildEducationRequirements(subjectOfferings, classesByLegacy, subjectsByKey) {
  return subjectOfferings.map((offering) => {
    const klass = classesByLegacy.get(offering.class_legacy_id);
    const bounds = moduleBounds(offering.total_hours, offering.period_value);
    return {
      requirement_key: `${offering.class_legacy_id}:${offering.course_subject_key}`,
      class_legacy_id: offering.class_legacy_id,
      class_name: offering.class_name,
      education_program_code: klass?.education_program_code || null,
      class_category_key: klass?.class_category_key || null,
      course_subject_key: offering.course_subject_key,
      course_subject_name: subjectsByKey.get(offering.course_subject_key)?.name || offering.name,
      total_hours: offering.total_hours || null,
      weekly_hours: bounds.weeklyHours,
      required_weeks: null,
      required_weeks_source: "class_active_weeks",
      min_modules_per_week: bounds.min,
      max_modules_per_week: bounds.max,
      preferred_module_type: null,
      preferred_room_type: "standard_classroom",
      requires_primary_competency: true,
      requires_certified_competency: false,
      priority: offering.priority,
      notes: offering.hours_missing ? "Timetal mangler i prototype-/Excelgrundlaget." : null,
      metadata: {
        source: "seed-data.js:subjects",
        subject_offering_legacy_id: offering.legacy_id,
        period_value: offering.period_value,
        period_unit: offering.period_unit,
        start_week: offering.start_week,
        combined_teaching_group_key: offering.metadata?.combined_teaching_group_key || null,
        cohort_type: offering.metadata?.cohort_type || null,
        possible_cohort_types: offering.metadata?.possible_cohort_types || []
      }
    };
  });
}

function weekRangeLabel(weeks) {
  const sorted = [...new Set(weeks.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const ranges = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index < sorted.length; index += 1) {
    const week = sorted[index];
    if (week === previous + 1) {
      previous = week;
      continue;
    }
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    start = week;
    previous = week;
  }
  ranges.push(start === previous ? String(start) : `${start}-${previous}`);
  return ranges.join(", ");
}

function teacherInitialsByLegacy(model) {
  return new Map(model.teachers.map((teacher) => [teacher.legacy_id, teacher.initials]));
}

function classReviewList(model) {
  const activeWeeksByClass = new Map();
  for (const week of model.activeWeeks) {
    if (!activeWeeksByClass.has(week.class_legacy_id)) {
      activeWeeksByClass.set(week.class_legacy_id, []);
    }
    activeWeeksByClass.get(week.class_legacy_id).push(week.week_no);
  }

  const offeringsByClass = countBy(model.subjectOfferings, (offering) => offering.class_legacy_id);

  return model.classes.map((klass) => {
    const weeks = activeWeeksByClass.get(klass.legacy_id) || [];
    const warningCount = model.warnings.filter((warning) => (
      warning.entity_legacy_id === klass.legacy_id
      || String(warning.message || "").includes(`${klass.name} /`)
      || String(warning.message || "").includes(`p\u00e5 ${klass.name} /`)
    )).length;

    return {
      legacy_id: klass.legacy_id,
      name: klass.name,
      normalized_name: normalizedKey(klass.name),
      inferred_category_key: klass.class_category_key || null,
      inferred_education_program_code: klass.education_program_code || null,
      possible_category: klass.metadata?.possible_category || null,
      possible_category_keys: klass.metadata?.possible_category_keys || [],
      possible_program_codes: klass.metadata?.possible_program_codes || [],
      common_education_program_code: klass.metadata?.common_education_program_code || klass.education_program_code || null,
      cohort_type: klass.metadata?.cohort_type || null,
      cohort_label: klass.metadata?.cohort_label || null,
      possible_cohort_types: klass.metadata?.possible_cohort_types || [],
      cohort_confidence: klass.metadata?.cohort_confidence || null,
      combined_teaching_group_key: klass.metadata?.combined_teaching_group_key || null,
      category_confidence: klass.metadata?.category_confidence || "unknown",
      address: klass.address_label || null,
      campus: klass.campus_name || null,
      active_weeks_count: weeks.length,
      active_weeks_range: weekRangeLabel(weeks),
      subject_offerings_count: offeringsByClass[klass.legacy_id] || 0,
      warning_count: warningCount
    };
  });
}

function possibleHoursMatches(offering, model) {
  const klass = model.classes.find((item) => item.legacy_id === offering.class_legacy_id);
  const classProgram = klass?.education_program_code || null;
  const exact = model.hourRules.filter((rule) => rule.course_subject_key === offering.course_subject_key);
  const foldedName = fold(offering.name);
  const fuzzy = model.hourRules.filter((rule) => (
    rule.course_subject_key !== offering.course_subject_key
    && (fold(rule.course_subject_name).includes(foldedName) || foldedName.includes(fold(rule.course_subject_name)))
  ));

  return [...exact, ...fuzzy]
    .map((rule) => ({
      hold_type: rule.hold_type,
      program_code: rule.program_code,
      subject_name: rule.course_subject_name,
      total_hours: rule.total_hours,
      match_reason: rule.course_subject_key === offering.course_subject_key
        ? (rule.program_code && rule.program_code === classProgram ? "same_subject_and_program" : "same_subject")
        : "similar_subject"
    }))
    .sort((a, b) => {
      const score = (item) => item.match_reason === "same_subject_and_program" ? 0 : item.match_reason === "same_subject" ? 1 : 2;
      return score(a) - score(b) || String(a.hold_type).localeCompare(String(b.hold_type), "da");
    })
    .slice(0, 5);
}

function missingHoursOfferings(model) {
  return model.subjectOfferings
    .filter((offering) => offering.hours_missing)
    .map((offering) => ({
      class_name: offering.class_name,
      subject_name: offering.name,
      subject_key: offering.course_subject_key,
      current_total_hours: offering.total_hours,
      hours_source: offering.hours_source,
      possible_hours_matches: possibleHoursMatches(offering, model),
      warning_message: `${offering.class_name} / ${offering.name} mangler timetal.`
    }));
}

function offeringsWithoutAssignmentsDetail(model) {
  const initialsByLegacy = teacherInitialsByLegacy(model);
  const assignmentsByOffering = new Set(model.teachingAssignments.map((assignment) => assignment.subject_offering_legacy_id));
  const suggestionsByOffering = new Map();
  for (const suggestion of model.teacherSuggestions) {
    if (!suggestionsByOffering.has(suggestion.subject_offering_legacy_id)) {
      suggestionsByOffering.set(suggestion.subject_offering_legacy_id, []);
    }
    suggestionsByOffering.get(suggestion.subject_offering_legacy_id).push(initialsByLegacy.get(suggestion.teacher_legacy_id) || suggestion.teacher_legacy_id);
  }
  const competenciesBySubject = new Map();
  for (const competency of model.competencies) {
    if (!competenciesBySubject.has(competency.course_subject_key)) {
      competenciesBySubject.set(competency.course_subject_key, []);
    }
    competenciesBySubject.get(competency.course_subject_key).push(competency.teacher_initials);
  }

  return model.subjectOfferings
    .filter((offering) => !assignmentsByOffering.has(offering.legacy_id))
    .map((offering) => ({
      class_name: offering.class_name,
      subject_name: offering.name,
      suggested_teacher_initials: uniqueBy(suggestionsByOffering.get(offering.legacy_id) || [], (value) => value),
      competent_teacher_initials: uniqueBy(competenciesBySubject.get(offering.course_subject_key) || [], (value) => value).sort((a, b) => a.localeCompare(b, "da")),
      warning_message: `${offering.class_name} / ${offering.name} har ingen fagfordeling endnu.`
    }));
}

function assignmentsWithoutCompetency(model) {
  const initialsByLegacy = teacherInitialsByLegacy(model);
  const offeringByLegacy = new Map(model.subjectOfferings.map((offering) => [offering.legacy_id, offering]));
  const competencyKeys = new Set(model.competencies.map((competency) => `${competency.teacher_legacy_id}|${competency.course_subject_key}`));
  const suggestedKeys = new Set(model.teacherSuggestions.map((suggestion) => `${suggestion.subject_offering_legacy_id}|${suggestion.teacher_legacy_id}`));

  return model.teachingAssignments
    .map((assignment) => {
      const offering = offeringByLegacy.get(assignment.subject_offering_legacy_id);
      if (!offering) {
        return null;
      }
      const competencyKey = `${assignment.teacher_legacy_id}|${offering.course_subject_key}`;
      if (competencyKeys.has(competencyKey)) {
        return null;
      }
      const teacherInitials = assignment.teacher_initials || initialsByLegacy.get(assignment.teacher_legacy_id) || assignment.teacher_legacy_id;
      return {
        class_name: offering.class_name,
        subject_name: offering.name,
        teacher_initials: teacherInitials,
        whether_teacher_was_suggested: suggestedKeys.has(`${assignment.subject_offering_legacy_id}|${assignment.teacher_legacy_id}`),
        warning_message: `${teacherInitials} er fagfordelt p\u00e5 ${offering.class_name} / ${offering.name}, men har ikke registreret kompetence p\u00e5 faget.`
      };
    })
    .filter(Boolean);
}

function classCategoryLabel(klass) {
  if (klass.class_category_key) {
    return klass.class_category_key;
  }
  if (klass.metadata?.possible_category) {
    return `possible:${klass.metadata.possible_category}`;
  }
  return "missing";
}

function summarize(model, sampleSize) {
  const classReview = classReviewList(model);
  const missingHours = missingHoursOfferings(model);
  const missingAssignments = offeringsWithoutAssignmentsDetail(model);
  const assignmentsMissingCompetency = assignmentsWithoutCompetency(model);
  const uncertainClasses = classReview.filter((klass) => klass.category_confidence !== "high");

  return {
    teachers_found: model.teachers.length,
    classes_found: model.classes.length,
    rooms_found: model.rooms.length,
    subjects_found: model.subjects.length,
    competencies_found: model.competencies.length,
    teacher_unavailable_days_found: model.unavailableDays.length,
    active_weeks_found: model.activeWeeks.length,
    requirements_found: model.educationRequirements.length,
    subject_offerings_found: model.subjectOfferings.length,
    teaching_assignments_found: model.teachingAssignments.length,
    teacher_suggestions_found: model.teacherSuggestions.length,
    pairing_groups_found: model.pairingGroups.length,
    warnings_found: model.warnings.length,
    sources: model.metadata,
    classes_by_category: countBy(model.classes, classCategoryLabel),
    classes_by_category_key: countBy(model.classes, (row) => row.class_category_key || "missing"),
    classes_with_uncertain_category: uncertainClasses.length,
    missing_hours_by_class: countBy(missingHours, (offering) => offering.class_name),
    missing_assignments_by_class: countBy(missingAssignments, (offering) => offering.class_name),
    assignments_without_competency_count: assignmentsMissingCompetency.length,
    offerings_with_missing_hours: model.subjectOfferings.filter((row) => row.hours_missing).length,
    offerings_without_assignments: model.subjectOfferings.filter((offering) => (
      !model.teachingAssignments.some((assignment) => assignment.subject_offering_legacy_id === offering.legacy_id)
    )).length,
    class_review: classReview,
    missing_hours_offerings: missingHours,
    offerings_without_assignments_detail: missingAssignments,
    assignments_without_competency: assignmentsMissingCompetency,
    sample_teachers: model.teachers.slice(0, sampleSize),
    sample_classes: model.classes.slice(0, sampleSize),
    sample_subject_offerings: model.subjectOfferings.slice(0, sampleSize),
    sample_warnings: model.warnings.slice(0, sampleSize)
  };
}

class SupabaseRest {
  constructor({ url, key }) {
    this.url = url.replace(/\/+$/, "");
    this.key = key;
  }

  async request(method, table, { query = {}, body = null, prefer = null } = {}) {
    if (!ALLOWED_TARGET_TABLES.has(table) && !["organizations", "schools", "class_categories", "education_programs", "room_types"].includes(table)) {
      throw new Error(`Importscriptet m\u00e5 ikke skrive til eller l\u00e6se ukendt tabel: ${table}`);
    }
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
      throw new Error(`${method} ${table} fejlede: ${response.status} ${text}`);
    }
    return data;
  }

  select(table, query) {
    return this.request("GET", table, { query });
  }

  insert(table, body) {
    return this.request("POST", table, { body, prefer: "return=representation" });
  }

  upsert(table, body, onConflict) {
    return this.request("POST", table, {
      query: { on_conflict: onConflict },
      body,
      prefer: "resolution=merge-duplicates,return=representation"
    });
  }

  patch(table, query, body) {
    return this.request("PATCH", table, {
      query,
      body,
      prefer: "return=representation"
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
    throw new Error(`Fandt ikke organization med slug ${organizationSlug}. K\u00f8r migration 004/seed f\u00f8rst.`);
  }
  const schools = await client.select("schools", {
    select: "id,slug,name,organization_id",
    organization_id: `eq.${organizations[0].id}`,
    slug: `eq.${schoolSlug}`,
    limit: "1"
  });
  if (!schools.length) {
    throw new Error(`Fandt ikke school med slug ${schoolSlug}. K\u00f8r migration 004/seed f\u00f8rst.`);
  }
  return schools[0];
}

async function ensureDataImport(client, schoolId, model) {
  const existing = await client.select("data_imports", {
    select: "id",
    school_id: `eq.${schoolId}`,
    source_kind: "eq.prototype_seed",
    source_name: "eq.stamdata",
    import_version: `eq.${IMPORT_VERSION}`,
    limit: "1"
  });
  if (existing.length) {
    await client.patch("data_imports", { id: `eq.${existing[0].id}` }, {
      metadata: {
        parser: "import-stamdata.mjs",
        updated_summary: summarize(model, 0),
        sources: model.metadata
      }
    });
    return existing[0].id;
  }
  const [row] = await client.insert("data_imports", [{
    school_id: schoolId,
    source_kind: "prototype_seed",
    source_name: "stamdata",
    import_version: IMPORT_VERSION,
    metadata: {
      parser: "import-stamdata.mjs",
      summary: summarize(model, 0),
      sources: model.metadata
    }
  }]);
  return row.id;
}

async function loadDatabaseLookups(client, schoolId) {
  const [
    campuses,
    teachers,
    roomTypes,
    categories,
    programs,
    rooms,
    classes,
    subjects,
    offerings,
    pairings
  ] = await Promise.all([
    client.select("campuses", { select: "id,name", school_id: `eq.${schoolId}` }),
    client.select("teachers", { select: "id,legacy_id,initials", school_id: `eq.${schoolId}` }),
    client.select("room_types", { select: "id,code,name", school_id: `eq.${schoolId}` }),
    client.select("class_categories", { select: "id,normalized_key,name", school_id: `eq.${schoolId}` }),
    client.select("education_programs", { select: "id,code,name", school_id: `eq.${schoolId}` }),
    client.select("rooms", { select: "id,legacy_id,name,campus_id", school_id: `eq.${schoolId}` }),
    client.select("class_groups", { select: "id,legacy_id,name", school_id: `eq.${schoolId}` }),
    client.select("course_subjects", { select: "id,name,normalized_key", school_id: `eq.${schoolId}` }),
    client.select("subject_offerings", { select: "id,legacy_id", school_id: `eq.${schoolId}` }),
    client.select("subject_pairing_groups", { select: "id,legacy_pairing_id", school_id: `eq.${schoolId}` })
  ]);

  return {
    campusByName: new Map(campuses.map((row) => [fold(row.name), row.id])),
    teacherByLegacy: new Map(teachers.filter((row) => row.legacy_id).map((row) => [row.legacy_id, row.id])),
    teacherByInitials: new Map(teachers.map((row) => [clean(row.initials), row.id])),
    roomTypeByCode: new Map(roomTypes.map((row) => [String(row.code), row.id])),
    categoryByKey: new Map(categories.map((row) => [row.normalized_key || normalizedKey(row.name), row.id])),
    programByCode: new Map(programs.map((row) => [String(row.code), row.id])),
    roomByLegacy: new Map(rooms.filter((row) => row.legacy_id).map((row) => [row.legacy_id, row.id])),
    classByLegacy: new Map(classes.filter((row) => row.legacy_id).map((row) => [row.legacy_id, row.id])),
    subjectByKey: new Map(subjects.map((row) => [row.normalized_key || normalizedKey(row.name), row.id])),
    offeringByLegacy: new Map(offerings.filter((row) => row.legacy_id).map((row) => [row.legacy_id, row.id])),
    pairingByLegacy: new Map(pairings.filter((row) => row.legacy_pairing_id).map((row) => [row.legacy_pairing_id, row.id]))
  };
}

async function refreshLookups(client, schoolId, oldLookups = {}) {
  return {
    ...oldLookups,
    ...(await loadDatabaseLookups(client, schoolId))
  };
}

async function importModel(client, schoolId, model) {
  const dataImportId = await ensureDataImport(client, schoolId, model);
  let lookups = await loadDatabaseLookups(client, schoolId);

  await upsertCampuses(client, schoolId, model.campuses);
  lookups = await refreshLookups(client, schoolId, lookups);
  await upsertTeachers(client, schoolId, dataImportId, model.teachers);
  await upsertSubjects(client, schoolId, model.subjects);
  lookups = await refreshLookups(client, schoolId, lookups);
  await upsertRooms(client, schoolId, model.rooms, lookups);
  lookups = await refreshLookups(client, schoolId, lookups);
  await upsertClasses(client, schoolId, model.classes, lookups);
  lookups = await refreshLookups(client, schoolId, lookups);
  await upsertActiveWeeks(client, schoolId, model.activeWeeks, lookups);
  await upsertCompetencies(client, schoolId, dataImportId, model.competencies, lookups);
  await upsertTeacherUnavailableDays(client, schoolId, model.unavailableDays, lookups);
  await upsertPairings(client, schoolId, model.pairingGroups);
  lookups = await refreshLookups(client, schoolId, lookups);
  await upsertOfferings(client, schoolId, model.subjectOfferings, lookups);
  lookups = await refreshLookups(client, schoolId, lookups);
  await upsertRequirements(client, schoolId, dataImportId, model.educationRequirements, lookups, model.activeWeeks);
  await upsertTeachingAssignments(client, schoolId, dataImportId, model.teachingAssignments, lookups);
  await upsertTeacherSuggestions(client, schoolId, dataImportId, model.teacherSuggestions, lookups);
  const warningsInserted = await insertWarnings(client, schoolId, dataImportId, model.warnings);

  return {
    data_import_id: dataImportId,
    campuses_written: model.campuses.length,
    teachers_written: model.teachers.length,
    rooms_written: model.rooms.length,
    classes_written: model.classes.length,
    subjects_written: model.subjects.length,
    competencies_written: model.competencies.length,
    teacher_unavailable_days_written: model.unavailableDays.length,
    active_weeks_written: model.activeWeeks.length,
    requirements_written: model.educationRequirements.length,
    subject_offerings_written: model.subjectOfferings.length,
    teaching_assignments_written: model.teachingAssignments.length,
    teacher_suggestions_written: model.teacherSuggestions.length,
    pairing_groups_written: model.pairingGroups.length,
    warnings_inserted: warningsInserted
  };
}

async function upsertCampuses(client, schoolId, campuses) {
  const rows = campuses.map((campus) => ({
    school_id: schoolId,
    name: campus.name,
    legacy_label: campus.legacy_label || campus.name,
    metadata: campus.metadata || {}
  }));
  for (const chunk of chunks(rows, 200)) {
    if (chunk.length) {
      await client.upsert("campuses", chunk, "school_id,name");
    }
  }
}

async function upsertTeachers(client, schoolId, dataImportId, teachers) {
  const rows = teachers.map((teacher) => ({
    school_id: schoolId,
    legacy_id: teacher.legacy_id,
    initials: teacher.initials,
    display_name: teacher.display_name || teacher.initials,
    skills_summary: teacher.skills_summary || null,
    metadata: { ...(teacher.metadata || {}), source_import_id: dataImportId }
  }));
  for (const chunk of chunks(rows, 200)) {
    if (chunk.length) {
      await client.upsert("teachers", chunk, "school_id,initials");
    }
  }
}

async function upsertSubjects(client, schoolId, subjects) {
  const rows = subjects.map((subject) => ({
    school_id: schoolId,
    name: subject.name,
    normalized_key: subject.normalized_key,
    metadata: subject.metadata || {}
  }));
  for (const chunk of chunks(rows, 200)) {
    if (chunk.length) {
      await client.upsert("course_subjects", chunk, "school_id,name");
    }
  }
}

async function upsertRooms(client, schoolId, rooms, lookups) {
  const rows = rooms.map((room) => ({
    school_id: schoolId,
    campus_id: lookups.campusByName.get(fold(room.campus_name)) || null,
    legacy_id: room.legacy_id,
    name: room.name,
    address_label: room.address_label || room.campus_name || "Ukendt",
    room_type_id: room.room_type_code ? lookups.roomTypeByCode.get(room.room_type_code) || null : null,
    metadata: room.metadata || {}
  }));
  for (const row of rows) {
    const existingId = lookups.roomByLegacy.get(row.legacy_id);
    if (existingId) {
      await client.patch("rooms", { id: `eq.${existingId}` }, row);
    } else {
      await client.insert("rooms", [row]);
    }
  }
}

async function upsertClasses(client, schoolId, classes, lookups) {
  for (const klass of classes) {
    const row = {
      school_id: schoolId,
      campus_id: lookups.campusByName.get(fold(klass.campus_name)) || null,
      legacy_id: klass.legacy_id,
      name: klass.name,
      address_label: klass.address_label || klass.campus_name || "Ukendt",
      default_period_weeks: klass.default_period_weeks || null,
      class_category_id: klass.class_category_key ? lookups.categoryByKey.get(klass.class_category_key) || null : null,
      education_program_id: klass.education_program_code ? lookups.programByCode.get(klass.education_program_code) || null : null,
      planning_notes: klass.planning_notes || null,
      scheduling_notes: klass.scheduling_notes || null,
      metadata: klass.metadata || {}
    };
    const existingId = lookups.classByLegacy.get(row.legacy_id);
    if (existingId) {
      await client.patch("class_groups", { id: `eq.${existingId}` }, row);
    } else {
      await client.insert("class_groups", [row]);
    }
  }
}

async function upsertActiveWeeks(client, schoolId, activeWeeks, lookups) {
  const rows = activeWeeks
    .map((item) => ({
      school_id: schoolId,
      class_group_id: lookups.classByLegacy.get(item.class_legacy_id),
      week_no: item.week_no
    }))
    .filter((row) => row.class_group_id && row.week_no);
  for (const chunk of chunks(rows, 500)) {
    if (chunk.length) {
      await client.upsert("class_active_weeks", chunk, "class_group_id,week_no");
    }
  }
}

async function upsertCompetencies(client, schoolId, dataImportId, competencies, lookups) {
  const rows = competencies
    .map((item) => ({
      school_id: schoolId,
      teacher_id: lookups.teacherByLegacy.get(item.teacher_legacy_id) || lookups.teacherByInitials.get(item.teacher_initials),
      course_subject_id: lookups.subjectByKey.get(item.course_subject_key),
      level: item.level,
      source_import_id: dataImportId,
      metadata: item.metadata || {}
    }))
    .filter((row) => row.teacher_id && row.course_subject_id && row.level);
  for (const chunk of chunks(rows, 500)) {
    if (chunk.length) {
      await client.upsert("teacher_competencies", chunk, "teacher_id,course_subject_id,level");
    }
  }
}

async function upsertTeacherUnavailableDays(client, schoolId, unavailableDays, lookups) {
  const rows = unavailableDays
    .map((item) => ({
      school_id: schoolId,
      teacher_id: lookups.teacherByLegacy.get(item.teacher_legacy_id) || lookups.teacherByInitials.get(item.teacher_initials),
      day_of_week: item.day_of_week,
      reason: item.reason || null
    }))
    .filter((row) => row.teacher_id && row.day_of_week != null);
  for (const chunk of chunks(rows, 500)) {
    if (chunk.length) {
      await client.upsert("teacher_unavailable_days", chunk, "teacher_id,day_of_week");
    }
  }
}

async function upsertPairings(client, schoolId, pairings) {
  for (const pairing of pairings) {
    const existing = await client.select("subject_pairing_groups", {
      select: "id",
      school_id: `eq.${schoolId}`,
      legacy_pairing_id: `eq.${pairing.legacy_pairing_id}`,
      limit: "1"
    });
    const row = {
      school_id: schoolId,
      legacy_pairing_id: pairing.legacy_pairing_id,
      name: pairing.name,
      metadata: pairing.metadata || {}
    };
    if (existing.length) {
      await client.patch("subject_pairing_groups", { id: `eq.${existing[0].id}` }, row);
    } else {
      await client.insert("subject_pairing_groups", [row]);
    }
  }
}

async function upsertOfferings(client, schoolId, offerings, lookups) {
  for (const offering of offerings) {
    const row = {
      school_id: schoolId,
      legacy_id: offering.legacy_id,
      class_group_id: lookups.classByLegacy.get(offering.class_legacy_id),
      course_subject_id: lookups.subjectByKey.get(offering.course_subject_key),
      pairing_group_id: offering.pairing_legacy_id ? lookups.pairingByLegacy.get(offering.pairing_legacy_id) || null : null,
      name: offering.name,
      total_hours: offering.total_hours,
      hours_missing: offering.hours_missing,
      hours_source: offering.hours_source,
      period_value: offering.period_value,
      period_unit: offering.period_unit,
      start_week: offering.start_week,
      priority: offering.priority,
      sort_order: offering.sort_order,
      metadata: offering.metadata || {}
    };
    if (!row.class_group_id || !row.course_subject_id) {
      continue;
    }
    const existingId = lookups.offeringByLegacy.get(row.legacy_id);
    if (existingId) {
      await client.patch("subject_offerings", { id: `eq.${existingId}` }, row);
    } else {
      await client.insert("subject_offerings", [row]);
    }
  }
}

async function upsertRequirements(client, schoolId, dataImportId, requirements, lookups, activeWeeks) {
  const weeksByClass = new Map();
  for (const item of activeWeeks) {
    if (!weeksByClass.has(item.class_legacy_id)) {
      weeksByClass.set(item.class_legacy_id, []);
    }
    weeksByClass.get(item.class_legacy_id).push(item.week_no);
  }
  for (const requirement of requirements) {
    const classGroupId = lookups.classByLegacy.get(requirement.class_legacy_id);
    const courseSubjectId = lookups.subjectByKey.get(requirement.course_subject_key);
    const educationProgramId = requirement.education_program_code ? lookups.programByCode.get(requirement.education_program_code) : null;
    if (!classGroupId || !courseSubjectId || !educationProgramId) {
      continue;
    }
    const existing = await client.select("education_requirements", {
      select: "id",
      school_id: `eq.${schoolId}`,
      class_group_id: `eq.${classGroupId}`,
      course_subject_id: `eq.${courseSubjectId}`,
      limit: "1"
    });
    const row = {
      school_id: schoolId,
      education_program_id: educationProgramId,
      class_category_id: requirement.class_category_key ? lookups.categoryByKey.get(requirement.class_category_key) || null : null,
      class_group_id: classGroupId,
      course_subject_id: courseSubjectId,
      total_hours: requirement.total_hours,
      weekly_hours: requirement.weekly_hours,
      required_weeks: weeksByClass.get(requirement.class_legacy_id) || null,
      min_modules_per_week: requirement.min_modules_per_week,
      max_modules_per_week: requirement.max_modules_per_week,
      preferred_module_type: requirement.preferred_module_type,
      preferred_room_type: requirement.preferred_room_type,
      requires_primary_competency: requirement.requires_primary_competency,
      requires_certified_competency: requirement.requires_certified_competency,
      priority: requirement.priority,
      notes: requirement.notes,
      source_import_id: dataImportId,
      metadata: requirement.metadata || {}
    };
    if (existing.length) {
      await client.patch("education_requirements", { id: `eq.${existing[0].id}` }, row);
    } else {
      await client.insert("education_requirements", [row]);
    }
  }
}

async function upsertTeachingAssignments(client, schoolId, dataImportId, assignments, lookups) {
  const rows = assignments
    .map((assignment) => ({
      school_id: schoolId,
      subject_offering_id: lookups.offeringByLegacy.get(assignment.subject_offering_legacy_id),
      teacher_id: lookups.teacherByLegacy.get(assignment.teacher_legacy_id) || lookups.teacherByInitials.get(assignment.teacher_initials),
      assignment_order: assignment.assignment_order,
      share_fraction: assignment.share_fraction,
      source_import_id: dataImportId,
      metadata: {
        source: assignment.source,
        role: assignment.role,
        ...(assignment.metadata || {})
      }
    }))
    .filter((row) => row.subject_offering_id && row.teacher_id);
  for (const chunk of chunks(rows, 500)) {
    if (chunk.length) {
      await client.upsert("teaching_assignments", chunk, "subject_offering_id,teacher_id");
    }
  }
}

async function upsertTeacherSuggestions(client, schoolId, dataImportId, suggestions, lookups) {
  const rows = suggestions
    .map((suggestion) => ({
      school_id: schoolId,
      subject_offering_id: lookups.offeringByLegacy.get(suggestion.subject_offering_legacy_id),
      teacher_id: lookups.teacherByLegacy.get(suggestion.teacher_legacy_id),
      reason: suggestion.reason,
      source_import_id: dataImportId
    }))
    .filter((row) => row.subject_offering_id && row.teacher_id);
  for (const chunk of chunks(rows, 500)) {
    if (chunk.length) {
      await client.upsert("teacher_suggestions", chunk, "subject_offering_id,teacher_id");
    }
  }
}

async function insertWarnings(client, schoolId, dataImportId, warnings) {
  if (!warnings.length) {
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
    warning_type: warning.type || "stamdata_warning",
    severity: warning.severity || "warning",
    source_sheet: warning.source_sheet || null,
    source_row: warning.source_row || null,
    entity_type: warning.entity_type || "stamdata",
    entity_legacy_id: warning.entity_legacy_id || null,
    message: warning.message,
    resolved: false
  })).filter((row) => !existingKeys.has(warningKey(row)));

  let inserted = 0;
  for (const chunk of chunks(rows, 500)) {
    if (chunk.length) {
      const result = await client.insert("import_warnings", chunk);
      inserted += result.length;
    }
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
  const seedData = loadSeedData(args.seedPath);
  const XLSX = await loadXlsx();
  const excelPath = resolveExcelPath(args);
  const workbookData = loadWorkbook(excelPath, XLSX);
  const model = buildModel(seedData, workbookData, args, XLSX);
  const summary = summarize(model, args.sampleSize);

  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("S\u00e6t SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY f\u00f8r rigtig stamdataimport.");
  }

  const client = new SupabaseRest({ url: supabaseUrl, key: supabaseKey });
  const school = await getSchool(client, args.organizationSlug, args.schoolSlug);
  const importResult = await importModel(client, school.id, model);

  console.log(JSON.stringify({
    ...importResult,
    summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
