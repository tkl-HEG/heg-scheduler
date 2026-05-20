#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const DEFAULT_PERIOD_LABEL = "Efteraar 2026";

const DEFAULT_SOURCES = [
  {
    key: "gf1",
    sourceType: "gf1_calendar",
    filename: "Udkast GF-1 efter\u00e5ret 2026.xlsx",
    appliesTo: ["GF1"],
    classCategoryKey: "gf1",
    programCode: "gf1",
    kind: "xlsx"
  },
  {
    key: "gf2",
    sourceType: "gf2_calendar",
    filename: "Udkast GF-2 efter\u00e5ret 2026 maj 2026.xlsx",
    appliesTo: ["GF2"],
    classCategoryKey: "gf2",
    programCode: "gf2",
    kind: "xlsx"
  },
  {
    key: "staa",
    sourceType: "staa_calendar",
    filename: "Udkast ST\u00c5 efter\u00e5ret 2026.xlsx",
    appliesTo: ["ST\u00c5"],
    classCategoryKey: "staa1",
    programCode: "staa1",
    kind: "xlsx"
  },
  {
    key: "important",
    sourceType: "important_dates_docx",
    filename: "Vigtige datoer for efter\u00e5ret 2026.docx",
    appliesTo: ["Alle"],
    classCategoryKey: null,
    programCode: null,
    kind: "docx"
  }
];

const MONTHS = [
  ["januar", "january", 1],
  ["februar", "february", 2],
  ["marts", "march", 3],
  ["april", "april", 4],
  ["maj", "may", 5],
  ["juni", "june", 6],
  ["juli", "july", 7],
  ["august", "august", 8],
  ["september", "september", 9],
  ["oktober", "october", 10],
  ["november", "november", 11],
  ["december", "december", 12]
];

const WEEKDAYS = new Map([
  ["monday", "Mandag"],
  ["tuesday", "Tirsdag"],
  ["wednesday", "Onsdag"],
  ["thursday", "Torsdag"],
  ["friday", "Fredag"],
  ["saturday", "L\u00f8rdag"],
  ["sunday", "S\u00f8ndag"],
  ["mon", "Mandag"],
  ["tue", "Tirsdag"],
  ["wed", "Onsdag"],
  ["thu", "Torsdag"],
  ["fri", "Fredag"],
  ["sat", "L\u00f8rdag"],
  ["sun", "S\u00f8ndag"],
  ["mandag", "Mandag"],
  ["tirsdag", "Tirsdag"],
  ["onsdag", "Onsdag"],
  ["torsdag", "Torsdag"],
  ["fredag", "Fredag"],
  ["loerdag", "L\u00f8rdag"],
  ["lordag", "L\u00f8rdag"],
  ["soendag", "S\u00f8ndag"],
  ["sondag", "S\u00f8ndag"],
  ["man", "Mandag"],
  ["tir", "Tirsdag"],
  ["ons", "Onsdag"],
  ["tor", "Torsdag"],
  ["fre", "Fredag"]
]);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    sampleSize: 20,
    periodLabel: DEFAULT_PERIOD_LABEL,
    organizationSlug: process.env.ORGANIZATION_SLUG || "heg",
    schoolSlug: process.env.SCHOOL_SLUG || "heg",
    files: new Map()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--sample-size") {
      args.sampleSize = Number(argv[++index]) || 20;
    } else if (arg.startsWith("--sample-size=")) {
      args.sampleSize = Number(arg.slice("--sample-size=".length)) || 20;
    } else if (arg === "--period-label") {
      args.periodLabel = argv[++index];
    } else if (arg.startsWith("--period-label=")) {
      args.periodLabel = arg.slice("--period-label=".length);
    } else if (arg === "--organization-slug") {
      args.organizationSlug = argv[++index];
    } else if (arg.startsWith("--organization-slug=")) {
      args.organizationSlug = arg.slice("--organization-slug=".length);
    } else if (arg === "--school-slug") {
      args.schoolSlug = argv[++index];
    } else if (arg.startsWith("--school-slug=")) {
      args.schoolSlug = arg.slice("--school-slug=".length);
    } else if (arg === "--gf1") {
      args.files.set("gf1", argv[++index]);
    } else if (arg.startsWith("--gf1=")) {
      args.files.set("gf1", arg.slice("--gf1=".length));
    } else if (arg === "--gf2") {
      args.files.set("gf2", argv[++index]);
    } else if (arg.startsWith("--gf2=")) {
      args.files.set("gf2", arg.slice("--gf2=".length));
    } else if (arg === "--staa" || arg === "--stå") {
      args.files.set("staa", argv[++index]);
    } else if (arg.startsWith("--staa=")) {
      args.files.set("staa", arg.slice("--staa=".length));
    } else if (arg.startsWith("--stå=")) {
      args.files.set("staa", arg.slice("--stå=".length));
    } else if (arg === "--important-dates") {
      args.files.set("important", argv[++index]);
    } else if (arg.startsWith("--important-dates=")) {
      args.files.set("important", arg.slice("--important-dates=".length));
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

function fold(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("\u00e6", "ae")
    .replaceAll("\u00f8", "oe")
    .replaceAll("\u00e5", "aa")
    .replaceAll("\u00e9", "e")
    .replaceAll("\u00e8", "e")
    .replaceAll("\u00fc", "u");
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
  if (cell.w != null) {
    return clean(cell.w);
  }
  if (cell.v instanceof Date) {
    return cell.v.toISOString().slice(0, 10);
  }
  return clean(cell.v ?? "");
}

function sheetCell(sheet, row, col, XLSX) {
  return sheet[XLSX.utils.encode_cell({ r: row, c: col })];
}

function findMonth(text) {
  const folded = fold(text).replace(/[^a-z]+/g, "");
  for (const [danish, english, number] of MONTHS) {
    if (folded === fold(danish) || folded === fold(english)) {
      return { monthName: danish.slice(0, 1).toUpperCase() + danish.slice(1), monthNo: number };
    }
  }
  return null;
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
  return date ? date.toISOString().slice(0, 10) : null;
}

function isoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
}

function isoYear(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  return target.getUTCFullYear();
}

function weekdayFromDate(date) {
  return ["S\u00f8ndag", "Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "L\u00f8rdag"][date.getUTCDay()];
}

function parseDay(text) {
  const match = clean(text).match(/^(\d{1,2})(?:\.|\s|$)/);
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

function shouldIgnoreCalendarText(text) {
  const raw = clean(text);
  const folded = fold(raw);
  if (!folded) {
    return true;
  }
  if (findMonth(raw) || parseWeekday(raw)) {
    return true;
  }
  if (/^\d{1,2}\.?$/.test(folded) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(folded)) {
    return true;
  }
  if (/^(dato|dag|uge|u|startaar|startmaaned|kalender navn)$/.test(folded)) {
    return true;
  }
  if (/arbejdsdage/.test(folded)) {
    return true;
  }
  return false;
}

function classifyEvent(rawText, sourceType) {
  const text = fold(rawText);
  const has = (pattern) => pattern.test(text);
  const isStaa = sourceType === "staa_calendar" || /staa|studenter/.test(text);

  if (has(/ferie|juleaften|juledag|hellig|nytaarsdag|paaske|pinsedag|grundlovsdag|kristi/)) {
    return { eventType: "blocked", lockLevel: "hard_block", affectsScheduling: true };
  }
  if (has(/praktik/)) {
    return { eventType: "praktik", lockLevel: "hard_block", affectsScheduling: true };
  }
  if (has(/studietur/)) {
    return { eventType: "study_trip", lockLevel: "hard_block", affectsScheduling: true };
  }
  if (has(/terminsproeve|terminsprove/) || (isStaa && has(/skr\.?\s*dansk|skr\.?\s*engelsk/))) {
    return { eventType: "terminsproeve", lockLevel: "hard_block", affectsScheduling: true };
  }
  if (has(/eksamen|eksamensperiode|eks\b/)) {
    return { eventType: "exam", lockLevel: "hard_block", affectsScheduling: true };
  }
  if (has(/offentliggoerelse|offentliggorelse|offentligg\u00f8relse/)) {
    return { eventType: "publication", lockLevel: has(/proeve|prove|eksamen|eksamensudtraek|udtraek/) ? "warning" : "info", affectsScheduling: has(/proeve|prove|eksamen|eksamensudtraek|udtraek/) };
  }
  if (has(/afgivelse.*karakter|standpunktskarakter|standpunkt|delkarakter|terminsproevekarakter|terminsprovekarakter|indtastning.*karakter/)) {
    return { eventType: "grade_deadline", lockLevel: "warning", affectsScheduling: true };
  }
  if (has(/casearbejdsdag|casedag|casearbejde/)) {
    return { eventType: "case_work", lockLevel: "soft_block", affectsScheduling: true };
  }
  if (has(/\busf\b|mini\s*usf|opstart\s*usf/)) {
    return { eventType: "usf", lockLevel: "soft_block", affectsScheduling: true };
  }
  if (has(/\beop\b/)) {
    return { eventType: "eop", lockLevel: has(/aflevering|deadline|opgaveformulering/) ? "soft_block" : "warning", affectsScheduling: true };
  }
  if (has(/\beo1\b|\beo2\b/)) {
    return { eventType: "eo_assignment", lockLevel: has(/aflevering|deadline/) ? "soft_block" : "warning", affectsScheduling: true };
  }
  if (has(/deadline|aflevering/)) {
    return { eventType: "deadline", lockLevel: "warning", affectsScheduling: true };
  }
  if (has(/fagdag/)) {
    return { eventType: "teaching_activity", lockLevel: "warning", affectsScheduling: true };
  }
  if (has(/virksomhedsbesoeg|virksomhedsbes\u00f8g/)) {
    return { eventType: "teaching_activity", lockLevel: "soft_block", affectsScheduling: true };
  }
  if (has(/translokation/)) {
    return { eventType: "publication", lockLevel: "info", affectsScheduling: false };
  }
  if (has(/portfolio/)) {
    return { eventType: has(/aflevering|deadline/) ? "deadline" : "teaching_activity", lockLevel: has(/aflevering|deadline/) ? "warning" : "info", affectsScheduling: has(/aflevering|deadline/) };
  }
  if (has(/intro|20\s*skarpe|erhvervsfag|privatoekonomi|privat\u00f8konomi|velkom|arbejdsplads|praesent|praes|vfu/)) {
    return { eventType: "teaching_activity", lockLevel: "info", affectsScheduling: false };
  }
  if (has(/valg af|laerer giver|administrationen/)) {
    return { eventType: "deadline", lockLevel: "warning", affectsScheduling: true };
  }
  return { eventType: "info", lockLevel: "info", affectsScheduling: false };
}

function detectAppliesTo(rawText, fallback) {
  const text = fold(rawText);
  const applies = new Set();
  if (/gf\s*-?\s*1|grundforloeb\s*1|grundforl\u00f8b\s*1/.test(text)) applies.add("GF1");
  if (/gf\s*-?\s*2|grundforloeb\s*2|grundforl\u00f8b\s*2/.test(text)) applies.add("GF2");
  if (/staa|st\u00e5|studenter/.test(text)) applies.add("ST\u00c5");
  if (/alle/.test(text)) applies.add("Alle");
  for (const item of fallback || []) applies.add(item);
  return Array.from(applies);
}

function scopeFromApplies(appliesTo, defaultScope) {
  if (appliesTo.includes("Alle")) {
    return { classCategoryKey: null, programCode: null };
  }
  if (appliesTo.includes("GF1")) {
    return { classCategoryKey: "gf1", programCode: "gf1" };
  }
  if (appliesTo.includes("GF2")) {
    return { classCategoryKey: "gf2", programCode: "gf2" };
  }
  if (appliesTo.includes("ST\u00c5")) {
    return { classCategoryKey: "staa1", programCode: "staa1" };
  }
  return { classCategoryKey: defaultScope.classCategoryKey, programCode: defaultScope.programCode };
}

function extractTeacherInitials(text) {
  const initials = [];
  const value = String(text ?? "");
  for (const match of value.matchAll(/\b([A-Z\u00c6\u00d8\u00c5]{2,5}\d?)\s*(?:\/|\+|,|;|&)\s*([A-Z\u00c6\u00d8\u00c5]{2,5}\d?)\b/g)) {
    for (const part of [match[1], match[2]]) {
      if (/^[A-Z\u00c6\u00d8\u00c5]{2,5}\d?$/.test(part) && !initials.includes(part)) {
        initials.push(part);
      }
    }
  }
  return initials;
}

function titleFromText(rawText) {
  return clean(rawText)
    .replace(/^\d{1,2}\s*\.?\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\s*/i, "")
    .replace(/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*/, "")
    .trim() || clean(rawText);
}

function makeEvent({ source, filePath, sourceSheet = null, sourceRow = null, sourceCol = null, cellAddress = null, date = null, rawText, fallbackApplies = null }) {
  const classification = classifyEvent(rawText, source.sourceType);
  const appliesTo = detectAppliesTo(rawText, fallbackApplies || source.appliesTo);
  const scope = scopeFromApplies(appliesTo, source);
  const title = titleFromText(rawText);
  const eventDate = date || null;
  const sourceFile = path.basename(filePath);
  const dedupeKey = slug([
    source.sourceType,
    sourceFile,
    sourceSheet || "docx",
    cellAddress || dateString(eventDate) || sourceRow || "unknown",
    rawText
  ].join("|"));

  return {
    source_type: source.sourceType,
    source_file: sourceFile,
    source_sheet: sourceSheet,
    source_row: sourceRow,
    source_col: sourceCol,
    cell_address: cellAddress,
    dedupe_key: dedupeKey,
    date: dateString(eventDate),
    end_date: null,
    iso_week: eventDate ? isoWeek(eventDate) : null,
    weekday: eventDate ? weekdayFromDate(eventDate) : null,
    title,
    raw_text: clean(rawText),
    event_type: classification.eventType,
    applies_to: appliesTo,
    teacher_initials: extractTeacherInitials(rawText),
    lock_level: classification.lockLevel,
    affects_scheduling: classification.affectsScheduling,
    should_create_booking: false,
    metadata: {
      parser: "import-planning-calendars.mjs",
      period_label: source.periodLabel || DEFAULT_PERIOD_LABEL,
      category_key: scope.classCategoryKey,
      program_code: scope.programCode
    }
  };
}

function findStartYear(sheet, range, XLSX, fallbackYear = 2026) {
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const text = fold(cellText(sheetCell(sheet, row, col, XLSX)));
      if (text === "startaar" || text === "startar") {
        for (let offset = 1; offset <= 3; offset += 1) {
          const year = Number(cellText(sheetCell(sheet, row, col + offset, XLSX)));
          if (year >= 2000 && year <= 2200) {
            return year;
          }
        }
      }
    }
  }
  return fallbackYear;
}

function findStartMonth(sheet, range, XLSX, fallbackMonth = 8) {
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const text = fold(cellText(sheetCell(sheet, row, col, XLSX)));
      if (text === "startmaaned" || text === "startmaned") {
        for (let offset = 1; offset <= 3; offset += 1) {
          const month = findMonth(cellText(sheetCell(sheet, row, col + offset, XLSX)));
          if (month) {
            return month.monthNo;
          }
        }
      }
    }
  }
  return fallbackMonth;
}

function findCalendarMonthHeaders(sheet, range, XLSX) {
  const candidates = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const month = findMonth(cellText(sheetCell(sheet, row, col, XLSX)));
      if (month) {
        candidates.push({ row, col, ...month });
      }
    }
  }

  const grouped = new Map();
  for (const candidate of candidates) {
    const list = grouped.get(candidate.row) || [];
    list.push(candidate);
    grouped.set(candidate.row, list);
  }

  return Array.from(grouped.values())
    .filter((list) => list.length >= 2)
    .flatMap((list) => list.sort((a, b) => a.col - b.col))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

function blockEnd(headers, header, range) {
  const nextSameRow = headers.find((candidate) => candidate.row === header.row && candidate.col > header.col);
  return nextSameRow ? nextSameRow.col - 1 : Math.min(range.e.c, header.col + 3);
}

function blockRowEnd(header, range) {
  return Math.min(range.e.r, header.row + 35);
}

function parseExcelCalendar(filePath, source, XLSX, warnings) {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: "buffer", cellDates: true, raw: false });
  const events = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const ref = sheet["!ref"];
    if (!ref) {
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    const monthHeaders = findCalendarMonthHeaders(sheet, range, XLSX);
    if (!monthHeaders.length) {
      continue;
    }

    const startYear = findStartYear(sheet, range, XLSX);
    const startMonth = findStartMonth(sheet, range, XLSX);
    let sheetEventCount = 0;

    for (const header of monthHeaders) {
      const endCol = blockEnd(monthHeaders, header, range);
      const endRow = blockRowEnd(header, range);
      const year = header.monthNo >= startMonth ? startYear : startYear + 1;
      const contentStartCol = Math.min(endCol, header.col + 2);

      for (let row = header.row + 1; row <= endRow; row += 1) {
        const day = parseDay(cellText(sheetCell(sheet, row, header.col + 1, XLSX)));
        if (!day) {
          continue;
        }
        const date = makeDate(year, header.monthNo, day);
        if (!date) {
          continue;
        }

        for (let col = contentStartCol; col <= endCol; col += 1) {
          const rawText = cellText(sheetCell(sheet, row, col, XLSX));
          if (shouldIgnoreCalendarText(rawText)) {
            continue;
          }
          const address = XLSX.utils.encode_cell({ r: row, c: col });
          const event = makeEvent({
            source,
            filePath,
            sourceSheet: sheetName,
            sourceRow: row + 1,
            sourceCol: col + 1,
            cellAddress: address,
            date,
            rawText
          });
          events.push(event);
          sheetEventCount += 1;
        }
      }
    }

    if (!sheetEventCount) {
      warnings.push({
        type: "empty_calendar_sheet",
        severity: "info",
        sourceType: source.sourceType,
        sourceFile: path.basename(filePath),
        sheetName,
        message: `No planning events found in calendar sheet ${sheetName}.`
      });
    }
  }

  return events;
}

function readZipEntry(buffer, wantedName) {
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.slice(offset + 30, offset + 30 + fileNameLength).toString("utf8");
    const dataStart = offset + 30 + fileNameLength + extraLength;
    const data = buffer.slice(dataStart, dataStart + compressedSize);

    if (name === wantedName) {
      if (method === 0) {
        return data;
      }
      if (method === 8) {
        return zlib.inflateRawSync(data);
      }
      throw new Error(`Unsupported zip compression method ${method} for ${wantedName}.`);
    }

    offset = dataStart + compressedSize;
  }
  return null;
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function extractDocxParagraphs(filePath) {
  const documentXml = readZipEntry(fs.readFileSync(filePath), "word/document.xml");
  if (!documentXml) {
    throw new Error(`Could not find word/document.xml in ${filePath}.`);
  }

  const xml = documentXml.toString("utf8");
  return Array.from(xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g))
    .map((paragraph) => Array.from(paragraph[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
      .map((text) => decodeXml(text[1]))
      .join(""))
    .map(clean)
    .filter(Boolean);
}

function parseDocxDateLine(line, periodStartYear = 2026, startMonth = 8) {
  const pattern = /(\d{1,2})\s*\.?\s*(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)/i;
  const match = line.match(pattern);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = findMonth(match[2]);
  if (!month) {
    return null;
  }
  const year = month.monthNo >= startMonth ? periodStartYear : periodStartYear + 1;
  return makeDate(year, month.monthNo, day);
}

function docxSectionScope(section) {
  const key = fold(section);
  if (/grundforloeb\s*1/.test(key)) {
    return { appliesTo: ["GF1"], classCategoryKey: "gf1", programCode: "gf1" };
  }
  if (/grundforloeb\s*2/.test(key)) {
    return { appliesTo: ["GF2"], classCategoryKey: "gf2", programCode: "gf2" };
  }
  if (/studenter|offentliggoerelse/.test(key)) {
    return { appliesTo: ["ST\u00c5"], classCategoryKey: "staa1", programCode: "staa1" };
  }
  return { appliesTo: ["Alle"], classCategoryKey: null, programCode: null };
}

function parseImportantDatesDocx(filePath, source, warnings) {
  const paragraphs = extractDocxParagraphs(filePath);
  const events = [];
  let currentSection = "Alle";
  let currentScope = docxSectionScope(currentSection);

  paragraphs.forEach((paragraph, index) => {
    if (/:\s*$/.test(paragraph) && !parseDocxDateLine(paragraph)) {
      currentSection = paragraph.replace(/:\s*$/, "");
      currentScope = docxSectionScope(currentSection);
      return;
    }

    const date = parseDocxDateLine(paragraph);
    if (!date) {
      if (!/^vigtige datoer/i.test(paragraph)) {
        warnings.push({
          type: "docx_unparsed_paragraph",
          severity: "info",
          sourceType: source.sourceType,
          sourceFile: path.basename(filePath),
          sourceRow: index + 1,
          message: `DOCX paragraph did not contain a date: ${paragraph}`
        });
      }
      return;
    }

    const scopedSource = { ...source, ...currentScope, appliesTo: currentScope.appliesTo };
    const event = makeEvent({
      source: scopedSource,
      filePath,
      sourceSheet: currentSection,
      sourceRow: index + 1,
      sourceCol: null,
      cellAddress: null,
      date,
      rawText: paragraph,
      fallbackApplies: detectAppliesTo(paragraph, currentScope.appliesTo)
    });
    event.metadata.docx_section = currentSection;
    events.push(event);
  });

  return events;
}

function resolveInputFile(source, args) {
  const requested = args.files.get(source.key) || source.filename;
  const candidates = path.isAbsolute(requested)
    ? [requested]
    : [
        path.resolve(process.cwd(), requested),
        path.resolve(__dirname, "..", requested),
        path.resolve(__dirname, "..", "..", requested),
        path.resolve(os.homedir(), "Downloads", requested)
      ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function parseAllSources(args, XLSX) {
  const events = [];
  const warnings = [];
  const fileSummaries = [];

  for (const defaultSource of DEFAULT_SOURCES) {
    const source = { ...defaultSource, periodLabel: args.periodLabel };
    const filePath = resolveInputFile(source, args);
    if (!fs.existsSync(filePath)) {
      warnings.push({
        type: "missing_file",
        severity: "error",
        sourceType: source.sourceType,
        sourceFile: path.basename(filePath),
        message: `File not found: ${filePath}`
      });
      continue;
    }

    const before = events.length;
    const parsedEvents = source.kind === "docx"
      ? parseImportantDatesDocx(filePath, source, warnings)
      : parseExcelCalendar(filePath, source, XLSX, warnings);
    events.push(...parsedEvents);

    fileSummaries.push({
      filename: path.basename(filePath),
      source_type: source.sourceType,
      events: events.length - before
    });
  }

  return { events: dedupeEvents(events), warnings, fileSummaries };
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.source_type}|${event.source_file}|${event.dedupe_key}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function eventIsUnmatched(event) {
  const applies = event.applies_to || [];
  const hasScope = applies.includes("Alle") || Boolean(event.metadata?.category_key || event.metadata?.program_code);
  return event.event_type === "unknown" || !hasScope;
}

function summarize(events, warnings, fileSummaries, sampleSize) {
  const unmatched = events.filter(eventIsUnmatched);
  return {
    files_read: fileSummaries.length,
    file_summaries: fileSummaries,
    events_found: events.length,
    events_by_source_type: countBy(events, (event) => event.source_type),
    events_by_event_type: countBy(events, (event) => event.event_type),
    events_by_lock_level: countBy(events, (event) => event.lock_level),
    events_by_week: countBy(events.filter((event) => event.iso_week && event.date), (event) => {
      const date = new Date(`${event.date}T00:00:00.000Z`);
      return `${isoYear(date)}-W${String(event.iso_week).padStart(2, "0")}`;
    }),
    unmatched: unmatched.length,
    sample_events: events.slice(0, sampleSize),
    sample_warnings: warnings.slice(0, sampleSize)
  };
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = String(keyFn(item));
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
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
    return this.request("POST", table, { body, prefer: "return=representation" });
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

function applyDatabaseMatches(events, lookupMaps, warnings) {
  return events.map((event) => {
    const programCode = event.metadata.program_code;
    const classCategoryKey = event.metadata.category_key;
    const educationProgramId = programCode ? lookupMaps.programByCode.get(programCode) || null : null;
    const classCategoryId = classCategoryKey ? lookupMaps.categoryByKey.get(classCategoryKey) || null : null;

    if (programCode && !educationProgramId) {
      warnings.push({
        type: "unmatched_education_program",
        severity: "warning",
        sourceType: event.source_type,
        sourceFile: event.source_file,
        sheetName: event.source_sheet,
        sourceRow: event.source_row,
        entityLegacyId: event.dedupe_key,
        message: `Could not match education program code ${programCode} for "${event.raw_text}".`
      });
    }
    if (classCategoryKey && !classCategoryId) {
      warnings.push({
        type: "unmatched_class_category",
        severity: "warning",
        sourceType: event.source_type,
        sourceFile: event.source_file,
        sheetName: event.source_sheet,
        sourceRow: event.source_row,
        entityLegacyId: event.dedupe_key,
        message: `Could not match class category key ${classCategoryKey} for "${event.raw_text}".`
      });
    }

    return {
      ...event,
      education_program_id: educationProgramId,
      class_category_id: classCategoryId,
      class_group_id: null
    };
  });
}

async function ensurePlanningImport(client, schoolId, source, sourceFile, periodLabel, summary) {
  const existing = await client.select("planning_calendar_imports", {
    select: "id,data_import_id",
    school_id: `eq.${schoolId}`,
    filename: `eq.${sourceFile}`,
    source_type: `eq.${source.sourceType}`,
    limit: "1"
  });

  let dataImportId = existing[0]?.data_import_id || null;
  if (!dataImportId) {
    const [dataImport] = await client.insert("data_imports", [{
      school_id: schoolId,
      source_kind: source.kind === "xlsx" ? "excel" : "manual",
      source_name: sourceFile,
      import_version: "planning-calendar-v1",
      metadata: {
        source: "planning_calendar",
        source_type: source.sourceType,
        period_label: periodLabel,
        summary
      }
    }]);
    dataImportId = dataImport.id;
  }

  const [planningImport] = await client.upsert("planning_calendar_imports", [{
    school_id: schoolId,
    data_import_id: dataImportId,
    filename: sourceFile,
    source_type: source.sourceType,
    period_label: periodLabel,
    metadata: {
      parser: "import-planning-calendars.mjs",
      summary
    }
  }], "school_id,filename,source_type");

  return planningImport;
}

async function upsertEvents(client, importId, schoolId, events) {
  const rows = events.map((event) => ({
    import_id: importId,
    school_id: schoolId,
    ...event
  }));
  let written = 0;
  for (const chunk of chunks(rows, 500)) {
    const result = await client.upsert("planning_calendar_events", chunk, "import_id,dedupe_key");
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
    warning_type: warning.type || "planning_calendar_warning",
    severity: warning.severity || "warning",
    source_sheet: warning.sheetName || null,
    source_row: warning.sourceRow || null,
    entity_type: "planning_calendar_event",
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
  const XLSX = await loadXlsx();
  const parsed = parseAllSources(args, XLSX);
  const dryRunSummary = summarize(parsed.events, parsed.warnings, parsed.fileSummaries, args.sampleSize);

  if (args.dryRun) {
    console.log(JSON.stringify(dryRunSummary, null, 2));
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running a real import.");
  }

  const client = new SupabaseRest({ url: supabaseUrl, key: supabaseKey });
  const school = await getSchool(client, args.organizationSlug, args.schoolSlug);
  const lookupMaps = await loadLookupMaps(client, school.id);
  const events = applyDatabaseMatches(parsed.events, lookupMaps, parsed.warnings);
  const summary = summarize(events, parsed.warnings, parsed.fileSummaries, args.sampleSize);

  const imports = [];
  let eventsWritten = 0;
  let warningsInserted = 0;
  for (const source of DEFAULT_SOURCES) {
    const sourceEvents = events.filter((event) => event.source_type === source.sourceType);
    if (!sourceEvents.length) {
      continue;
    }
    const sourceFile = sourceEvents[0].source_file;
    const planningImport = await ensurePlanningImport(client, school.id, source, sourceFile, args.periodLabel, summary);
    imports.push({ source_type: source.sourceType, import_id: planningImport.id, data_import_id: planningImport.data_import_id });
    eventsWritten += await upsertEvents(client, planningImport.id, school.id, sourceEvents);
    const sourceWarnings = parsed.warnings.filter((warning) => warning.sourceType === source.sourceType || warning.sourceFile === sourceFile);
    warningsInserted += await insertWarnings(client, planningImport.data_import_id, school.id, sourceWarnings);
  }

  console.log(JSON.stringify({
    imports,
    events_written: eventsWritten,
    warnings_inserted: warningsInserted,
    summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
